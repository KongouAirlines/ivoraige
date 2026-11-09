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
with FullLanguage and `Add-Type` permitted. A fixed internal `-Command` bootstrap
loads only the packaged C# source with `-LiteralPath` at an escaped application path; no frame or
discovery field becomes command text. Unlike `-File`, this uses the commands
permitted by the stock Windows-client Restricted execution policy. It does not
supply an execution-policy override, unblock a script, change language mode,
fetch a binary, create accounts, request elevation, or open a TCP substitute.
ConstrainedLanguage, AppLocker and WDAC restrictions still apply. An organization
that prohibits this compilation needs an approved deployment; the application
fails rather than trying another execution route.
If the helper is absent, prohibited, unable to establish its boundary, or exits,
the channels fail closed. The source helper ships inside the existing `src/`
package inclusion. One helper is shared instead of compiling on every request;
idle helpers close and inherited-stdin EOF closes native handles. Listening
must be acknowledged within 25 seconds, including the 20-second startup limit;
closing must be acknowledged within 2 seconds. A missing acknowledgment fails
all channels of that owned helper and requests its termination. Close reports
an error, not success inferred from `kill()`. A later retry can verify closure
from a native close acknowledgment or an actual helper exit event. It never
terminates an unrelated process.

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
8. Retired pipes preserve `CONFLICT/owner-unreachable` rather than presenting a
   missing endpoint as a permission failure.
9. Independent compilation diagnostics against built-in .NET assemblies.
10. The actual adapter helper operating under Restricted policy inherited from
    a disposable PowerShell process, with no helper policy override, from an
    installation path containing brackets and an apostrophe.

`test/host-windows-pipe-broker.test.mjs` separately injects a fake child to check
lost listen/close acknowledgments, live-channel failure, failed or unconfirmed
termination, actual-exit recovery, and a healthy close acknowledgment. Those are
cross-platform JS lifecycle checks, not native security evidence.


The tests use only synthetic bytes. They do not create accounts, modify OS
machine/user security policy or change another process's token. The Restricted
acceptance test tightens execution policy only for its disposable process tree. Anonymous rejection is not
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

After the launcher/acknowledgment changes, the A3 worktree's full host-focused
command (`node --import ./test/fixtures/host-test-env.mjs --test test/host-*.test.mjs`)
on Linux / Node 24.22.1 reported 63 tests: 47 passed, 16 explicit platform/socket
skips, zero failures. This includes the three fake-helper acknowledgment tests;
it does not establish the unrun native Restricted-policy case.

Subsequent native Windows / Node 26.13.0 verification at foundation head
`c1b86730` passed 600 of 603 tests (3 platform skips), including the actual
Restricted-policy/literal-path test, and the 91-file foundation package smoke.
[Foundation job](https://github.com/KongouAirlines/ivoraige/actions/runs/42563331451/job/128984338865).

At entry-stack head `4882a83c`, Windows passed 627 of 630 tests (3 platform
skips), with zero failures or cancellations, and the 95-file installed owner
package smoke passed. [Entry job](https://github.com/KongouAirlines/ivoraige/actions/runs/42564141101/job/128986838448).
Linux and macOS also passed their full commands and installed-package smoke;
counts and boundaries are in the [entry evidence](host-owner-entries.md#native-stack-verification-at-4882a83c).
These results establish the native helper and installed owner paths at those
heads. They do not establish separate regular-account or fully unelevated
acceptance. The [scoped account run](https://github.com/KongouAirlines/ivoraige/actions/runs/42568044404)
remains queued as of 2026-11-09, with no test or cleanup result.

A separate-account probe requires an already-provisioned test account or explicit
authorization to create, use and delete one on a disposable Windows runner. No
account-management action is performed by this test suite.

The launcher choice follows Microsoft's [Windows PowerShell 5.1 execution-policy
contract](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1)
and preserves its [language-mode restrictions](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_language_modes?view=powershell-5.1).
Windows Server CI is not by itself evidence of stock Windows-client policy behavior.
