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
