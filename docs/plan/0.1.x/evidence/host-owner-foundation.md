# Host owner and data-domain foundation

This layer implements the local ownership primitives for D01.H01–H05 and H10. It does not yet activate the public application bootstrap or the management page; the next stack layers connect the existing entries and lifecycle.

## Implemented boundaries

- A protected OS-user registry binds a canonical local store/file identity to the `ivoraige_host` v1 DSH StorageDomain. Existing document, revision, task and snapshot identifiers are retained.
- Registry-before-store locking, bounded registry contention retries, flushed recovery intents, atomic registry replacement, and verified intent replay prevent an interrupted initialization from silently allocating a second identity.
- Read-only discovery checks the recorded file identity. On Windows and for older registrations without creation time, it also checks the DSH domain and registration IDs through a read-only snapshot. Corrupt registrations, unsupported metadata and replacement files fail closed.
- Owner transport uses a private Unix socket, or a Windows named pipe with an exact current-user native DACL, connected-handle server identity checks and actual client TokenUser verification before dispatch. A private per-generation capability is an additional generation-bound check. Ephemeral owners publish only a refusal marker. HTTP instance ids and PIDs are not authentication.
- One-time browser bootstrap credentials are origin/domain/generation bound, replay protected, and held only in memory. Session cookies are HttpOnly/SameSite=Strict and writes require CSRF validation.

## Review hardening

Discovery publication and conditional removal now hold the same protected,
bounded registry lease. The lease spans the generation/address read and unlink,
so cleanup after store release cannot delete a replacement owner's record.
The regression probes that lease at each filesystem boundary and verifies that
late cleanup leaves the next generation discoverable.

Windows accept registers and arms each accepted peer under the listener gate
before close can enumerate peers and acknowledge shutdown. A native concurrent
accept/close stress case checks connected peers within one second of the close
acknowledgment, before the five-second unauthenticated-peer idle timer. This is
stress coverage, not a deterministic scheduler probe; its native Windows run
remains required.

Browser cookie names include a hash of the bound data domain and origin. Two
local owners on different ports therefore retain separate sessions even though
browser cookies are not port-scoped. Host-only, HttpOnly, SameSite=Strict, HTTPS
Secure/__Host- attributes and origin/CSRF checks are unchanged. HostControl@1,
API 2.0 and stored record, task, snapshot and domain identities are unchanged.

The discovery and browser-cookie regressions fail against their original
implementations and pass with these fixes. Linux / Node 24.22.1 focused domain
and transport checks passed 15 tests, with the socket-listen case skipped because
the environment rejects bind. Session, broker and permission checks also passed.
Native Windows peer-close stress and separate ordinary-account/fully unelevated
acceptance are not established by these Linux results.

With fresh `npm ci` dependencies, the complete Linux / Node 24.22.1 build and
test run passed: 606 tests, 587 passed, 19 conditional/platform skips, zero
failures. The isolated package smoke passed with 91 files, including reinstall,
persistence, frozen exports, MCP discovery/call and static UI. An initial run
using an older copied dependency cache failed the dependency-baseline checks;
that cache was replaced from the unchanged lockfile before these final checks.

## Recovery and validation limits

`copy` requires a distinct verified store and allocates a new domain/registration identity. `migrate` additionally requires trusted evidence that the source process retired; a free lock and a command-line confirmation do not supply that proof. `refresh-identity` updates only the file identity of a same-path store whose domainId and registrationId match the protected record, under both locks, confirmation and an exact diagnostic. It does not reconstruct a missing or unparseable multi-domain registry; without trustworthy backup and merge evidence that remains unavailable. These limits are deliberate fail-closed results, not completed migration/repair UX.

Metadata inspection uses SQLite's public backup API followed by the DSH domain API on a private temporary copy, without reading DSH private tables. Windows discovery needs this snapshot even when dev, inode and creation time match: the #88 Windows run at head `501aa66` accepted a replaced file under that identity check, consistent with NTFS file-system tunneling. The snapshot can copy a large database during discovery and can hold the registry lock longer in writer paths; large-library performance remains unverified.

