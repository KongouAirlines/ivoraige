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

`copy` requires a distinct verified store and allocates a new domain/registration identity. `migrate` additionally requires trusted evidence that the source process retired; a free lock and a command-line confirmation do not supply that proof. `repair-registration` does not overwrite an unparseable multi-domain registry: without a trustworthy complete backup and merge evidence it remains unavailable. These limits are deliberate fail-closed results, not completed migration/repair UX.

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
