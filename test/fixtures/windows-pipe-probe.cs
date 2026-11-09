using System;
using System.IO;
using System.IO.Pipes;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

public static class WindowsPipeProbe {
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool ImpersonateAnonymousToken(IntPtr thread);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool RevertToSelf();
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentThread();
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool LookupPrivilegeValue(string system, string name, out long luid);
    [StructLayout(LayoutKind.Sequential, Pack = 4)] struct Privilege { public uint Count; public long Luid; public uint Attributes; }
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool AdjustTokenPrivileges(IntPtr token, bool all, ref Privilege privileges, uint length, IntPtr previous, IntPtr result);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int type, IntPtr data, int size, out int needed);
    static void AssertPrivilegeRemoved(IntPtr token, long luid) {
        int size;
        GetTokenInformation(token, 3, IntPtr.Zero, 0, out size);
        var data = Marshal.AllocHGlobal(size);
        try {
            if (!GetTokenInformation(token, 3, data, size, out size)) throw new Exception("Cannot verify reduced token");
            int count = Marshal.ReadInt32(data);
            for (int i = 0; i < count; i++) {
                if (Marshal.ReadInt64(data, 4 + i * 12) == luid) throw new Exception("Test privilege was not removed");
            }
        } finally { Marshal.FreeHGlobal(data); }
    }
    static string Name(string address) { return address.Substring(@"\\.\pipe\".Length); }

    public static string Inspect(string address) {
        using (var pipe = new NamedPipeClientStream(".", Name(address), PipeDirection.InOut, PipeOptions.None, TokenImpersonationLevel.Identification)) {
            pipe.Connect(5000);
            var acl = pipe.GetAccessControl();
            var owner = acl.GetOwner(typeof(SecurityIdentifier)).Value;
            var rules = acl.GetAccessRules(true, true, typeof(SecurityIdentifier));
            if (!acl.AreAccessRulesProtected || rules.Count != 1 || owner != WindowsIdentity.GetCurrent().User.Value) throw new Exception("Bad native pipe ACL");
            var rule = (PipeAccessRule)rules[0];
            if (rule.IdentityReference.Value != owner || rule.AccessControlType != AccessControlType.Allow) throw new Exception("Foreign native pipe ACE");
            var bytes = System.Text.Encoding.UTF8.GetBytes("probe\n");
            pipe.Write(bytes, 0, bytes.Length);
            using (var reader = new StreamReader(pipe)) {
                if (reader.ReadLine() != "accepted") throw new Exception("Owner exchange failed");
            }
            return owner;
        }
    }
    public static string AnonymousDenied(string address) {
        if (!ImpersonateAnonymousToken(GetCurrentThread())) throw new Exception("Anonymous impersonation unavailable");
        string sid;
        int error;
        try {
            using (var identity = WindowsIdentity.GetCurrent(true)) sid = identity.User.Value;
            using (var handle = CreateFile(address, 0xc0000000, 0, IntPtr.Zero, 3, 0x00110000, IntPtr.Zero)) {
                error = Marshal.GetLastWin32Error();
                if (!handle.IsInvalid) throw new Exception("Foreign TokenUser connected");
            }
        } finally { if (!RevertToSelf()) Environment.FailFast("Probe identity reset failed"); }
        if (sid != "S-1-5-7" || error != 5) throw new Exception("Expected anonymous TokenUser and ERROR_ACCESS_DENIED");
        return sid + ":ERROR_ACCESS_DENIED";
    }
    public static string RejectInsecureServer(string address) {
        var acl = new PipeSecurity();
        acl.SetOwner(WindowsIdentity.GetCurrent().User);
        acl.SetAccessRuleProtection(true, false);
        acl.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
        acl.AddAccessRule(new PipeAccessRule(new SecurityIdentifier("S-1-1-0"), PipeAccessRights.ReadWrite, AccessControlType.Allow));
        using (var pipe = new NamedPipeServerStream(Name(address), PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096, acl)) {
            Console.WriteLine("ready"); Console.Out.Flush();
            if (!pipe.WaitForConnectionAsync().Wait(10000)) throw new Exception("No client connected");
            var bytes = new byte[1024];
            var read = pipe.ReadAsync(bytes, 0, bytes.Length);
            try {
                if (!read.Wait(5000) || read.Result != 0) throw new Exception("Client transmitted to insecure server");
            } catch (AggregateException error) {
                if (!(error.InnerException is IOException)) throw;
            }
        }
        return "no-data";
    }
    public static int WithoutImpersonationPrivilege(string node, string script) {
        IntPtr token;
        if (!OpenProcessToken(GetCurrentProcess(), 0x28, out token)) throw new Exception("Cannot inspect test token");
        try {
            long luid;
            if (!LookupPrivilegeValue(null, "SeImpersonatePrivilege", out luid)) throw new Exception("Cannot locate test privilege");
            // Remove only from this disposable probe process and its children.
            // No account, policy, group, ACL or persistent OS setting changes.
            var privilege = new Privilege { Count = 1, Luid = luid, Attributes = 4 };
            if (!AdjustTokenPrivileges(token, false, ref privilege, 0, IntPtr.Zero, IntPtr.Zero)) throw new Exception("Cannot reduce test token");
            int error = Marshal.GetLastWin32Error();
            if (error != 0 && error != 1300) throw new Exception("Cannot reduce test token");
            AssertPrivilegeRemoved(token, luid);
        } finally { CloseHandle(token); }
        var start = new ProcessStartInfo(node, "\"" + script + "\"") { UseShellExecute = false };
        using (var child = Process.Start(start)) {
            if (!child.WaitForExit(30000)) { child.Kill(); throw new Exception("Reduced-token transport timeout"); }
            return child.ExitCode;
        }
    }
}
