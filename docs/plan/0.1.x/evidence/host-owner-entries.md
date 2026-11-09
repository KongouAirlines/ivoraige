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
Installed-owner package smoke was not reached by that failed job. The corrected
source was subsequently verified at `4882a83c` below.

## Native stack verification at 4882a83c

The exact PR head `4882a83caf704cd2eeeb51b0cb4eba762646fe12` passed
[three-platform CI](https://github.com/KongouAirlines/ivoraige/actions/runs/42564141101)
with Node 26.13.0. Each job completed the build, full test command, Python
sidecar/release-audit fixtures and the actual 95-file installed-package smoke:

- [Windows](https://github.com/KongouAirlines/ivoraige/actions/runs/42564141101/job/128986838448):
  630 tests, 627 passed, 3 platform skips, zero failed or cancelled.
- [Linux](https://github.com/KongouAirlines/ivoraige/actions/runs/42564141101/job/128986838466):
  630 tests, 613 passed, 17 platform skips, zero failed or cancelled.
- [macOS](https://github.com/KongouAirlines/ivoraige/actions/runs/42564141101/job/128986838200):
  630 tests, 615 passed, 15 platform skips, zero failed or cancelled.

The package smoke covers installed owner IPC, paired API/MCP, saved settings,
complete backup/reinstall and unchanged frozen snapshot/original exports. The
Windows run includes the actual Restricted-policy/literal-path helper and the
caller-owned CLI fixture correction. These results cover this tested source
head, not later changes or a full desktop product.

## Remaining acceptance gates

The Windows named-pipe implementation enforces a current-SID native DACL and
verifies actual connected peer identities, with the private generation capability
as an additional check. Native suite and installed-owner execution are verified
above. Separate ordinary accounts and fully unelevated tokens remain unverified.
The first [standard-user attempt](https://github.com/KongouAirlines/ivoraige/actions/runs/42564258647)
stopped at Secondary Logon preflight (1062), before account creation. The scoped
[follow-up](https://github.com/KongouAirlines/ivoraige/actions/runs/42568044404)
at `64d32ec4` is queued as of 2026-11-09; it has no test or cleanup result.
It uses the production transport from `4882a83c` and adds isolated account probes,
service-state capture and final cleanup/restoration reporting. A queued run is
not cross-account acceptance. See [the Windows evidence](host-windows-pipe.md).
Any later source head needs its own applicable CI.

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

## Integration handoff

The dependency order is [#87 contract](https://github.com/KongouAirlines/ivoraige/pull/87)
→ [#88 ownership](https://github.com/KongouAirlines/ivoraige/pull/88)
→ [#90 lifecycle](https://github.com/KongouAirlines/ivoraige/pull/90)
→ [#93 entries](https://github.com/KongouAirlines/ivoraige/pull/93).
Their base/head chain is contiguous. Integrating only a lower layer does not
activate the entry guarantees described here; after integration, recheck the
resulting main head and preserve the existing compatibility tests.

Once this stack is integrated, subsequent work can use the one-owner bootstrap,
P04 registration/events, authenticated owner routes and retryable drain/exit
rather than introduce a second host, runtime, scheduler or storage owner:

- D03 can build its UI session/client and invalidation behavior on the existing
  paired entry and event barrier. D04 can measure the actual host/browser
  baseline; platform measurements remain separate from CI.
- D02 can develop its draft-journal storage/flush fixtures against these
  interfaces. Automatic UI destruction still requires successful persistence
  and recovery acceptance; HostControl does not supply that journal.
- U01 ordinary translation, W01 composition, W02 text admission and
  U03.terms@1 follow their existing P01–P04/Records dependencies. This stack
  does not require them to wait for a chosen native shell. Preview settings,
  saved workflows and other package-specific prerequisites remain as listed
  in the [work-package index](../work-packages.md).
- I01.shared@1 must implement client principals, grants/scopes, revocation and
  resource checks before external access is enabled. Owner pairing is not a
  client authorization API; owner cookies/capabilities must not be repurposed
  as external client grants. Callable plans and KT/Zotero then follow their
  existing sub-delivery dependencies.
- The minimal tray can reuse verified host state, but its separate EntryControl
  enable/disable/persisted-policy contract and native UI remain to be built.
  Full process-exit observation, force-exit and recovery work cannot be inferred
  from a disconnected channel or finalization receipt.

This handoff does not mark D01 complete or change the work-package dependencies,
runtime migration gates or release criteria.
