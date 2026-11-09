using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

namespace Ivoraige {
// The helper owns only the OS transport. HostControl schemas, capability,
// generations, admission and shutdown receipts remain in the Node owner.
public static class HostPipe {
    const int Limit = 1024 * 1024;
    const uint Overlapped = 0x40000000, FirstInstance = 0x00080000;
    static readonly string Sid = WindowsIdentity.GetCurrent().User.Value;
    static readonly object OutputLock = new object();
    static readonly JavaScriptSerializer InputJson = new JavaScriptSerializer { MaxJsonLength = 2 * Limit };
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 2 * Limit };
    static readonly ConcurrentDictionary<string, Listener> Listeners = new ConcurrentDictionary<string, Listener>();
    static readonly ConcurrentDictionary<string, Peer> Peers = new ConcurrentDictionary<string, Peer>();
    static int Sequence;
    static readonly object ConnectGate = new object();
    static readonly HashSet<string> Connecting = new HashSet<string>();

    [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {
        public int Length;
        public IntPtr Descriptor;
        public int Inherit;
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafePipeHandle CreateNamedPipe(string name, uint mode, uint pipeMode, uint maxInstances, uint outSize, uint inSize, uint timeout, ref SecurityAttributes security);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafePipeHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool WaitNamedPipe(string name, uint timeout);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern uint GetSecurityInfo(SafePipeHandle handle, int type, uint information, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool ImpersonateNamedPipeClient(SafePipeHandle handle);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool RevertToSelf();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    static void Send(object message) {
        lock (OutputLock) { Console.Out.WriteLine(Json.Serialize(message)); Console.Out.Flush(); }
    }
    static string Text(Dictionary<string, object> message, string key) { return (string)message[key]; }
    static void Address(string address) {
        if (!System.Text.RegularExpressions.Regex.IsMatch(address, @"^\\\\\.\\pipe\\ivoraige-[A-Za-z0-9_-]{22}$"))
            throw new InvalidOperationException();
    }
    // Validate the descriptor on the HANDLE we actually use, not on a path
    // that can be replaced between inspection and connection.
    static void VerifyDescriptor(SafePipeHandle handle) {
        IntPtr owner, group, dacl, sacl, descriptor;
        if (GetSecurityInfo(handle, 1, 5, out owner, out group, out dacl, out sacl, out descriptor) != 0)
            throw new UnauthorizedAccessException();
        try {
            var bytes = new byte[GetSecurityDescriptorLength(descriptor)];
            Marshal.Copy(descriptor, bytes, 0, bytes.Length);
            var security = new RawSecurityDescriptor(bytes, 0);
            if (security.Owner == null || security.Owner.Value != Sid || security.DiscretionaryAcl == null ||
                (security.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0 || security.DiscretionaryAcl.Count != 1)
                throw new UnauthorizedAccessException();
            var ace = security.DiscretionaryAcl[0] as CommonAce;
            if (ace == null || ace.IsCallback || ace.AceFlags != AceFlags.None ||
                ace.AceQualifier != AceQualifier.AccessAllowed || ace.SecurityIdentifier.Value != Sid ||
                ace.AccessMask != 0x1f01ff) throw new UnauthorizedAccessException();
        } finally { LocalFree(descriptor); }
    }
    static string ServerIdentity(SafePipeHandle handle) {
        uint pid;
        if (!GetNamedPipeServerProcessId(handle, out pid)) throw new UnauthorizedAccessException();
        var process = OpenProcess(0x1000, false, pid);
        if (process == IntPtr.Zero) throw new UnauthorizedAccessException();
        IntPtr token = IntPtr.Zero;
        try {
            if (!OpenProcessToken(process, 8, out token)) throw new UnauthorizedAccessException();
            using (var identity = new WindowsIdentity(token)) {
                if (identity.User.Value != Sid) throw new UnauthorizedAccessException();
                return identity.User.Value;
            }
        } finally { if (token != IntPtr.Zero) CloseHandle(token); CloseHandle(process); }
    }
    static string ClientIdentity(SafePipeHandle handle) {
        // This token comes from the last byte actually read on this pipe, not
        // a claimed PID/SID or a secret supplied by the client. Identification
        // SQOS gives us TokenUser but no right to act on the client's behalf.
        if (!ImpersonateNamedPipeClient(handle)) throw new UnauthorizedAccessException();
        try {
            using (var identity = WindowsIdentity.GetCurrent(true)) {
                if (identity == null || identity.User.Value != Sid) throw new UnauthorizedAccessException();
                return identity.User.Value;
            }
        } finally {
            // A failed revert must not allow subsequent work under that token.
            if (!RevertToSelf()) Environment.FailFast("Host pipe identity reset failed");
        }
    }
    static NamedPipeServerStream NewPipe(string address, bool first) {
        IntPtr descriptor;
        uint size;
        if (!ConvertStringSecurityDescriptorToSecurityDescriptor("O:" + Sid + "D:P(A;;FA;;;" + Sid + ")", 1, out descriptor, out size))
            throw new UnauthorizedAccessException();
        try {
            var security = new SecurityAttributes { Length = Marshal.SizeOf(typeof(SecurityAttributes)), Descriptor = descriptor };
            // BYTE mode, local connections only; first creation fails if a
            // different process already owns this randomly selected name.
            var handle = CreateNamedPipe(address, 3 | Overlapped | (first ? FirstInstance : 0), 8, 255, 65536, 65536, 5000, ref security);
            if (handle.IsInvalid) { handle.Dispose(); throw new UnauthorizedAccessException(); }
            try {
                VerifyDescriptor(handle);
                return new NamedPipeServerStream(PipeDirection.InOut, true, false, handle);
            } catch { handle.Dispose(); throw; }
        } finally { LocalFree(descriptor); }
    }
    sealed class Peer {
        public string Id;
        public string Server;
        public PipeStream Stream;
        public Task Writes = Task.FromResult(0);
        public long Buffered;
        public bool Ending;
        public Timer Idle;
        int Closed;
        public void Close() {
            if (Interlocked.Exchange(ref Closed, 1) != 0) return;
            if (Idle != null) Idle.Dispose();
            Stream.Dispose();
            Peer removed; Peers.TryRemove(Id, out removed);
            Send(new { type = "closed", id = Id });
        }
        public void Write(byte[] bytes, bool end) {
            lock (this) {
                if (Ending || Interlocked.Add(ref Buffered, bytes.Length) > 2 * Limit) { Close(); return; }
                Ending = end;
                Writes = Writes.ContinueWith(async previous => {
                    try {
                        await previous;
                        await Stream.WriteAsync(bytes, 0, bytes.Length);
                        Interlocked.Add(ref Buffered, -bytes.Length);
                        if (end) {
                            // EOF follows delivery, not just a successful write
                            // into a kernel buffer. Bound an unresponsive peer.
                            using (var deadline = new Timer(ignored => Close(), null, 1000, Timeout.Infinite)) {
                                await Task.Run(() => Stream.WaitForPipeDrain());
                            }
                            Close();
                        }
                    } catch { Close(); }
                }).Unwrap();
            }
        }
    }
    sealed class Listener {
        public string Id;
        public string Address;
        public NamedPipeServerStream Pending;
        public bool Closed;
        public readonly object Gate = new object();
        public void Close() {
            lock (Gate) { Closed = true; if (Pending != null) Pending.Dispose(); }
            foreach (var peer in Peers.Values) if (peer.Server == Id) peer.Close();
            Listener removed; Listeners.TryRemove(Id, out removed);
        }
        public async void Accept() {
            try {
                while (!Closed) {
                    NamedPipeServerStream stream;
                    lock (Gate) { if (Closed) return; stream = Pending; }
                    await stream.WaitForConnectionAsync();
                    lock (Gate) {
                        if (Closed) { stream.Dispose(); return; }
                        // Keep one live instance at all times so another
                        // process cannot substitute a new pipe between clients.
                        Pending = NewPipe(Address, false);
                    }
                    if (Peers.Count >= 64) { stream.Dispose(); continue; }
                    var peer = new Peer { Id = "p" + Interlocked.Increment(ref Sequence), Server = Id, Stream = stream };
                    Peers[peer.Id] = peer;
                    peer.Idle = new Timer(ignored => peer.Close(), null, 5000, Timeout.Infinite);
                    Read(peer, true);
                }
            } catch {
                if (!Closed) { Close(); Send(new { type = "error", id = Id }); }
            }
        }
    }
    static async void Read(Peer peer, bool authenticateClient) {
        try {
            var buffer = new byte[65536];
            if (authenticateClient) {
                int first = await peer.Stream.ReadAsync(buffer, 0, 1);
                if (first == 0) return;
                string sid = ClientIdentity(peer.Stream.SafePipeHandle);
                uint pid;
                if (!GetNamedPipeClientProcessId(peer.Stream.SafePipeHandle, out pid)) throw new UnauthorizedAccessException();
                peer.Idle.Dispose();
                Send(new { type = "connection", id = peer.Id, server = peer.Server, peerSid = sid, peerPid = pid });
                Send(new { type = "data", id = peer.Id, data = Convert.ToBase64String(buffer, 0, 1) });
            }
            for (;;) {
                int count = await peer.Stream.ReadAsync(buffer, 0, buffer.Length);
                if (count == 0) { Send(new { type = "end", id = peer.Id }); break; }
                Send(new { type = "data", id = peer.Id, data = Convert.ToBase64String(buffer, 0, count) });
            }
        } catch { }
        finally { peer.Close(); }
    }
    static async void Connect(string id, string address) {
        lock (ConnectGate) Connecting.Add(id);
        try {
            Address(address);
            SafePipeHandle handle;
            var started = DateTime.UtcNow;
            for (;;) {
                // READ_CONTROL permits inspecting the connected object's DACL.
                // SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION deliberately
                // excludes impersonation/delegation by an untrusted server.
                handle = CreateFile(address, 0xc0020000, 0, IntPtr.Zero, 3, Overlapped | 0x00110000, IntPtr.Zero);
                if (!handle.IsInvalid) break;
                int error = Marshal.GetLastWin32Error(); handle.Dispose();
                if (error != 231 || DateTime.UtcNow - started > TimeSpan.FromSeconds(5)) throw new UnauthorizedAccessException();
                await Task.Run(() => WaitNamedPipe(address, 250));
            }
            NamedPipeClientStream stream;
            string sid;
            try {
                VerifyDescriptor(handle);
                sid = ServerIdentity(handle);
                stream = new NamedPipeClientStream(PipeDirection.InOut, true, true, handle);
            } catch { handle.Dispose(); throw; }
            var peer = new Peer { Id = id, Stream = stream };
            lock (ConnectGate) {
                if (!Connecting.Remove(id)) { stream.Dispose(); return; }
                Peers[id] = peer;
            }
            Send(new { type = "connected", id = id, peerSid = sid });
            Read(peer, false);
        } catch { Send(new { type = "error", id = id }); }
        finally { lock (ConnectGate) Connecting.Remove(id); }
    }
    public static void Run() {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        Send(new { type = "ready", sid = Sid });
        string line;
        try {
            while ((line = Console.ReadLine()) != null) {
                if (line.Length > 2 * Limit) throw new InvalidDataException();
                // Only inherited Node stdin can issue these commands. External
                // clients see pipe bytes, never this control protocol.
                var message = InputJson.Deserialize<Dictionary<string, object>>(line);
                string type = Text(message, "type"), id = Text(message, "id");
                if (type == "listen") {
                    try {
                        string address = Text(message, "address"); Address(address);
                        var listener = new Listener { Id = id, Address = address, Pending = NewPipe(address, true) };
                        if (!Listeners.TryAdd(id, listener)) { listener.Pending.Dispose(); throw new InvalidOperationException(); }
                        Send(new { type = "listening", id = id, sid = Sid });
                        listener.Accept();
                    } catch { Send(new { type = "error", id = id }); }
                } else if (type == "connect") Connect(id, Text(message, "address"));
                else if (type == "closeServer") {
                    Listener listener; if (Listeners.TryGetValue(id, out listener)) listener.Close();
                    Send(new { type = "serverClosed", id = id });
                } else {
                    Peer peer;
                    if (type == "destroy") {
                        lock (ConnectGate) {
                            Connecting.Remove(id);
                            if (Peers.TryGetValue(id, out peer)) peer.Close();
                        }
                        continue;
                    }
                    if (!Peers.TryGetValue(id, out peer)) continue;
                    if (type == "write" || type == "end") {
                        string data = Text(message, "data");
                        if (data.Length > ((Limit + 2) / 3) * 4) throw new InvalidDataException();
                        byte[] bytes = Convert.FromBase64String(data);
                        if (bytes.Length > Limit) throw new InvalidDataException();
                        peer.Write(bytes, type == "end");
                    } else throw new InvalidDataException();
                }
            }
        } finally {
            foreach (var listener in Listeners.Values) listener.Close();
            foreach (var peer in Peers.Values) peer.Close();
        }
    }
}
}
