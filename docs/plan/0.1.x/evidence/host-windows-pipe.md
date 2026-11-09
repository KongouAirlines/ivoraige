# Windows owner pipe security boundary

Date: 2026-11-09. This change implements the Windows transport boundary for
D01.H01–H05. Native results must be tied to the tested commit below; neither
source inspection nor Linux compatibility tests establish Windows acceptance.

## Implementation and compatibility

`src/host-windows-pipe.mjs` uses one Windows PowerShell 5.1/.NET Framework helper
per Node process. The helper owns only native handles and byte transport. Node
still owns HostControl schemas, one-request connections, generation checks,
capability checks, admission and finalization receipts. `HostControl@1` minor 0,
`pipe-capability` discovery records and the protected per-generation capability
file remain compatible. POSIX retains its existing private Unix socket path.
There is no Node, DSH, Cordis, storage schema or PDF runtime migration.
An upgraded client deliberately refuses a still-running older owner whose pipe
lacks the required native boundary. Stop that owner normally before switching
builds; retaining frame compatibility does not waive the security checks.

The implementation requires built-in Windows PowerShell and .NET Framework
with `Add-Type` permitted. It does not change script execution policy, fetch a
binary, create accounts, request elevation, or open a loopback TCP substitute.
If the helper is absent, prohibited, unable to establish its boundary, or exits,
the channels fail closed. The source helper ships inside the existing `src/`
package inclusion. One helper is shared instead of compiling on every request;
idle helpers close, inherited-stdin EOF closes native handles, and bounded
shutdown terminates an unresponsive owned helper.

## Native checks

- `CreateNamedPipe` receives an explicit protected DACL with one current-user
  SID allow ACE and an explicit current-user owner. `GetSecurityInfo` verifies
  that descriptor on the created handle before advertising readiness.
- `FILE_FLAG_FIRST_PIPE_INSTANCE` rejects an already-owned pipe name. A pending
  listener remains open while clients are served. `PIPE_REJECT_REMOTE_CLIENTS`
  refuses remote connections, independently of the random name and capability.
- After reading the first byte, `ImpersonateNamedPipeClient` identifies the
  actual connected client's token. Its `TokenUser` must match the owner SID
  before Node receives a connection or any request bytes. Reversion is checked
  on the same thread before asynchronous work resumes.
- The client checks owner and exact protected DACL on its connected handle,
  obtains the actual pipe server PID and checks that process's token SID before
  sending any HostControl data. `SECURITY_IDENTIFICATION` SQOS limits the
  server to identifying the client, not acting on its behalf.
- Native peers, first-byte deadlines, frame sizes, queued helper traffic and
  shutdown/drain waits are bounded. Helper exceptions and received frames are
  not forwarded to logs. Unexpected helper loss invalidates its owned channels.

Administrators/SYSTEM that can take ownership or inspect another process are
outside this ordinary OS-user isolation boundary. The transport does not claim
isolation from a malicious process already running as the same user.

Microsoft documents the [named-pipe impersonation rules](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-impersonatenamedpipeclient)
and [client SQOS control](https://learn.microsoft.com/en-us/windows/win32/ipc/impersonating-a-named-pipe-client).
Identification-level or same-identity impersonation does not require granting
the server `SeImpersonatePrivilege`; the native test below also removes that
privilege from a disposable test process and its children.

## Tests and observed evidence

`test/host-windows-pipe.test.mjs` supplies native Windows checks for:

1. Independent descriptor inspection and same-user exchange, including the
   server's actual peer SID/PID.
2. Connection refusal for the real anonymous `TokenUser` SID `S-1-5-7`, with
   native `ERROR_ACCESS_DENIED` before Node dispatch.
3. A deliberately permissive substitute server receiving no client frame.
4. First-instance collision refusal.
5. Ordered multiple frames and active-channel invalidation after helper death.
6. Same-SID operation after removing `SeImpersonatePrivilege` from a disposable
   subprocess token and verifying removal with `GetTokenInformation`.
7. Bounded queued traffic while the helper starts.
8. Independent built-in .NET Framework compilation diagnostics.
9. Retired pipe connections retain `CONFLICT/owner-unreachable`.

The tests use only synthetic bytes. They do not create accounts, modify OS
security policy or change another process's token. Anonymous rejection is not
evidence of a separate ordinary logged-in account, and privilege removal from
an elevated runner is not evidence of a fully unelevated standard-user token.

Local Linux / Node 24.22.1, core commit `07339e2`: JavaScript syntax checks
passed. Focused owner-integration/transport suites reported 3 passed, 10 skipped,
zero failed. Three skips were actual sandbox Unix-bind denials, even after an
execution-permission request; seven were Windows-only probes. The container has
no Windows runtime or C# compiler.

Native Windows / Node 26.13.0 at foundation head `702cedb`: the original
seven native checks above all passed, including actual anonymous SID readback,
kernel denial, descriptor/token verification and reduced-privilege exchange.
The complete foundation suite reported 593 tests, 590 passed, 3 platform skips,
zero failures. Its 91-file package smoke also passed, but that foundation slice
does not yet activate the A3 installed owner entry paths. [Native evidence](https://github.com/KongouAirlines/ivoraige/actions/runs/42558967671/job/128970927080).
The later compile and retired-pipe tests need their own published-head results.

Final-head native checks, A3 installed owner execution, a separate regular user
and a fully unelevated user remain acceptance gates until recorded.
A separate-account probe requires an already-provisioned test account or explicit
authorization to create, use and delete one on a disposable Windows runner. No
account-management action is performed by this test suite.
