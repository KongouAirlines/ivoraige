// Explicitly opt-in, disposable-runner service scope. Never application code.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

internal sealed class SecondaryLogonState {
    internal uint Status, StartType;
    internal bool DelayedAutoStart;
    internal string ConfigurationHash;
}
internal interface ISecondaryLogonControl {
    SecondaryLogonState Read();
    void Start();
    void Stop();
    void WaitFor(uint status);
}

public sealed class SecondaryLogonLease {
    readonly ISecondaryLogonControl service;
    readonly SecondaryLogonState initial;
    readonly bool emit;
    bool startAttempted, startAccepted, restoreStopped, stopAttempted, restored;
    public string CurrentStage { get; private set; }
    internal SecondaryLogonLease(ISecondaryLogonControl service, bool emit) {
        this.service = service; this.emit = emit;
        CurrentStage = "secondary-logon-capture";
        initial = service.Read();
        Record("captured", initial, false, null);
        // Never enable a disabled service or try to complete someone else's
        // pending/paused transition. Only normal auto/manual configuration is
        // eligible; this scope does not change startup configuration.
        Require(initial.StartType == 2 || initial.StartType == 3, "Unsupported service startup configuration");
        Require(initial.Status == 1 || initial.Status == 4, "Service state is not stable");
    }
    public static SecondaryLogonLease Capture() { return new SecondaryLogonLease(new NativeSecondaryLogon(), true); }
    static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    void SameConfiguration(SecondaryLogonState value) {
        Require(value.StartType == initial.StartType && value.DelayedAutoStart == initial.DelayedAutoStart &&
            value.ConfigurationHash == initial.ConfigurationHash, "Service startup configuration changed");
    }
    void Record(string phase, SecondaryLogonState value, bool success, Exception error) {
        if (!emit) return;
        Console.WriteLine(new JavaScriptSerializer().Serialize(new {
            stage = CurrentStage, service = "seclogon", phase = phase,
            initialStatus = initial == null ? value.Status : initial.Status,
            status = value == null ? 0 : value.Status,
            startType = initial == null ? value.StartType : initial.StartType,
            delayedAutoStart = initial == null ? value.DelayedAutoStart : initial.DelayedAutoStart,
            startupConfigurationHash = initial == null ? value.ConfigurationHash : initial.ConfigurationHash,
            observedStartType = value == null ? 0 : value.StartType,
            observedStartupConfigurationHash = value == null ? null : value.ConfigurationHash,
            configurationUnchanged = value != null && initial != null && value.ConfigurationHash == initial.ConfigurationHash,
            startAttempted = startAttempted, startAccepted = startAccepted, stopAttempted = stopAttempted,
            success = success, errorType = error == null ? null : error.GetType().Name,
            win32Error = error is Win32Exception ? ((Win32Exception)error).NativeErrorCode : 0
        }));
    }
    public void EnsureRunning(bool allowStartAndRestore) {
        CurrentStage = "secondary-logon-start";
        var current = service.Read(); SameConfiguration(current);
        Require(current.Status == initial.Status, "Service state changed after capture");
        if (current.Status == 4) { Record("already-running", current, true, null); return; }
        if (!allowStartAndRestore) throw new Win32Exception(1062, "Secondary Logon is stopped and start was not enabled for this run");
        Require(!startAttempted, "Service start must not be retried");
        // Restoration intent precedes the operation: an API failure/timeout
        // may still leave the service Running. Finally observes actual state.
        restoreStopped = true; startAttempted = true;
        service.Start(); startAccepted = true;
        // Only our own accepted start may have a bounded StartPending phase.
        service.WaitFor(4);
        current = service.Read(); SameConfiguration(current);
        Require(current.Status == 4, "Service did not reach Running");
        Record("running", current, true, null);
    }
    public bool Restore(bool ownedProcessesExitedAndCleanupFinished) {
        CurrentStage = "secondary-logon-restore";
        SecondaryLogonState current = null;
        try {
            Require(!restored, "Service restoration must not be retried"); restored = true;
            current = service.Read(); SameConfiguration(current);
            // Even a preflight/test failure must reach this finally. If process
            // exit is unconfirmed, do not stop a service those children use.
            Require(ownedProcessesExitedAndCleanupFinished, "Owned child exit or cleanup completion is unconfirmed");
            Require(current.Status == 1 || current.Status == 4, "Service restoration found an unexpected/pending state");
            if (initial.Status == 1 && current.Status == 4) {
                // Intent alone is insufficient after an uncertain/denied
                // StartService call: Running could belong to another start.
                // Only an accepted start can be undone by this scope. We
                // never retry Start or blindly stop an ambiguous transition.
                Require(restoreStopped && startAccepted, "The running transition was not confirmed as this scope's start");
                stopAttempted = true;
                service.Stop(); service.WaitFor(1);
            }
            // An initially Running service is never stopped by this scope. If
            // it unexpectedly stopped, report instead of issuing a new start.
            current = service.Read(); SameConfiguration(current);
            Require(current.Status == initial.Status, "Original service status was not restored");
            Record("restored", current, true, null); return true;
        } catch (Exception error) { Record("restoration-failed", current, false, error); return false; }
    }
}

