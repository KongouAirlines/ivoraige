# 0.1.x foundation Q01/Q03 evidence

Base: `8dc548d9b08d8d6374c66920efca24135d9ce86d` (Node.js 26.12.1, pinned DSH `639ed015397290b3745d163aafe02ffee4aa3f84`). This branch changes Q01 and Q03 only. The existing 0.1.0 export, model settings, CLI, HTTP, and MCP wire shapes remain in place.

## Q01 — export admission

`Tasks.exportDocument` creates a frozen snapshot before `Records.createOperationTask` checks for an active export. A second export for the same document used to receive `CONFLICT` and leave its just-created snapshot behind. The admission path now releases its snapshot lease and calls the existing guarded `Records.deleteSnapshot` only when this call created the snapshot and task creation failed. A caller-supplied snapshot and any snapshot attached to an admitted task remain available.

`test/export-tasks.test.mjs` holds one export in a slow output adapter, attempts a conflicting new export and a conflicting export using its existing snapshot, verifies both return `CONFLICT`, verifies only the first snapshot remains, then completes the first task. A separate injected cleanup failure verifies that the original admission `CONFLICT` remains the caller error while the cleanup failure is reported to local diagnostics.

## Q03 — settings and CLI errors

Model route edits are checked with the pinned DSH `LlmPiAi.Config` schema before a settings write. `reasoningEfforts` also checks the DSH runtime's nonempty thinking-level and wire-value requirements before persistence. DSH `ValidationError` maps to `INVALID_ARGUMENT`; missing DSH settings forms map to `COMPONENT_MISSING`. Malformed CLI `settings --set` JSON maps to `INVALID_ARGUMENT` with exit code 2, including under `--json`.

`test/model-settings.test.mjs` checks malformed compat and reasoning values leave routes and revisions unchanged, and verifies missing-form errors. `test/entries.test.mjs` checks malformed CLI JSON error shape and exit code. `test/mcp.test.mjs` exercises installed settings tools over real HTTP MCP together with HTTP and remote CLI: invalid compat/reasoning values return `INVALID_ARGUMENT`, and missing forms return `COMPONENT_MISSING`.

## Verification

- `npm run build`: passed; DSH bundle built from 1005 source files at the pinned commit.
- `node --test test/export-tasks.test.mjs test/model-settings.test.mjs test/entries.test.mjs`: 35/35 passed.
- `node --test --test-concurrency=4 test/*.test.mjs`: 264/264 passed after the final regressions.
- After the two added regressions and cleanup diagnostic guard, `node --test test/export-tasks.test.mjs test/mcp.test.mjs`: 18/18 passed.
- `npm run smoke:package`: passed; isolated tarball install, saved settings, frozen snapshot and original exports, MCP and UI smoke.
- Initial default-concurrency `npm test` built successfully but three unrelated component/PDF cases hit 30-second timeouts under full parallel load. The bounded-concurrency run passed those same cases and the full suite. The targeted suites also passed independently.

No paid model service or real user library was used; model tests used local fixtures.

## #46 review correction — retain failure and second settings write

If `retainSnapshot` throws before returning a release function, export admission now
attempts to delete a snapshot created by that admission. The existing guarded
`Records.deleteSnapshot` protects leased snapshots, snapshots referenced by
resumable tasks, and snapshots referenced by artifacts. Caller-supplied snapshots
are excluded from admission cleanup. An injected retain failure test verifies that
the new snapshot is removed while an existing snapshot remains; it also checks
that an admitted task's artifact keeps its snapshot protected. The injected
failure is a fault case, not a claim that normal retention fails.

When the route write has persisted and the second DSH settings write raises a
`ValidationError`, the response now uses `UPSTREAM_FAILURE` (HTTP 502 / CLI exit
4), retaining `details.partialSave` with the route revision. Validation before
the first write still maps to `INVALID_ARGUMENT`; ordinary later errors keep
their existing mapping. The regression obtains a real DSH `ValidationError` from
the model settings validator, injects it at the second write, and checks the
persisted route, unchanged selected revision, response status and partial-save
details. The same regression checks the pre-persistence DSH validation mapping
to `INVALID_ARGUMENT`, and confirms an ordinary first-write `EIO` remains the
original error without advancing either revision.

- `node --test test/export-tasks.test.mjs test/model-settings.test.mjs`: 19/19
  passed in the local worktree with loopback access and a worktree-local
  temporary directory. The first sandbox run was 18/19 after correcting a test
  race; its sole remaining failure was the local HTTP fixture blocked by the
  sandbox. The unrestricted rerun passed all 19.
- After adding the first-write and CLI exit-code assertions,
  `node --test --test-name-pattern='DSH validation in the second settings write' test/model-settings.test.mjs`:
  1/1 passed. The full affected suites had passed immediately before those
  additional assertions; a later full run is pending stack integration.

## #46 CAS review correction — native DSH settings conflicts

