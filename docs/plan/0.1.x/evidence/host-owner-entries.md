# Host owner bootstrap and authenticated entries

Date: 2026-11-09. This A3 slice depends on the A1 foundation and A2 lifecycle
coordinator. It activates owner bootstrap and authenticated entry paths, not a
completed desktop/tray product or a completed D01 acceptance.

## Activated boundaries

Persistent `createApp` owns an ephemeral domain and lease. `startHost` creates or
attaches a resident owner. Composition receives one generation and the already
held lease through an internal callback, never a public skip-lock option. Existing
store compatibility is checked under that lease before host metadata writes.
Records, source bindings, revision/task IDs and frozen snapshots remain unchanged.
A copied store requires explicit domain recovery before opening; copy recovery
changes domain identity while preserving content/snapshot identities.

Business admissions, active handlers, task/component work and resource leases are
drained before storage. Cordis disposes dependent consumers first; cached domain
and backend close APIs then explicitly certify closure because Cordis may log and
swallow effect errors. Unconfirmed closure retains the lease. Successful stages
are not restarted, retry joins unfinished work, and discovery cleanup cannot erase
a newer generation. A finalization receipt is not an OS process-exit observation.

Launch, serve, local business CLI and stdio select the same owner. Stdio attaches
only a resident host and does not own its exit. The CLI's `--url` compatibility
selection must match a verified local owner, not an anonymous arbitrary HTTP
server. Attached task JSON-event streaming is currently unavailable; task polling
remains supported. Direct embedded HTTP facades require an explicit trusted
owner callback; persistent applications always use their host session instead.

The workbench consumes a one-use origin/generation-bound bootstrap fragment,
clears it before exchange and keeps CSRF data in memory. Private API, events,
artifacts, settings, component installation and MCP routes require the paired
cookie, with CSRF for writes. The public static page shows pairing instructions
without private state. Closing a view does not request host exit. Owner-only
HostControl methods are not MCP tools. HTTP MCP defaults off; its explicit run
switch and forced-off override do not claim a persisted EntryControl policy.

## Observed verification

Linux / Node 24.22.1 compatibility runtime:

- Complete `npm test`, including build, at the source tree published as `044aeea3`: 630 tests, 604 passed, 26 conditional
  skips, zero failed/cancelled. Independent test workers use private temporary
  registries and subprocesses inherit their worker's selection.
- Lifecycle/disposal regressions cover dependent-consumer ordering, retained
  SQLite ownership after ambiguous close, retry, and interrupted admissions.
- Browser pairing/CSRF tests, real loopback HTTP authorization, owner-attached
  stdio protocol fixtures and six workbench regression suites passed.
- PDF mock-sidecar import suite: 21 passed, including explicit registration of a
  copied store followed by replay of the unchanged frozen source binding with
  zero model calls. No real PDF engine or external model was invoked.
- Package smoke builds/installs the actual tarball and reaches native resident
  startup, then fails with OS `EPERM` because this sandbox prohibits Unix socket
  binding. This is not a full package-smoke pass. The updated smoke pairs through
  installed owner IPC and checks authenticated API/MCP access in native CI.
- Native socket-dependent tests skip only after an actual local bind denial and
  never skip that denial in CI. These skipped tests are not claimed as passing.

The first local full run of the latest source tree hit the existing provider
40 ms deadline before its request counter advanced under load. Its isolated
12-test suite and a subsequent complete run passed without changing the provider
or its assertions. This is a timing-sensitive test, not a hidden passing result.

Native Linux / Node 26.13.0, published head `e0eae6f`:

- Complete `npm test`: 611 tests, 606 passed, 5 platform skips, zero failures.
- Actual `ivoraige-0.1.0.tgz` package smoke passed with 92 files, including
  installed owner IPC pairing, authenticated API/MCP, saved settings, complete
  backup/reinstall and unchanged frozen snapshot/original exports.
- [Native CI evidence](https://github.com/KongouAirlines/ivoraige/actions/runs/42557174845/job/128965406382).
  This result does not establish other platforms or later heads.

Native Windows / Node 26.13.0 at `044aeea3` completed 630 tests in 159 seconds:
626 passed, 3 platform skips, one failure and no cancellations. The failure was
fixture teardown deleting an open SQLite store before its caller-owned app was
disposed. The fixture now closes before removal and explicitly proves that CLI
does not dispose a supplied host, then verifies the store reopens with its data.
This correction still requires a new native run; installed-owner package smoke
was not reached by that failed job.

## Remaining acceptance gates

The Windows named-pipe implementation enforces a current-SID native DACL and
verifies actual connected peer identities, with the private generation capability
as an additional check. Nine native security/lifecycle probes passed at foundation
head `7569ca96`; the complete run still failed two filesystem/policy compatibility
gates, corrected by the following source changes. Final-head native checks, an
installed A3 owner, separate ordinary accounts and fully unelevated tokens remain
required. See [the Windows evidence](host-windows-pipe.md). Three-platform Node
26.13.0 results are tracked per published head and remain a merge gate.

Trusted process-exit observation, force-exit ownership/challenges, full migration
and registration repair, persisted MCP enable policy, real tray integration and
management UI for lifecycle operations are not completed. Force operations fail
closed. A different persisted settings/component/PDF binding still fails after
restart; explicit reconfiguration remains unavailable. Only the output directory
can change after stopping; live attachment still rejects a conflicting output
root. These limits must not be hidden by the successful compatibility tests.

The selected DSH/Cordis and PDF runtime versions are unchanged. No runtime
migration, alternate task scheduler, model operation during export, or automatic
merge/deployment is included.
