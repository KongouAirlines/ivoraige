# One-time Windows standard-user pipe acceptance

This opt-in harness checks the actual native pipe adapter under two distinct,
ordinary local Windows accounts. It is not part of `npm test`, package scripts,
or regular CI. The adjacent workflow is an inactive `.example`, not an installed
workflow. Native results are tied to the exact tested source. The service-scope
extension below remains unexecuted during local preparation; Linux syntax and
source checks are not native acceptance.

## Scope and prerequisites

The run needs a disposable, elevated GitHub Windows runner to provision exactly
two temporary accounts. The owner/client processes themselves must have distinct
`TokenUser` SIDs, medium integrity, `TokenElevation = 0`, default (not UAC-filtered)
elevation type, no Administrators group even as deny-only, and no enabled
`SeImpersonatePrivilege`. The credentials are generated in the runner's memory
and passed via the Windows credentialed process API, never command arguments,
environment variables, files or logs. Actor environments exclude runner secrets.

Before creating accounts, the script validates the exact source and integrated
product commits, syntax-checks the Node actor, compiles the C# fixtures and actual
production helper, runs service-state checks against fake controls, and checks
local account API access. It creates/configures the owned kill-on-close Job before
provisioning either account. Denied credentialed launch, restricted compilation,
unsupported tokens or missing APIs fail the run. There is no privilege-enabling,
logon-rights or execution-policy fallback. The account test creates only its two
standard Users-group memberships and fixture ACLs.

Secondary Logon must be Running before provisioning. The separate explicit
`-StartSecondaryLogonAndRestore` switch permits one controlled start from Stopped
on this disposable runner and restoration afterward. It requires
`-ProvisionStandardAccounts`; a compile-only invocation cannot start a service.
The inactive workflow template includes this switch for the scoped acceptance.
Without it, a stopped service still fails with 1062 rather than starting silently.

Account creation, credentialed launches, fixture permissions and deletion of the
generated accounts/profiles require approval for this single disposable run.
A preflight failure occurs before account creation. Once provisioning starts,
there is no automatic retry, workflow rerun, reset-and-push or second account run.
A denied, partial or uncertain outcome must be reviewed before any further action.

## Secondary Logon service scope

Before mutation, the wrapper records `seclogon`'s original stable status, startup
type, delayed-auto-start flag and a SHA-256 digest of the complete
`QueryServiceConfig` startup configuration plus delayed-auto-start setting. It
uses read-only configuration queries throughout; it never changes startup type,
service accounts, policy, privileges or registry values. Disabled, pending,
paused or unexpected initial states fail before any start/account operation.

- An initially Running service is left untouched and must still be Running with
  identical configuration afterward. An unexpected stop is reported, not repaired
  with a new start.
- An initially Stopped service can receive one `StartService` request only with
  the explicit switch. Named dependencies must already be Running; service-group
  dependencies are rejected. The wrapper does not deliberately start other
  services. Its own accepted StartPending transition is bounded to 30 seconds.
- An outer PowerShell `finally` runs after the account harness's inner cleanup,
  including on preflight/test failure. Only after owned-process exit is verified
  and all cleanup attempts finish may a service started by this scope receive
  one restore STOP. Account/profile/file cleanup failure does not suppress this
  restoration when child exit is known. Unconfirmed child exit blocks STOP.
- Restoration uses `ControlService` on `seclogon` alone, not a recursive stop of
  dependents. Its own StopPending transition is bounded to 30 seconds; final
  status and startup configuration must match the original capture.
- A thrown/denied Start followed by observed Running is ambiguous. It does not
  prove this scope started the service, so there is no blind STOP or Start retry.
  An accepted Start followed by a wait/test failure may be restored once if it is
  stably Running. Unexpected/pending states, config changes, denied STOP or
  unconfirmed restoration are reported as failures with no automatic repair.

The runner's `accountAcceptancePassed` field covers account tests and their
cleanup only. The aggregate `acceptance-final.passed` record is emitted **after**
service restoration; a restoration failure makes it false and exits nonzero.
A hard runner/process termination cannot guarantee a finally block runs. Missing
final cleanup/restoration evidence must be treated as an incomplete run, not a
pass; this harness is restricted to a disposable GitHub runner for that reason.

## Exact one-time source and trigger

Use the newest integrated A3 product commit **P**, not an older transport worktree.
Apply only this harness directory on top. Prepare a final commit **H** containing
the active one-time workflow, with its product SHA and unique branch placeholders
replaced. Do not change the product transport as part of harness preparation.