DSH can raise `SettingsConflictError` with code `SETTINGS_CONFLICT` when its
settings revision changes between the entry precheck and the actual mutate.
The settings boundary now converts that native error to public `CONFLICT` and
preserves its `expected` and `actual` revisions. A first-write race returns
HTTP 409 / CLI exit 3 without a route partial-save marker. If the route write
has already persisted, a second-write race also returns `CONFLICT`, with the
same expected/actual pair plus `details.partialSave` and the durable route
revision. Validation failures after that first write remain
`UPSTREAM_FAILURE`; ordinary first-write `EIO` remains unchanged.

Tests use the real pinned DSH `settings.mutate` to perform a competing write
inside the mutation hook, then let the requested write reach DSH with its
stale revision. `test/model-settings.test.mjs` checks both stages and stored
state. `test/mcp.test.mjs` checks six combinations of the two stages and HTTP,
remote CLI, and installed MCP, including the first-write no-route result and
the second-write persisted route and partial-save details.

- `node --test --test-name-pattern='(native DSH|DSH validation in the second settings write|settings errors map consistently)' test/model-settings.test.mjs test/mcp.test.mjs`:
  4/4 passed, using a worktree-local temporary directory and local loopback.
  This is focused evidence; stack-level full tests and PR CI are tracked
  separately.

## #46 protocol-specific compat review correction

The pinned DSH schema accepts a compat switch that is offered by another API,
but its catalog resolver rejects it for the route's effective API. For example,
`supportsStrictTools: true` is offered by `anthropic-messages`, not
`openai-completions`. Before this correction that deterministic resolver error
escaped as `INTERNAL` despite no settings write. The model settings boundary
now runs the pinned schema and strict catalog resolver before the first write,
mapping only typed `PiAiCatalogError` to `INVALID_ARGUMENT`. Its build bridge
resolves the vendor junction to one source path so the exported error class and
resolver share identity. Other resolver errors are not classified by message.

The regression covers explicit OpenAI API, inherited route API, and API inferred
from the installed DeepSeek catalog. Each rejected edit leaves routes and both
revisions unchanged. Valid `supportsStrictMode` on OpenAI and
`supportsStrictTools` on Anthropic save normally. HTTP, remote CLI, and MCP
exercise those negative and valid cases, including HTTP 400 and CLI exit 2.
An OpenRouter catalog route that contains both OpenAI completions and Anthropic
models also accepts `supportsStrictTools` while selecting a completions model,
because the pinned resolver permits a route compat switch when at least one
model on that route can consume it.
Existing native CAS, second-write partial-save, DSH validation, and ordinary
first-write `EIO` guards remain in the focused suite.

- `npm run build`: passed using pinned DSH commit
  `639ed015397290b3745d163aafe02ffee4aa3f84`; the canonical-path bridge
  bundled 1003 source inputs after removing duplicate module identities.
- `node --test test/model-settings.test.mjs`: 15/15 passed, including the
  mixed-API route and earlier partial-save/CAS regressions.
- `node --test --test-name-pattern='settings errors map|native DSH settings CAS races|API-specific compat reaches' test/mcp.test.mjs`:
  3/3 passed. HTTP, remote CLI and MCP ran over local loopback with a
  worktree-local temporary directory. No paid model call or user library was
  involved.

## Q03 review correction — nullable and withheld compat fields

Review reproduced two synthetically configured inputs, `compat: { supportsStore: null }` and `compat: { openRouterRouting: {} }`, with an otherwise valid `openai-completions` route. At `91c9aa3`, each raised a plain DSH resolver `Error` and mapped to `INTERNAL`; neither changed routes or revisions. The pinned DSH schemastery config accepts nullable member values and undeclared keys before its resolver rejects them. Its compat gate offers `supportsStore` and withholds `openRouterRouting`.

The model settings boundary now rejects null compat members and keys outside the pinned DSH offered compat vocabulary as `INVALID_ARGUMENT` before mutation. It continues using the DSH config schema for member types; unrelated resolver or infrastructure errors are not remapped as user input errors. Existing valid compat configurations still pass the full suite.

- `npm run build`: passed at pinned DSH `639ed015397290b3745d163aafe02ffee4aa3f84`.
- `node --test test/model-settings.test.mjs test/mcp.test.mjs`: 25/25 passed. The two inputs are checked for unchanged routes and revisions in the settings test and for `INVALID_ARGUMENT` through HTTP, remote CLI, and installed MCP tools.
- `node --test --test-concurrency=4 test/*.test.mjs`: 264/264 passed.
- A temporary, unchanged copy of `task-2/review46/probe-settings.mjs` run against this branch returned `INVALID_ARGUMENT` for both inputs, with `afterRoutes: {}` and `beforeRevisions` equal to `afterRevisions` (`routes: 0`, `selected: 0`). The copy was removed; the review probe was not edited.
- `npm run smoke:package`: passed, including isolated tarball install, persisted settings, frozen snapshot/export, MCP, and UI smoke.