The pinned DSH domain/backend close methods are explicitly awaited before context disposal. A close rejection keeps the store lease; root Cordis disposal alone is not evidence that storage closed.

## Observed checks

Linux, Node 24.22.1 compatibility runtime: domain initialization/reopen, canonical aliases, binding conflicts, corrupt registration, file replacement, copy, stale recovery preconditions, six-process registry contention, interrupted intent states and unsupported metadata were exercised by `test/host-domain.test.mjs`. Session expiry, replay, origin, CSRF and revocation were exercised by `test/host-session.test.mjs`. Transport framing/private-file tests are in `test/host-transport.test.mjs`.

The development container returns OS `EPERM` for Unix socket bind, including an isolated `node:net` probe. That one real handshake case is reported as skipped there, not passed. Native CI is needed to establish socket behavior and Windows DACL/MoveFileExW/file-identity behavior. The Windows implementation uses write-through atomic replacement; intent-file deletion may safely replay and is not claimed as a durable deletion guarantee. No BabelDOC, MinerU, Cordis or DSH version migration is included.

## Native CI follow-up

The first #88 CI head passed Linux but failed the new permission fixtures on
macOS and Windows. macOS uses the root-owned `/var` alias for temporary paths;
the permission helper now verifies both that alias's ownership and the resolved
ancestry instead of rejecting every alias. User-owned ancestor symlinks remain
rejected. Windows ACL construction now uses explicit .NET constructors and
retains the local subprocess cause for diagnostic evidence without exposing it
through the owner transport. Native reruns are required to accept these changes.

Later #88 CI at head `501aa66` passed macOS and Linux and all Windows cases
except the deterministic replaced-store assertion. The DSH metadata check for
Windows discovery addresses that observed gap; native validation of this fix
is pending.

## Windows helper lifecycle and current security evidence

Filesystem protection uses one bounded fixed-command Windows PowerShell helper
per Node process. Paths are JSON data, not command text. The helper atomically
creates private names and verifies all ancestor owners and effective replacement
rights. Only the current SID, SYSTEM, Administrators and the exact built-in
TrustedInstaller servicing SID are trusted for ancestors; private leaf ACLs keep
their stricter current-user/SYSTEM checks. An existing untrusted ACL is never
normalized. Ordinary create-subdirectory rights on a higher ancestor alone are
not treated as branch replacement rights.

Requests, frames and pending work are bounded. A timeout or protocol fault
reports failure, retains the referenced child and blocks replacement workers
until an actual exit event. A registry lock is retained across that uncertain
period, even after its API call has rejected. Neither a kill request nor a late
success frame proves that the old writer stopped. Fake-child regression tests
cover failed kill, late exit, late responses, deferred release and safe restart.
This protects normal cleanup, not arbitrary external forced process termination.

At native Windows head `7569ca96`, nine pipe security/lifecycle checks passed,
but the complete foundation suite failed: 601 tests, 579 passed, 19 failed and
3 platform skips. The ancestor policy rejected the default TrustedInstaller-owned
C: volume, and the Restricted-policy fixture depended on unavailable module
discovery. The follow-up trusts that exact servicing SID only for ancestors and
loads the policy-readback binary module by its strong-name assembly location.
Those fixes require their own native rerun; the earlier pipe passes are not a
whole-stack or installed-owner acceptance.

A separate ordinary-user and fully unelevated acceptance remains necessary. See
the native pipe evidence in the entry-activation slice
for the probe definitions and distinctions from anonymous/privilege-removal tests.

