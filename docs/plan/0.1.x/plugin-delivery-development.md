# P05 controlled source-package delivery

This slice adds stopped-host, offline installation over the pinned DSH package
manager operations and AppBoot/Loader. It does not close V04a, V06 or P08, and it
does not freeze the host for arbitrary future plugins.

## Runtime and upstream contract

The tuple remains DSH `639ed015397290b3745d163aafe02ffee4aa3f84`, AppBoot
`0.2.0-rc.2`, Cordis `4.0.4`, host API `1`. ADR-0003's future stable-runtime
migration is not implemented here. Plugins declare the tuple in `ivoraige` and
an optional AppBoot peer. No runtime is bundled into the independent source
package; only the host `dist/dsh.mjs` exports the manager's `runProfilePnpm`,
atomic writer and run-tree helpers. `execa@10.0.0` and `undici@7.28.0` (MIT) close
the newly reached upstream subprocess/proxy dependencies. No manager UI is loaded.

DSH's manager restores manifest/lockfiles after cancellation or installation
failure, but that is not a complete package-directory rollback. Without HMR it
reports restart-required, and running bundle removal can require stopping the
profile. This host therefore uses stopped-profile ownership, a complete immutable
`node_modules` snapshot and DSH's own package-operation executor, rather than a
parallel loader or configuration format. Native scripts and peer auto-install are
disabled, with offline pnpm and explicit rejection of external dependency fields.

DSH bundle-relative module names are relative to their package directory; use
`./index.mjs`. Bare specifiers need Loader native resolution support not supplied
by the existing closed host build. Ordinary AppBoot treats optional failures as
warnings. The isolated activation probe uses DSH reconciliation with the installed
entry IDs required, so failed imports and missing injections roll back. It uses a
fresh process to avoid ESM caches validating an old version.

## Transaction and lifecycle

The host and installer take the same profile SQLite ownership lease. Validation
uses a second lease so a surviving validation process also prevents recovery.
Before mutation, five DSH-owned paths are copied: manifest, pnpm lock, workspace
configuration, user patch and node_modules. A ready marker precedes package
mutation. The immutable backup survives replayed recovery, including interruption
during restore. Completed restore and obsolete snapshots are renamed out of the
replay path before cleanup, so a half-deleted backup is never replayed. Renaming the transaction directory to the previous snapshot is
the commit point. Before that point startup restores the previous complete set;
after it startup retains the new set. Retained immutable local source directories
prevent pnpm file dependencies from following edits to a working checkout.

Only package/config paths are restored. User stores, credentials and source
assets remain outside that boundary. Uninstall retains them. The explicit
rollback command restores the previous package/config pair, not only package
bytes; it can replace subsequent configuration edits. A malformed journal or
surviving package process requires diagnosis rather than deletion or guessed
success. Local-disk process interruption is in scope; filesystem/power-loss
crash consistency, older binaries bypassing leases, untrusted hostile packages,
third-party registries, signature systems and hot updates are not claimed.

## Validation and remaining gates

`test/plugin-install.test.mjs` uses actual offline pnpm installation of local
fixture packages and the actual MinerU source package. It covers clean install,
missing dependency and tuple rejection, disabled restart, live-owner exclusion,
activation failure with full package restoration, interrupted-journal startup (including a killed child process),
previous-version rollback, package-command failure, cancellation and data retention.
Fixtures validate delivery/lifecycle, not real PDF quality. A same-id source probe
also verifies conflict with the existing legacy PDF composition fails explicitly
and releases ownership; existing PDF suites preserve the legacy-only path.

`npm run smoke:package` packs and installs the core in isolation, proves absence
of the MinerU package, independently packs/extracts/installs the five-file MIT
source package and exercises the installed recovery entry. No Python runtime,
model or native binary is installed by this check. P08's actual engine/resource
license closure and complete distributable runtime remain separate acceptance.
Node 24.22.1 is the locally available compatibility runtime. Node 26.13.0 and all
three target OSes require their own CI evidence; no local cross-platform pass is
claimed.

## Local observed result

On Node 24.22.1, the stable implementation passed the full `npm test`: 587 tests,
585 passed, 2 skipped, 0 failed. Package smoke also passed, including isolated
core install and separate MinerU source-package install/disable/remove. An earlier
run made during a validation-lease edit failed four installation probes because
already-loaded installer code did not release the newly added child lease; three
existing PDF tests also hit their unchanged short sidecar handshake deadlines
under concurrent local runs. The stable rerun above passed those same tests without
loosening the protocol deadlines. This evidence is compatibility-line only.

The final source-package baseline also includes renderer fix `b56db0d22bdabfb0adb3afd19c8b77479013868d`; its parent is the original `c76cfe0` delivery input.

## Review hardening