1. Review and agree the unique isolated branch name, **P**, the complete workflow
   and exact final commit/tree **H** before the branch action. Create the unique
   branch directly at **H** once; do not first create a base branch and update it.
2. The workflow permits account provisioning only for `event.created = true`,
   an all-zero `event.before`, and `run_attempt = 1`. The script rechecks these
   values, exact ref, `event.after = GITHUB_SHA`, and the actual checkout SHA.
   It also verifies production transport files against pinned **P**. Record **H**
   as both the trigger and tested source commit.
3. If GitHub does not emit that expected branch-creation push, report not-run.
   Do not change the trigger, reset/recreate the branch or rerun the workflow.
   A later push has `created = false`, and a rerun has attempt > 1; neither can
   provision accounts.
4. Read the complete result, including cleanup. Remove the active one-time
   workflow with a subsequent commit and leave the inert branch for evidence.
   Do not merge an active provisioning workflow into a product branch. The
   opt-in fixtures and inactive template may remain as reproducible source.

The exact final commit/tree is verified before the create-at-SHA action; the
workflow cannot embed its own self-referential commit hash. The source checks,
first-creation gate and unique ref all apply together. No accounts are created
by merely adding these inactive fixture files.

## Assertions

Each round starts independent credentialed Node owner, same-user client, and
foreign-user actors. A/B roles are then exchanged in the same provisioned run.
Every actor and native helper/probe is checked through its actual process token.

- The actual same-user adapter exchange succeeds. The server's authenticated
  peer PID matches that separate client's native helper PID, and its SID matches
  the owner. A native inspection client confirms the server PID/token and exact
  handle-bound descriptor: current SID owner, protected DACL, one noninherited
  allow ACE for that SID, mask `0x1f01ff`.
- The foreign user opens the known pipe name directly with the production access
  mask/SQOS flags. Native `ERROR_ACCESS_DENIED` and an unchanged Node connection
  count are required. This isolates the pipe boundary from discovery-file access.
  The legitimate client must continue to work after the rejected attempt.
- A foreign-user substitute server intentionally grants the owner access. The
  actual adapter must refuse it before any payload; its server records zero bytes.
  Creating a first native instance at that preoccupied name must also fail closed.
- Normal shutdown must close the actor's native helpers and all owned processes.

The foreign-server case tests combined descriptor/foreign-server rejection. It
cannot independently isolate the server-PID rejection branch: an ordinary foreign
user cannot manufacture the required owner-SID descriptor. There is no privileged
fake-descriptor mutation. This is native adapter acceptance, not an independent
full HostControl, registry/store lifecycle or installed-package acceptance run.
The normal suite retains capability, generation and frame/finalization coverage.

## Cleanup and evidence

Actors wait on inherited stdin before spawning helpers, so the runner can assign
them to its own kill-on-close Windows Job first. Normal completion verifies helper
exit. Failure cleanup terminates only that Job or a direct, unassigned fixture
child whose handle it owns. It confirms process exit before removing generated
profiles/accounts. Profile deletion uses only those generated SIDs; account
removal is verified with the local account API. A failure does not trigger another
provisioning attempt. Cleanup success/failure is part of the result, not assumed.

Evidence contains source/trigger/product commits, source SHA-256 values, runtime
versions, synthetic SIDs, PIDs, token properties, native Win32 error numbers,
descriptor results, connection/byte counters and cleanup status. Native compilation
errors retain their source-only diagnostics before any credentials/accounts exist.
Post-provisioning raw exceptions, credentials, capability values, traffic and
inherited environments are excluded. Service evidence includes original/observed
startup-configuration hashes and status, accepted/requested start and stop flags,
restoration outcome, and the final aggregate result.

Prior run [42564258647](https://github.com/KongouAirlines/ivoraige/actions/runs/42564258647)
at `10df4c99` compiled the original harness, then failed at
`preflight-secondary-logon` with 1062 before `Run`, Job creation or `NetUserAdd`.
It created zero accounts and changed no service settings. That result does not
verify this service-scope extension or cross-account acceptance.

Local preparation checks cover actor syntax, template YAML, diff consistency and
source-level ordering/guard checks. The 14 fake-control service-state cases are
included in the Windows preflight, not claimed executed locally. The added C#
wrapper, real service start/restore and account execution still require their
one-time native result.
