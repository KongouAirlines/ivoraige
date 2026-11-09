// Opt-in native diagnostics only. This file never creates accounts or changes policy.
using System;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

public static class StandardPipeProbe {
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr value);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int type, IntPtr data, int size, out int needed);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint pid);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool LookupPrivilegeValue(string system, string name, out long luid);
    static void Check(bool ok, string stage) { if (!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), stage); }
    static IntPtr Information(IntPtr token, int type) {
        int size;
        GetTokenInformation(token, type, IntPtr.Zero, 0, out size);
        if (size <= 0) throw new InvalidOperationException("Token information size unavailable");
        var data = Marshal.AllocHGlobal(size);
        if (!GetTokenInformation(token, type, data, size, out size)) {
            int error = Marshal.GetLastWin32Error(); Marshal.FreeHGlobal(data);
            throw new System.ComponentModel.Win32Exception(error, "Token information unavailable");
        }
        return data;
    }
    static int Integer(IntPtr token, int type) {
        var data = Information(token, type);
        try { return Marshal.ReadInt32(data); } finally { Marshal.FreeHGlobal(data); }
    }
    static string Sid(IntPtr token, int type) {
        var data = Information(token, type);
        try { return new SecurityIdentifier(Marshal.ReadIntPtr(data)).Value; } finally { Marshal.FreeHGlobal(data); }
    }
    static bool HasAdministrators(IntPtr token) {
        var data = Information(token, 2); // TOKEN_GROUPS, including deny-only groups
        try {
            int count = Marshal.ReadInt32(data), offset = IntPtr.Size == 8 ? 8 : 4, stride = IntPtr.Size == 8 ? 16 : 8;
            for (int i = 0; i < count; i++)
                if (new SecurityIdentifier(Marshal.ReadIntPtr(data, offset + i * stride)).Value == "S-1-5-32-544") return true;
            return false;
        } finally { Marshal.FreeHGlobal(data); }
    }
    static bool ImpersonateEnabled(IntPtr token) {
        long luid;
        Check(LookupPrivilegeValue(null, "SeImpersonatePrivilege", out luid), "Privilege lookup");
        var data = Information(token, 3);
        try {
            int count = Marshal.ReadInt32(data);
            for (int i = 0; i < count; i++)
                if (Marshal.ReadInt64(data, 4 + i * 12) == luid && (Marshal.ReadInt32(data, 12 + i * 12) & 2) != 0) return true;
            return false;
        } finally { Marshal.FreeHGlobal(data); }
    }
    public static object Attest(int pid, string expectedSid) {
        var process = OpenProcess(0x1000, false, pid);
        Check(process != IntPtr.Zero, "Open test process");
        IntPtr token = IntPtr.Zero;
        try {
            Check(OpenProcessToken(process, 8, out token), "Open test token");
            string sid = Sid(token, 1), integrity = Sid(token, 25);
            int elevation = Integer(token, 20), elevationType = Integer(token, 18);
            int integrityRid = Int32.Parse(integrity.Substring(integrity.LastIndexOf('-') + 1));
            bool administrator = HasAdministrators(token), impersonate = ImpersonateEnabled(token);
            if (sid != expectedSid || elevation != 0 || elevationType != 1 || integrityRid != 8192 || administrator || impersonate)
                throw new InvalidOperationException("Expected a normal medium-integrity non-admin token without enabled impersonation privilege");
            return new { pid = pid, sid = sid, elevated = false, elevationType = elevationType,
                integrityRid = integrityRid, administratorsGroup = false, impersonateEnabled = false };
        } finally { if (token != IntPtr.Zero) CloseHandle(token); CloseHandle(process); }
    }
    static object Self(string expectedSid) { return Attest(System.Diagnostics.Process.GetCurrentProcess().Id, expectedSid); }
    public static string Tokens(int[] pids, string sid) {
        var values = new object[pids.Length + 1]; values[0] = Self(sid);
        for (int i = 0; i < pids.Length; i++) values[i + 1] = Attest(pids[i], sid);
        return new JavaScriptSerializer().Serialize(values);
    }
    static string Name(string address) {
        if (!System.Text.RegularExpressions.Regex.IsMatch(address, @"^\\\\\.\\pipe\\ivoraige-[A-Za-z0-9_-]{22}$")) throw new ArgumentException("Invalid synthetic address");
        return address.Substring(@"\\.\pipe\".Length);
    }
    public static string Inspect(string address, string sid) {
        var token = Self(sid);
        using (var pipe = new NamedPipeClientStream(".", Name(address), PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification)) {
            pipe.Connect(10000);
            var acl = pipe.GetAccessControl();
            var raw = new RawSecurityDescriptor(acl.GetSecurityDescriptorBinaryForm(), 0);
            var ace = raw.DiscretionaryAcl == null || raw.DiscretionaryAcl.Count != 1 ? null : raw.DiscretionaryAcl[0] as CommonAce;
            if (raw.Owner == null || raw.Owner.Value != sid || (raw.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0 ||
                ace == null || ace.IsCallback || ace.AceFlags != AceFlags.None || ace.AceQualifier != AceQualifier.AccessAllowed ||
                ace.SecurityIdentifier.Value != sid || ace.AccessMask != 0x1f01ff) throw new InvalidOperationException("Exact native DACL mismatch");
            uint serverPid;
            Check(GetNamedPipeServerProcessId(pipe.SafePipeHandle, out serverPid), "Pipe server PID");
            var serverToken = Attest((int)serverPid, sid);
            var bytes = System.Text.Encoding.UTF8.GetBytes("synthetic-inspect\n");
            pipe.Write(bytes, 0, bytes.Length);
            using (var reader = new StreamReader(pipe)) {
                var read = reader.ReadLineAsync();
                if (!read.Wait(10000) || read.Result != "accepted") throw new InvalidOperationException("Native inspection exchange failed");
            }
            return new JavaScriptSerializer().Serialize(new { token = token, serverToken = serverToken,
                ownerSid = sid, protectedDacl = true, aceCount = 1, accessMask = 0x1f01ff });
        }
    }
    public static string Denied(string address, string sid) {
        Name(address);
        var token = Self(sid);
        using (var handle = CreateFile(address, 0xc0020000, 0, IntPtr.Zero, 3, 0x40110000, IntPtr.Zero)) {
            int error = Marshal.GetLastWin32Error();
            if (!handle.IsInvalid || error != 5) throw new System.ComponentModel.Win32Exception(error, "Foreign token was not denied at CreateFile");
            return new JavaScriptSerializer().Serialize(new { token = token, win32Error = error, dispatched = false });
        }
    }
    public static void Spoof(string address, string sid, string allowedSid) {
        var token = Self(sid);
        if (sid == allowedSid) throw new ArgumentException("Spoof requires distinct users");
        var acl = new PipeSecurity();
        acl.SetOwner(new SecurityIdentifier(sid));
        acl.SetAccessRuleProtection(true, false);
        acl.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(sid), PipeAccessRights.FullControl, AccessControlType.Allow));
        acl.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(allowedSid), PipeAccessRights.FullControl, AccessControlType.Allow));
        using (var pipe = new NamedPipeServerStream(Name(address), PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous, 4096, 4096, acl)) {
            Console.WriteLine(new JavaScriptSerializer().Serialize(new { ready = true, token = token })); Console.Out.Flush();
            if (!pipe.WaitForConnectionAsync().Wait(30000)) throw new InvalidOperationException("Spoof connect timeout");
            var bytes = new byte[1024]; var read = pipe.ReadAsync(bytes, 0, bytes.Length);
            try { if (!read.Wait(10000) || read.Result != 0) throw new InvalidOperationException("Spoof received data or no disconnect"); }
            catch (AggregateException error) { if (!(error.InnerException is IOException)) throw; }
        }
        Console.WriteLine("{\"payloadBytes\":0}"); Console.Out.Flush();
    }
}
