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