Native Windows / Node 26.13.0 at `c1b86730` passed the complete foundation
suite: 603 tests, 600 passed, 3 platform skips and no failures or cancellations.
This includes the actual Restricted-policy/literal-path check, ancestor replacement
checks, idle helper exit and retirement regressions. The 91-file isolated tarball
smoke also passed. [Verified job](https://github.com/KongouAirlines/ivoraige/actions/runs/42563331451/job/128984338865).
That foundation package does not activate the A3 installed owner entry paths.

## Separate-account acceptance attempt

The [2026-11-09 scoped account job](https://github.com/KongouAirlines/ivoraige/actions/runs/42568044404/job/128998805631)
at `64d32ec4681d9c601b4da4b7d68a582f003a6caa` tested the transport from
`4882a83c`. Its historical result is retained here so this foundation branch
does not require an evidence file from the later entry-activation branch.

- Preflight and 14 Secondary Logon state checks passed. The service was
  initially stopped, was started for the probe, and its startup configuration
  was not changed.
- Credentialed launch for the ordinary test accounts failed with Win32 error 5
  before establishing ordinary-account exchange, cross-user denial or fully
  unelevated execution.
- Both account removals and owned-process exits were reported, but profile
  cleanup failed with error 32 and service restoration failed with error 1052.
  The final observed service state was still running. The result was
  `passed=false`, `cleanupSucceeded=false`, `serviceRestored=false`, exit code 1.

That attempt does not close separate-account acceptance. Native CI below also
does not establish that boundary; no account-management or service-state
operation is part of these foundation tests.

## Published review-fix checks

Foundation head `d59282f` (the same source tree as local `f6099e0`) passed all
six push/PR checks on Linux, macOS and Windows / Node 26.13.0. The
[Windows PR job](https://github.com/KongouAirlines/ivoraige/actions/runs/42752833286/job/129620235202)
tested synthetic stack commit `8da37e0`: that foundation head above the contract
and main `5bfa8a8`. It passed 621 of 628 tests with 7 platform/conditional skips,
including the native accept-versus-close regression, and its 95-file package
smoke passed. This is evidence for the preceding review fixes, not the later
domain, transport and session corrections described below.

## Domain and transport review corrections

The [domain recovery record](host-domain-review.md) covers per-target intents,
record-scoped replay, explicit in-place identity refresh and safe abandoned
initialization. The [transport/session record](host-transport-review.md) covers
separate connection and reply budgets, business cancellation, private socket
locations, bounded credentials and POST-only CSRF refresh. Both records retain
their native-platform and downstream-entry limitations. The updated schema and
runtime validators are exercised together by the Node test suite.

After integrating those corrections with contract head `37601ec`, the Linux /
Node 24.22.1 `npm test` rebuilt the clean pinned DSH source and passed 601 of 621
tests, with 20 conditional/platform skips and no failures. The Python schema
check passed 100 fixtures (52 accepted, 48 rejected). The isolated package smoke
passed with 91 files, including reinstall, persistence, frozen exports and MCP.
The first package attempt could not create the default npm cache; rerunning with
a cache in the writable temporary workspace passed. New native POSIX/Windows
transport and domain recovery behavior still requires platform CI.


## Domain journal write-start and compatibility supplement

Review of `ec4e20d` reproduced three remaining journal hazards: after committed
metadata was moved away, `abandon-initialization` still removed its intent;
replay recreated a store under the same ID while the original persisted file
still existed; and a `d59282f` binary ignored the per-target v2 intent and
initialized a different ID, leaving the newer binary blocked by the conflict.
These observations concern journal proof, not the corrected identity-refresh or
source-retirement mechanisms.

New intents are version 3. Initialization first creates and flushes an empty
file under its store lease and records its non-null fileIdentity. It then flushes
`phase: prepared`, followed by `phase: writing` before DSH can write domain
metadata. An absent target is abandonable only with the durable v3 prepared
proof. With a disappeared parent, the exact saved canonical target is addressed
under the registry lease, which fences initialization/replay writers; no parent,
store or sidecar is recreated. An accessible target additionally requires its
store lease, matching saved file identity and a readable metadata-free snapshot.
The public mode and result remain `abandon-initialization` and
`{ abandonedTransactionId, diagnosticRevision }`.

Phase-less v1/v2 intents are never relabeled prepared. Matching committed metadata
can complete their replay, but a null-identity intent cannot recreate or abandon
an absent/metadata-free target. Automatic cleanup after initialization failure
also requires a stable, exact-identity metadata-free snapshot and confirmed DSH
disposal. A missing target after write-start retains the intent. The diagnostic
includes the full relevant intent, so a phase change invalidates confirmation.

The permanent global marker `{ version: 3, layout: "per-store" }` makes both
singleton-intent and phase-less v2 binaries fail closed. A legacy singleton is
converted only with its original registry-revision proof or an exact already
registered result; its per-target representation is flushed before replacing
the singleton with the marker. Interrupted conversion is deduplicated without
inventing no-write evidence. Registry/domain schemas and recovery-mode names are
unchanged; old binaries are not a supported rollback for this journal layout.

The domain fixtures now canonicalize their temporary root before constructing
journal paths and recorded targets. This addresses `/var` versus `/private/var`
on macOS and Windows short-path normalization without weakening production
identity/path checks. Native reruns are still required; Linux results are not
native macOS/Windows acceptance.

On Linux / Node 24.22.1, with exact-lockfile offline dependencies and a fresh
verified DSH build, all 25 domain tests passed. The new cases cover v2
write-then-disappear refusal, prepared missing-parent abandonment, writing-phase
identity checks and stale diagnostics, the write-start boundary before DSH,
confirmed-failure cleanup, interrupted layout migration, and v3 replay across
metadata/registry publication boundaries. A stale initialization journal is also
rejected when its domain ID is registered at another path, preventing replay
from overwriting a later migration. Exact baseline `d59282f` and
`ec4e20d` modules both rejected create/find after the v3 marker, while the new
implementation retained the same domain ID. Tests use deterministic persisted
states and injected failures, not physical power-loss or real cross-account
acceptance. Existing full-snapshot latency, orphan temporary-copy cleanup and
native Windows durability limitations remain.

The final complete suite, run with `node --test --test-concurrency=4
--test-timeout=180000 test/*.test.mjs` after a fresh build, passed 609 of 629
tests with 20 conditional/platform skips and no failures. The 91-file isolated
package smoke also passed. A preceding default-concurrency run had nine failures under parallel load:
six PDF sidecar handshake/parse timeouts, two PDF upstream failures, and the
10-second unsupported-runtime subprocess deadline in `runtime.test.mjs`. No
runtime or sidecar deadline was changed, and that failed run is not counted as
a pass. The bounded-concurrency run includes all of those tests.

Converting a v1 singleton still fails closed if neither its original registry
revision nor an exact already-registered result can be verified. Such unresolved
legacy evidence can block new registry writes until local recovery; v2/v3
per-target intents do not have that whole-registry precondition. No absent
legacy target is silently promoted to a v3 prepared transaction.

## Integrated follow-up verification

The v3 journal supplement and transport response/cleanup corrections were
integrated on exact foundation head `ec4e20d`, preserving moewell's identity
refresh, migration retirement checks, discovery locking, OwnerIPC frame and
session design. Contract commit `12d90ad` is included as an upstream parent.
The former macOS/Windows CI failures were traced to noncanonical journal/socket
fixture paths and a missing Windows test capability; those fixtures were fixed
without weakening production checks.

On Linux / Node 24.22.1, the integrated default `npm test` rebuilt the clean
pinned DSH source and passed 612 of 632 tests, with 20 platform/sandbox skips
and no failures. The 91-file isolated package smoke passed. This later integrated
pass does not erase the earlier parallel-run failures recorded above. Current
native macOS/Windows CI must be checked separately; skipped local Unix socket
bind and Windows cases are not passed acceptance.

No real cross-account test was rerun. The prior scoped Windows account attempt
failed at credentialed launch (Win32 5). Both account removals and owned-process
exit were reported, but profile cleanup (32) and Secondary Logon restoration
(1052) failed; the last observed service state was running, with startup
configuration unchanged. Neither ordinary CI success nor these local tests
close that acceptance or cleanup boundary. Downstream #90/#93 integration,
including A3 signal propagation and POST refresh routing, remains separate.