internal sealed class NativeSecondaryLogon : ISecondaryLogonControl {
    sealed class ServiceHandle : SafeHandleZeroOrMinusOneIsInvalid {
        public ServiceHandle() : base(true) { }
        protected override bool ReleaseHandle() { return CloseServiceHandle(handle); }
    }
    [StructLayout(LayoutKind.Sequential)] struct ServiceStatus {
        public uint Type, State, Accepted, Win32Exit, SpecificExit, Checkpoint, WaitHint, ProcessId, Flags;
    }
    [StructLayout(LayoutKind.Sequential)] struct ServiceConfig {
        public uint Type, StartType, ErrorControl;
        public IntPtr Binary, Group;
        public uint Tag;
        public IntPtr Dependencies, Account, DisplayName;
    }
    [StructLayout(LayoutKind.Sequential)] struct BasicStatus {
        public uint Type, State, Accepted, Win32Exit, SpecificExit, Checkpoint, WaitHint;
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern ServiceHandle OpenSCManager(string machine, string database, uint access);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern ServiceHandle OpenService(ServiceHandle manager, string name, uint access);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool CloseServiceHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool QueryServiceStatusEx(ServiceHandle service, int level, out ServiceStatus status, uint size, out uint needed);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryServiceConfig(ServiceHandle service, IntPtr data, uint size, out uint needed);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryServiceConfig2(ServiceHandle service, uint level, IntPtr data, uint size, out uint needed);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool StartService(ServiceHandle service, uint count, IntPtr arguments);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool ControlService(ServiceHandle service, uint control, out BasicStatus status);
    static void Check(bool value) { if (!value) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static ServiceHandle Open(string name, uint access) {
        using (var manager = OpenSCManager(null, null, 1)) {
            Check(!manager.IsInvalid); var service = OpenService(manager, name, access);
            if (service.IsInvalid) { int error = Marshal.GetLastWin32Error(); service.Dispose(); throw new Win32Exception(error); }
            return service;
        }
    }
    static uint Status(ServiceHandle service) {
        ServiceStatus value; uint needed;
        Check(QueryServiceStatusEx(service, 0, out value, (uint)Marshal.SizeOf(typeof(ServiceStatus)), out needed)); return value.State;
    }
    static string Text(IntPtr value) { return value == IntPtr.Zero ? "" : Marshal.PtrToStringUni(value); }
    static string[] Strings(IntPtr value) {
        var values = new System.Collections.Generic.List<string>();
        if (value != IntPtr.Zero) for (var entry = value; Marshal.ReadInt16(entry) != 0;) {
            string text = Marshal.PtrToStringUni(entry); values.Add(text); entry = IntPtr.Add(entry, (text.Length + 1) * 2);
        }
        return values.ToArray();
    }
    static object Configuration(ServiceHandle service, out uint startType, out bool delayed, out string[] dependencies) {
        uint needed;
        bool measured = QueryServiceConfig(service, IntPtr.Zero, 0, out needed);
        if (measured || Marshal.GetLastWin32Error() != 122 || needed == 0) throw new InvalidOperationException("Service configuration size unavailable");
        var data = Marshal.AllocHGlobal((int)needed);
        try {
            Check(QueryServiceConfig(service, data, needed, out needed));
            var value = (ServiceConfig)Marshal.PtrToStructure(data, typeof(ServiceConfig));
            startType = value.StartType; dependencies = Strings(value.Dependencies);
            var extra = Marshal.AllocHGlobal(4);
            try { Check(QueryServiceConfig2(service, 3, extra, 4, out needed)); delayed = Marshal.ReadInt32(extra) != 0; }
            finally { Marshal.FreeHGlobal(extra); }
            return new { type = value.Type, startType = value.StartType, errorControl = value.ErrorControl,
                binary = Text(value.Binary), group = Text(value.Group), tag = value.Tag,
                dependencies = dependencies, account = Text(value.Account), displayName = Text(value.DisplayName), delayedAutoStart = delayed };
        } finally { Marshal.FreeHGlobal(data); }
    }
    public SecondaryLogonState Read() {
        using (var service = Open("seclogon", 1 | 4)) {
            uint startType; bool delayed; string[] dependencies;
            var config = Configuration(service, out startType, out delayed, out dependencies);
            string serialized = new JavaScriptSerializer().Serialize(config);
            using (var hash = SHA256.Create()) return new SecondaryLogonState { Status = Status(service), StartType = startType,
                DelayedAutoStart = delayed, ConfigurationHash = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(serialized))).Replace("-", "").ToLowerInvariant() };
        }
    }
    public void Start() {
        using (var service = Open("seclogon", 1 | 4 | 0x10)) {
            if (Status(service) != 1) throw new InvalidOperationException("Service start state changed");
            uint startType; bool delayed; string[] dependencies;
            Configuration(service, out startType, out delayed, out dependencies);
            if (startType != 2 && startType != 3) throw new InvalidOperationException("Service startup configuration is no longer eligible");
            // StartService may start dependencies. Require them already running
            // so this scope cannot intentionally start any other service.
            foreach (string name in dependencies) {
                if (name.StartsWith("+")) throw new InvalidOperationException("Service-group dependency is outside this scope");
                using (var dependency = Open(name, 4)) if (Status(dependency) != 4) throw new InvalidOperationException("Service dependency is not already Running");
            }
            Check(StartService(service, 0, IntPtr.Zero));
        }
    }
    public void Stop() {
        using (var service = Open("seclogon", 4 | 0x20)) {
            if (Status(service) != 4) throw new InvalidOperationException("Service stop state changed");
            BasicStatus status;
            // Unlike ServiceController.Stop(), this sends STOP only to this
            // service; dependent services are not recursively stopped.
            Check(ControlService(service, 1, out status));
        }
    }
    public void WaitFor(uint desired) {
        uint pending = desired == 4 ? 2u : 3u;
        var time = Stopwatch.StartNew();
        using (var service = Open("seclogon", 4)) for (;;) {
            uint value = Status(service);
            if (value == desired) return;
            if (value != pending) throw new InvalidOperationException("Unexpected service transition");
            if (time.ElapsedMilliseconds >= 30000) throw new TimeoutException("Service transition not confirmed");
            Thread.Sleep(100);
        }
    }
}

