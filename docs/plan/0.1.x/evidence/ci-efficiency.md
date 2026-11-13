# CI execution and coverage audit (0.1.x)

## Decision

Reduce duplicate execution and bound failure time before removing distinct acceptance coverage. The main-branch baseline for this audit is `cc3ca266`.

- Run the native Node 26.13.0 matrix for every pull request, including stacked PRs whose base is not main. Ordinary feature pushes no longer start a second identical matrix.
- Retain push validation on main, `release/**`, and `v*` tags, plus `merge_group: checks_requested` for merge-queue candidates. Manual `workflow_dispatch` permits explicit branch diagnostics. A conflicted PR can be unable to start its merge-candidate workflow; a manual head run is diagnostic only, not evidence that its eventual merge candidate passed.
- Cancel superseded PR runs by PR number. Do not cancel main, release, tag or merge-queue runs when a later event arrives. No repository protection or required-check setting is changed; native job display names remain stable.
- Keep three platforms and fail-fast disabled. They exercise different path aliases, ACL/permissions, SQLite file lifetime, archive tools and process behavior. A successful Linux run does not substitute for these boundaries.
- Separate build, regression tests and install/reinstall acceptance into named steps in the existing jobs. This improves failure attribution without adding parallel jobs that repeat dependency installation and builds.
- Bound each top-level Node test at 120 seconds, its CI step at 10 minutes, package acceptance at 10 minutes, setup/build at 5 minutes each, and the job at 25 minutes. Python fixture steps each have 3 minutes. These limits fail the check; they do not convert timeouts to passes or skip assertions. Revisit using actual healthy timings if suite cost changes.
- Cache npm downloads using setup-node's lockfile-based cache. Continue `npm ci`; never cache installed node_modules or bypass lockfile validation.

## Redundancy decisions

| Work | Decision and coverage retained |
| --- | --- |
| Feature push plus PR matrix | Remove duplicate feature-push trigger; retain PR merge-candidate, integration and release validation. This removes one three-platform run per ordinary feature update, not a promised percentage reduction in wall-clock latency. |
| LF/CRLF injected cleanup fixtures | Execute each of the three real failure probes once. The former two variants were both normalized to identical LF source before execution. Check both normalization inputs in-process, retain actual application disposal/global restoration/directory-removal assertions. Six child processes become three. |
| ZIP license member lookup | Enumerate the unchanged archive once, outside the license loop. Keep every license member-presence and byte comparison and every later mutated-archive rejection. |
| Package static HTTP probes | Reuse first response bodies for PDF guide and release metadata assertions instead of fetching each twice. Keep status, content-type, nonempty-body and semantic assertions. |
| Public import API vs packaged CLI/HTTP/MCP | Retain: different public entry boundaries and installed dependency closure. |
| Source tests vs tarball install | Retain: source-tree success does not prove the published file/dependency set works. |
| Second install in independent path | Retain: proves data/settings/frozen snapshot/export bytes survive same-version replacement; not equivalent to first install. |
| Three-platform Python inventory/archive tests | Retain: real case collisions, links/reparse points, permission errors and archive programs have platform-dependent behavior. |
| Pure UI state/mock tests on three OSes | Potential future optimization, but no measured material cost justifies a brittle exclusion list now. The native job already needs the same checkout/build. |
| Documentation paths | No blanket skip: schemas/fixtures, generated guides, packaged documentation and license files can affect executable or distributable behavior. Introduce a narrow prose-only classifier only with evidence and a stable required gate. |

## Healthy runtime evidence and interpretation

