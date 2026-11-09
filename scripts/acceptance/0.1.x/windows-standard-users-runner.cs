// Opt-in, single-run acceptance orchestration. Never loaded by application code.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.ServiceProcess;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;

public static class StandardAccountAcceptance {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct UserInfo {
        public string Name, Password; public uint PasswordAge, Privilege; public string Home, Comment; public uint Flags; public string Script;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct GroupMember { public string Name; }
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetUserAdd(string server, int level, ref UserInfo user, out int parameter);
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetUserDel(string server, string user);
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetUserGetInfo(string server, string user, int level, out IntPtr value);
    [DllImport("netapi32.dll")] static extern int NetApiBufferFree(IntPtr value);
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetLocalGroupAddMembers(string server, string group, int level, ref GroupMember member, int count);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool DeleteProfile(string sid, string path, string computer);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int type, IntPtr information, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int type, out Accounting information, uint length, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr value);
    [StructLayout(LayoutKind.Sequential)] struct Limits {
        public long ProcessTime, JobTime; public uint Flags; public UIntPtr Minimum, Maximum; public uint Active;
        public UIntPtr Affinity; public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct Io { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits { public Limits Basic; public Io Io; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
    [StructLayout(LayoutKind.Sequential)] struct Accounting { public long User, Kernel, PeriodUser, PeriodKernel; public uint Faults, Total, Active, Terminated; }
    sealed class Account : IDisposable {
        public string Name, Sid, Temporary; public SecureString Password; public bool Created;
        public void Dispose() { if (Password != null) Password.Dispose(); }
    }
    sealed class Actor : IDisposable {
        public Process Process; public Account Account;
        public Dictionary<string, object> Send(string type, string address = null, string allowedSid = null) {
            var message = new Dictionary<string, object> { { "type", type } };
            if (address != null) message.Add("address", address);
            if (allowedSid != null) message.Add("allowedSid", allowedSid);
            Process.StandardInput.WriteLine(Json.Serialize(message)); Process.StandardInput.Flush();
            var pending = Process.StandardOutput.ReadLineAsync();
            if (!pending.Wait(45000)) throw new InvalidOperationException("Actor command deadline");
            string line = pending.Result;
            if (line == null || line.Length > 32768) throw new InvalidOperationException("Actor response unavailable");
            var reply = Json.Deserialize<Dictionary<string, object>>(line);
            if (!reply.ContainsKey("ok") || !Object.Equals(reply["ok"], true)) {
                int nativeError = reply.ContainsKey("win32Error") ? Convert.ToInt32(reply["win32Error"]) : 0;
                if (nativeError != 0) throw new Win32Exception(nativeError, "Actor native command failed");
                throw new InvalidOperationException("Actor rejected command " + type);
            }
            return (Dictionary<string, object>)reply["result"];
        }
        public void Stop() {
            var result = Send("stop");
            Require(Object.Equals(result["nativeHelpersExited"], true), "Helper exit was not verified");
            if (!Process.WaitForExit(15000) || Process.ExitCode != 0) throw new InvalidOperationException("Actor did not exit normally");
        }
        public void Dispose() { if (Process != null) Process.Dispose(); }
    }
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 1024 * 1024 };
    static readonly List<object> Evidence = new List<object>();
    static readonly List<Account> Accounts = new List<Account>();
    static readonly List<Actor> Actors = new List<Actor>();
    static string Stage = "preflight", Root;
    static IntPtr Job;
    static bool Started;
    public static string CurrentStage { get { return Stage; } }
    public static bool CleanupFinished { get; private set; }
    public static bool OwnedProcessesExited { get; private set; }
    static void Require(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
    static void Native(bool value) { if (!value) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static void Status(int value) { if (value != 0) throw new Win32Exception(value); }
    static object Failure(Exception error) { return new { stage = Stage, type = error.GetType().Name,
        win32Error = error is Win32Exception ? ((Win32Exception)error).NativeErrorCode : 0 }; }
    static string Nonce() { var bytes = new byte[16]; using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes); return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_'); }
    static string Pipe() { return @"\\.\pipe\ivoraige-" + Nonce(); }
    static void Absent(string name) {
        IntPtr value; int result = NetUserGetInfo(null, name, 0, out value);
        if (value != IntPtr.Zero) NetApiBufferFree(value);
        if (result != 2221) throw new Win32Exception(result, "Account name is not confirmed unused");
    }
    public static void Preflight(string source, string node, bool requireRunningService = true) {
        Stage = "preflight-platform";
        Require(Environment.OSVersion.Platform == PlatformID.Win32NT && Environment.Is64BitProcess, "64-bit Windows required");
        Require(new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator), "Elevated disposable runner required for provisioning only");
        Require(Environment.GetEnvironmentVariable("GITHUB_ACTIONS") == "true" && Environment.GetEnvironmentVariable("RUNNER_OS") == "Windows", "Disposable GitHub Windows runner required");
        Require(Environment.GetEnvironmentVariable("GITHUB_RUN_ATTEMPT") == "1", "Automatic reruns are prohibited");
        Stage = "preflight-secondary-logon";
        if (requireRunningService) using (var service = new ServiceController("seclogon"))
            if (service.Status != ServiceControllerStatus.Running) throw new Win32Exception(1062, "Secondary Logon must be Running before provisioning");
        Stage = "preflight-source-and-account-api";
        Require(File.Exists(node), "Node executable missing");
        foreach (string file in Files) Require(File.Exists(Path.Combine(source, file)), "Acceptance source missing");
        // Read-only API probe, before creating either account.
        Absent("iva" + Guid.NewGuid().ToString("N").Substring(0, 12));
    }
    static readonly string[] Files = {
        @"src\host-windows-pipe.mjs", @"src\errors.mjs", @"src\windows\HostPipe.cs",
        @"scripts\acceptance\0.1.x\windows-standard-users-actor.mjs",
        @"scripts\acceptance\0.1.x\windows-standard-users-probe.cs"
    };
    static Account Provision(string suffix) {
        var account = new Account { Name = "iva" + Guid.NewGuid().ToString("N").Substring(0, 12) + suffix };
        Accounts.Add(account); Absent(account.Name);
        var bytes = new byte[36]; using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
        string password = Convert.ToBase64String(bytes) + "aA1!"; Array.Clear(bytes, 0, bytes.Length);
        account.Password = new SecureString(); foreach (char c in password) account.Password.AppendChar(c); account.Password.MakeReadOnly();
        var user = new UserInfo { Name = account.Name, Password = password, Privilege = 1,
            Comment = "Disposable ivoraige native pipe acceptance", Flags = 0x201 };
        int parameter;
        int status = NetUserAdd(null, 1, ref user, out parameter);
        user.Password = null; password = null;
        Status(status); account.Created = true;
        account.Sid = ((SecurityIdentifier)new NTAccount(Environment.MachineName, account.Name).Translate(typeof(SecurityIdentifier))).Value;
        string users = ((NTAccount)new SecurityIdentifier("S-1-5-32-545").Translate(typeof(NTAccount))).Value;
        users = users.Substring(users.LastIndexOf('\\') + 1);
        var member = new GroupMember { Name = Environment.MachineName + "\\" + account.Name };
        status = NetLocalGroupAddMembers(null, users, 3, ref member, 1);
        if (status != 0 && status != 1378) Status(status); // Already in normal Users group is equivalent.
        Evidence.Add(new { stage = "provisioned", sid = account.Sid });
        return account;
    }
    static void Rule(DirectorySecurity acl, string sid, FileSystemRights rights) {
        acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid), rights,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
    }
    static void DirectoryAcl(string path, Account writable) {
        var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(true, false);
        Rule(acl, WindowsIdentity.GetCurrent().User.Value, FileSystemRights.FullControl);
        Rule(acl, "S-1-5-18", FileSystemRights.FullControl); Rule(acl, "S-1-5-32-544", FileSystemRights.FullControl);
        if (writable == null) foreach (var account in Accounts) Rule(acl, account.Sid, FileSystemRights.ReadAndExecute);
        else Rule(acl, writable.Sid, FileSystemRights.FullControl);
        Directory.CreateDirectory(path, acl);
    }
    static void MakeJob() {
        Job = CreateJobObject(IntPtr.Zero, null); Native(Job != IntPtr.Zero);
        var limits = new ExtendedLimits { Basic = new Limits { Flags = 0x2000 } }; // KILL_ON_JOB_CLOSE
        int size = Marshal.SizeOf(typeof(ExtendedLimits)); var pointer = Marshal.AllocHGlobal(size);
        try { Marshal.StructureToPtr(limits, pointer, false); Native(SetInformationJobObject(Job, 9, pointer, (uint)size)); }
        finally { Marshal.FreeHGlobal(pointer); }
    }
    static Actor Launch(Account account) {
        var start = new ProcessStartInfo(Path.Combine(Root, "node.exe"), "\"" + Path.Combine(Root, @"scripts\acceptance\0.1.x\windows-standard-users-actor.mjs") + "\" " + account.Sid) {
            UseShellExecute = false, UserName = account.Name, Domain = Environment.MachineName, Password = account.Password,
            LoadUserProfile = true, CreateNoWindow = true, WorkingDirectory = Root,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        };
        // No GitHub tokens, runner credentials or parent environment reach actors.
        start.EnvironmentVariables.Clear();
        start.EnvironmentVariables["SystemRoot"] = Environment.GetEnvironmentVariable("SystemRoot");
        start.EnvironmentVariables["WINDIR"] = Environment.GetEnvironmentVariable("SystemRoot");
        start.EnvironmentVariables["TEMP"] = account.Temporary; start.EnvironmentVariables["TMP"] = account.Temporary;
        var actor = new Actor { Account = account }; Actors.Add(actor);
        actor.Process = Process.Start(start);
        // The actor waits on stdin; no descendants exist before assignment.
        Native(AssignProcessToJobObject(Job, actor.Process.Handle));
        actor.Process.ErrorDataReceived += (sender, args) => { }; actor.Process.BeginErrorReadLine();
        return actor;
    }
    static Dictionary<string, object> Step(Actor actor, string type, string address = null, string allowedSid = null) {
        Stage = type; var result = actor.Send(type, address, allowedSid);
        Evidence.Add(new { stage = type, sid = actor.Account.Sid, result = result }); return result;
    }
    static void Snapshot(Actor owner, int expected, int expectedPid) {
        var value = Step(owner, "snapshot"); Require(Convert.ToInt32(value["connections"]) == expected, "Unexpected Node dispatch count");
        var peers = (System.Collections.IList)value["peers"];
        foreach (Dictionary<string, object> peer in peers) Require((string)peer["sid"] == owner.Account.Sid, "Foreign SID reached Node");
        if (expectedPid != 0) Require(Convert.ToInt32(((Dictionary<string, object>)peers[peers.Count - 1])["pid"]) == expectedPid, "Authenticated client PID mismatch");
    }
    static void Round(Account ownerAccount, Account foreignAccount) {
        Stage = "credentialed-launch";
        var owner = Launch(ownerAccount); var client = Launch(ownerAccount); var foreign = Launch(foreignAccount);
        Step(owner, "attest"); Step(client, "attest"); Step(foreign, "attest");
        string pipe = Pipe(), spoof = Pipe();
        var listening = Step(owner, "listen", pipe);
        var exchange = Step(client, "exchange", pipe); Snapshot(owner, 1, Convert.ToInt32(exchange["helperPid"]));
        var inspect = Step(client, "inspect", pipe);
        Require(Convert.ToInt32(((Dictionary<string, object>)inspect["serverToken"])["pid"]) == Convert.ToInt32(listening["helperPid"]), "Native server PID mismatch");
        Snapshot(owner, 2, Convert.ToInt32(((Dictionary<string, object>)inspect["token"])["pid"]));
        var denied = Step(foreign, "deny", pipe); Require(Convert.ToInt32(denied["win32Error"]) == 5, "Native foreign-user denial missing");
        Snapshot(owner, 2, 0);
        exchange = Step(client, "exchange", pipe); Snapshot(owner, 3, Convert.ToInt32(exchange["helperPid"]));
        Step(foreign, "spoof", spoof, ownerAccount.Sid);
        Step(owner, "listenRejected", spoof);
        Step(client, "rejectSpoof", spoof);
        Step(foreign, "finishSpoof"); Snapshot(owner, 3, 0);
        Stage = "normal-shutdown"; owner.Stop(); client.Stop(); foreign.Stop();
        Evidence.Add(new { stage = "round-completed", ownerSid = ownerAccount.Sid, foreignSid = foreignAccount.Sid });
    }
    static uint Active() {
        Accounting info; Native(QueryInformationJobObject(Job, 1, out info, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero)); return info.Active;
    }
    static bool Cleanup() {
        // Before any Launch attempt, there cannot be an owned child even if
        // querying a newly-created Job fails during a preflight error.
        bool clean = true, drained = Actors.Count == 0;
        Stage = "cleanup-owned-processes";
        try {
            if (Job != IntPtr.Zero) {
                if (Active() != 0) Native(TerminateJobObject(Job, 1));
                var deadline = Stopwatch.StartNew(); while (Active() != 0 && deadline.ElapsedMilliseconds < 15000) Thread.Sleep(50);
                drained = Active() == 0; Require(drained, "Owned process termination unconfirmed");
            }
        } catch (Exception error) { Evidence.Add(Failure(error)); clean = false; }
        foreach (var actor in Actors) {
            // A failed assignment leaves only the input-waiting direct child.
            try { if (actor.Process != null && !actor.Process.HasExited) { actor.Process.Kill(); Require(actor.Process.WaitForExit(10000), "Direct child termination unconfirmed"); } }
            catch (Exception error) { Evidence.Add(Failure(error)); clean = false; drained = false; }
            try { actor.Dispose(); } catch (Exception error) { Evidence.Add(Failure(error)); clean = false; }
        }
        if (Job != IntPtr.Zero) { CloseHandle(Job); Job = IntPtr.Zero; }
        OwnedProcessesExited = drained;
        foreach (var account in Accounts) {
            if (account.Created && drained) {
                Stage = "cleanup-profile";
                try {
                    if (account.Sid != null) {
                        string key = @"SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\" + account.Sid;
                        bool exists; using (var profile = Registry.LocalMachine.OpenSubKey(key)) exists = profile != null;
                        if (exists) Native(DeleteProfile(account.Sid, null, null));
                        using (var profile = Registry.LocalMachine.OpenSubKey(key)) Require(profile == null, "Profile still registered");
                    }
                } catch (Exception error) { Evidence.Add(Failure(error)); clean = false; }
                Stage = "cleanup-account";
                try { Status(NetUserDel(null, account.Name)); Absent(account.Name); Evidence.Add(new { stage = "account-removed", sid = account.Sid }); }
                catch (Exception error) { Evidence.Add(Failure(error)); clean = false; }
            } else if (account.Created) clean = false;
            try { account.Dispose(); } catch (Exception error) { Evidence.Add(Failure(error)); clean = false; }
        }
        Stage = "cleanup-fixtures";
        try { if (Root != null && Directory.Exists(Root) && drained) Directory.Delete(Root, true); else if (!drained) clean = false; }
        catch (Exception error) { Evidence.Add(Failure(error)); clean = false; }
        Evidence.Add(new { stage = "cleanup-completed", success = clean, ownedProcessesExited = drained });
        OwnedProcessesExited = drained;
        CleanupFinished = true;
        return clean;
    }
    public static int Run(string source, string node, string sourceCommit) {
        Require(!Started, "Account acceptance may only run once"); Started = true;
        bool passed = false, clean;
        try {
            Preflight(source, node);
            Stage = "prepare-owned-job"; MakeJob();
            Stage = "provision-A"; var a = Provision("a"); Stage = "provision-B"; var b = Provision("b");
            Require(a.Sid != b.Sid, "Expected distinct local SIDs");
            Stage = "prepare-fixtures";
            Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "IvoraigeAcceptance-" + Guid.NewGuid().ToString("N"));
            DirectoryAcl(Root, null);
            foreach (var account in Accounts) { account.Temporary = Path.Combine(Root, account.Sid); DirectoryAcl(account.Temporary, account); }
            foreach (string relative in Files) {
                string destination = Path.Combine(Root, relative); Directory.CreateDirectory(Path.GetDirectoryName(destination)); File.Copy(Path.Combine(source, relative), destination);
            }
            File.Copy(node, Path.Combine(Root, "node.exe"));
            Round(a, b); Round(b, a);
            Require(Active() == 0, "Descendants remained after normal shutdown"); passed = true;
        } catch (Exception error) { Evidence.Add(Failure(error)); }
        finally { clean = Cleanup(); }
        Console.WriteLine(Json.Serialize(new { sourceCommit = sourceCommit, osVersion = Environment.OSVersion.Version.ToString(),
            accountAcceptancePassed = passed && clean, provisioningAttempted = Accounts.Count != 0,
            createdAccountCount = Accounts.FindAll(account => account.Created).Count, cleanupSucceeded = clean, evidence = Evidence }));
        return passed && clean ? 0 : 1;
    }
}