// Pure state-machine checks. No native service/account calls and no credentials.
public static class SecondaryLogonLeaseChecks {
    sealed class Fake : ISecondaryLogonControl {
        internal uint Status = 1, StartType = 3;
        internal string Hash = "unchanged";
        internal bool DenyStart, DenyStop, FailStartWait, UncertainStart, ChangeConfigurationOnStop;
        internal int Starts, Stops;
        public SecondaryLogonState Read() { return new SecondaryLogonState { Status = Status, StartType = StartType, ConfigurationHash = Hash }; }
        public void Start() { Starts++; if (UncertainStart) { Status = 4; throw new Win32Exception(1053); } if (DenyStart) throw new Win32Exception(5); Status = 4; }
        public void Stop() { Stops++; if (DenyStop) throw new Win32Exception(5); Status = 1; if (ChangeConfigurationOnStop) Hash = "changed"; }
        public void WaitFor(uint value) { if (value == 4 && FailStartWait) throw new TimeoutException(); if (Status != value) throw new InvalidOperationException(); }
    }
    static void Check(bool value) { if (!value) throw new InvalidOperationException("Service lease self-check failed"); }
    static void Fails(Action action) { bool failed = false; try { action(); } catch { failed = true; } Check(failed); }
    public static void Run() {
        var a = new Fake(); var lease = new SecondaryLogonLease(a, false); lease.EnsureRunning(true);
        Check(lease.Restore(true) && a.Starts == 1 && a.Stops == 1 && a.Status == 1);
        a = new Fake { Status = 4 }; lease = new SecondaryLogonLease(a, false); lease.EnsureRunning(true);
        Check(lease.Restore(true) && a.Starts == 0 && a.Stops == 0);
        a = new Fake(); lease = new SecondaryLogonLease(a, false); Fails(() => lease.EnsureRunning(false)); Check(lease.Restore(true) && a.Starts == 0);
        a = new Fake { Status = 2 }; Fails(() => new SecondaryLogonLease(a, false)); Check(a.Starts == 0);
        a = new Fake { StartType = 4 }; Fails(() => new SecondaryLogonLease(a, false)); Check(a.Starts == 0);
        a = new Fake { DenyStart = true }; lease = new SecondaryLogonLease(a, false); Fails(() => lease.EnsureRunning(true));
        Fails(() => lease.EnsureRunning(true)); // No retry after a denied start.
        Check(lease.Restore(true) && a.Starts == 1 && a.Stops == 0);
        a = new Fake { UncertainStart = true }; lease = new SecondaryLogonLease(a, false); Fails(() => lease.EnsureRunning(true));
        Check(!lease.Restore(true) && a.Starts == 1 && a.Stops == 0);
        a = new Fake { FailStartWait = true }; lease = new SecondaryLogonLease(a, false); Fails(() => lease.EnsureRunning(true));
        Check(lease.Restore(true) && a.Stops == 1); // Accepted start, then preflight/test failure.
        a = new Fake(); lease = new SecondaryLogonLease(a, false); lease.EnsureRunning(true);
        Check(!lease.Restore(false) && a.Stops == 0); // Never stop before child exit.
        a = new Fake(); lease = new SecondaryLogonLease(a, false); lease.EnsureRunning(true); a.Hash = "changed";
        Check(!lease.Restore(true) && a.Stops == 0);
        a = new Fake { DenyStop = true }; lease = new SecondaryLogonLease(a, false); lease.EnsureRunning(true);
        Check(!lease.Restore(true) && a.Stops == 1); Check(!lease.Restore(true) && a.Stops == 1);
        a = new Fake(); lease = new SecondaryLogonLease(a, false); lease.EnsureRunning(true); a.Status = 2;
        Check(!lease.Restore(true) && a.Stops == 0);
        a = new Fake { Status = 4 }; lease = new SecondaryLogonLease(a, false); lease.EnsureRunning(true); a.Status = 1;
        Check(!lease.Restore(true) && a.Starts == 0); // No repair of an unrelated transition.
        a = new Fake { ChangeConfigurationOnStop = true }; lease = new SecondaryLogonLease(a, false); lease.EnsureRunning(true);
        Check(!lease.Restore(true) && a.Stops == 1 && a.Status == 1);
        Console.WriteLine("{\"stage\":\"secondary-logon-state-checks\",\"passed\":true,\"cases\":14}");
    }
}