The successful [#97 PR run](https://github.com/KongouAirlines/ivoraige/actions/runs/42948796506) used approximately 88 seconds on macOS, 106 on Ubuntu and 335 on Windows. Windows's test step was about 85 seconds and package acceptance about 207. Its [push duplicate](https://github.com/KongouAirlines/ivoraige/actions/runs/42948789550) used another 83/80/315 seconds: roughly 16.8 runner-minutes together, versus about 5.6 minutes elapsed for the PR matrix. These are different metrics.

The heavier [#93 run](https://github.com/KongouAirlines/ivoraige/actions/runs/42776446644) used about 604 seconds on Windows (219 test, 330 package acceptance), while Linux/macOS took about 62/118 seconds. Earlier six-hour Windows runs were hung-process failures, not normal execution cost. Shortening their failure bound is not a speedup of successful tests.

The audit does not claim a whole-history failure percentage or measured post-change native speedup. Retaining a full current matrix is intentional; later splitting or selecting heavy package scenarios should follow measured change-risk coverage, not move all expensive tests to nightly by default.

## Remaining boundaries

Package acceptance includes local install and same-version reinstall; it is not a real PDF/GUI quality test, a separate ordinary-account Windows security test, or a release/distribution approval. Existing pending HostControl and plugin PRs must retain their own regression cases when integrating this workflow change. The one-off account/service experiment is not added to routine CI.

## Local validation

On Linux with Node 26.13.0: build passed; the full Node suite passed (637 tests, 635 passed, 2 existing platform skips); Python inventory/sidecar/archive suites passed (16/26/4); isolated package install/reinstall smoke passed. The final concurrency and timeout-test refinements passed their six focused tests. Native Windows/macOS results remain required from the pull-request matrix; local success is not a cross-account acceptance claim.

## Windows follow-up: reinstall resolution

The first PR matrix passed Linux/macOS and all Windows regression tests, but Windows package acceptance hit the 180-second subprocess limit on the **second** `npm install` (run 42957660172, job 130316490886, smoke line 213). The initial installation and first installed-server checks had already finished. The previous error path discarded npm output, so this proves the slow phase, not whether the underlying delay was registry resolution or extraction.

The replacement installation now copies only the first installation's generated manifest/lockfile and original tarball, then runs `npm ci --offline` in the empty replacement directory. This preserves a real independent installation while removing a second dependency resolution/network dependency and fixing the resolved graph for the same-version persistence test. No node_modules is copied. The 180-second bound and 10-minute smoke step remain unchanged. Every subprocess now reports its phase and elapsed time; failures include captured npm output (HTTP logging enabled) instead of losing the diagnostic evidence.

Linux validation passed the complete install/reinstall scenario: first install 12.6 seconds; locked offline reinstall 3.5 seconds. This is not a Windows speedup claim; the new native matrix must verify that platform.

## Integration with HostControl foundation (2026-11-11)

Synchronize the CI branch at `d5bc0f3` with main `934de89`, which includes the HostControl contract and owner foundation. Resolve the workflow conflict by retaining the named build/regression/package steps and the 25-minute job bound from this change. Preserve main's 180-second top-level timeout for `npm test`; the CI-only command retains its 120-second bound. No HostControl implementation or assertion is removed.

Local compatibility validation used Linux, Node 24.22.1 and npm 11.9.0; Node 26.13.0 was not available in this environment. Source checks reused the existing dependency checkout and verified pinned DSH source. Build and `npm run test:ci` passed: 721 total, 699 passed, 22 skipped. Four skips were Unix socket tests blocked by the local sandbox; the other 18 were platform-specific cases. Python inventory/sidecar/archive tests passed (16/26/4), and the HostControl schema check passed all 119 fixtures. `git diff --check` passed.

The isolated installed-package smoke also passed, including public API/CLI, HTTP/MCP/UI, settings, document/snapshot persistence and byte-for-byte exports after a separate locked offline reinstall. The initial install took 9.4 seconds and replacement install 3.1 seconds on this machine.

The [three-platform Node 26.13.0 run](https://github.com/KongouAirlines/ivoraige/actions/runs/42958925078) passed for the original `d5bc0f3` head. It does not cover this integration with `934de89`; the synchronized branch still needs its own native matrix, including the socket and Windows cases unavailable locally.