All pnpm invocations, including upstream's post-install compatibility repair,
receive the same offline, ignore-scripts, no-auto-peers, local-store and copy
options through the native operation's shared argument prefix. A pure local stub
forces post-install rejection and checks both argv sets without network access or
package scripts. Real package-manager smoke uses pnpm 11.25.0; the three-platform
CI setup explicitly installs this version rather than assuming a global pnpm.

Profiles are canonicalized before source-overlap checks and all subsequent
operations. Every nested bundle row requires an explicit unique ID and module
name, and every declared row must be present and ACTIVE in the isolated probe.
This controlled delivery slice does not accept dormant/disabled child rows inside
an enabled bundle: disable the whole bundle through the management entry instead.
Native AppBoot diagnostics alone skip disabled or missing rows and therefore are
not sufficient installation evidence.

Cancellation may reject a child-process promise before the child exits. If a
validator still holds its probe lease, the installer retains the transaction,
reports CONFLICT with recoveryPending and validationPid, and performs no package
restore. All normal profile entries remain locked out until that process exits.
The regression uses a real locally installed test plugin which ignores SIGTERM,
waits at an explicit activation barrier, and proves that recovery happens only
after SIGKILL releases the probe lease. Native package-run recovery uses the
upstream recorded-process gate independently.

## CLI path-alias correction

PR #97's macOS job `128990495675` at `b5cbdda966b36dcb29135f38e1ae8ee894ec978d`
passed the full suite but failed package smoke: the plugin CLI exited successfully
with empty stdout, so the smoke's JSON parse failed. Its entry guard compared the
canonical module URL with an unresolved argv path. macOS temporary-directory
aliases and npm executable links can therefore skip dispatch entirely.

A real directory-symlink invocation reproduced exit 0 with empty stdout on Linux.
Commit `867179b8f8ddaa278df0493f790fcbe531698b53` applies the existing CLI's
`realpathSync` comparison to both paths. The regression checks direct and aliased
execution as well as importing the module without dispatch. On Linux/Node
24.22.1, the focused regression and offline package smoke passed; the full suite
reported 596 tests, 594 passed, 2 skipped and 0 failed. Post-fix Node 26/macOS CI
has not yet established the result on that platform.

The cancellation regression also distinguishes platform signal behavior: its
POSIX validator ignores SIGTERM and must retain the recovery journal, whereas
Windows may terminate it and permit immediate rollback. Both paths verify final
ownership release and restoration. Fixture cleanup now terminates and drains the
validator before deleting its directory, including when an assertion fails.
This addresses a reachable test assumption; unavailable Windows job logs do not
establish that it caused a running CI job to stall.

## Recovery boundary corrections

If the process dies after moving the previous rollback snapshot to `obsolete`
but before publishing the new snapshot, recovery restores that previous rollback
point as well as the uncommitted package set. A SIGKILL regression verifies that
the current complete version reopens and the earlier complete version remains
available to explicit rollback. Explicit rollback first removes unused obsolete
bytes, so partially completed cleanup from a committed operation cannot become
a false rollback snapshot.

CLI failures preserve only the supported `recoveryPending` and positive
`validationPid` fields from error details; arbitrary details and causes are not
serialized. Borrowed profile leases remain caller-owned, compare canonical paths
through directory aliases, and must hold the validation lease while startup
recovers any interrupted journal. The ordinary boot API never skips recovery
merely because its lease was supplied by an embedding caller; the isolated
installation probe retains its separate internal startup primitive.

## Validation-exit ownership race

A deterministic fault-injection regression exercises the real installer and
validation child, injecting SQLite BUSY only at the first post-validation probe
reacquisition and allowing the outer recovery retry. Before the correction,
recovery completed but the transient CONFLICT masked the original activation
PRECONDITION_FAILED. The installer now preserves that activation failure while
retrying ownership. A second schedule keeps both attempts busy and verifies that
recoveryPending remains explicit, with the new package state and journal untouched
until exclusive recovery is possible. This is reproduced scheduling evidence,
not a claim that this race occurred in a Windows CI run.

## Windows CI ownership and fixture follow-up (2026-11-10)

The `b350e2b` Windows run logged three SQLite cleanup `EBUSY` failures and a
borrowed-profile alias `CONFLICT` before cancellation; package smoke never ran.
This follow-up closes the applications before deleting their settings trees in
the affected MCP and settings-only fixtures. It also uses `realpathSync.native`
for `ownsProfile`, matching the native resolver used by `fs.promises.realpath`
when the lease is acquired (including Windows short-name aliases), and asserts
ownership through both the original and alias paths and after release.

On Linux with Node 26.13.0 and the lockfile dependencies, the three affected
suites passed 48/48; the rebuilt full suite passed 605 with 2 conditional skips
(607 total). Native Windows/macOS CI remains a separate gate, not inferred from
these Linux results. No live PDF fidelity, cross-account acceptance or binary
redistribution claim is added.
The 87-file isolated package smoke also passed after setting a writable local
npm cache; its first attempt could not create this executor's default cache.
