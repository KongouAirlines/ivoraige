# P02 source records and snapshots (0.1.x)

This branch activates the `contentMode: source` portion of the [parse/translation/output contract](../../../requirements/0.1.x/contracts.md). A source snapshot contains only source decisions, requires no `targetLang`, and never selects an accepted revision. Exporting Markdown or JSON from it needs no translation model. The existing accepted-translation mode remains the default; snapshots without `contentMode` retain that interpretation. The record payload now carries `schemaVersion: 2` and a versioned source IR identity derived from content and structure, separate from the private source binding address. The DSH storage domain remains version 1 so existing data can be read without a whole-database conversion.

For a legacy record, a read does not rewrite the data. The first successful record write upgrades its payload to version 2 and marks reconstructed source IR as legacy. A record declaring a newer payload version is readable but rejects writes. The old binding digest and applicability check still govern translation reuse; this change does not make PDF bindings portable across engines or bypass source validation.

## Verification

- `test/source-mode.test.mjs` exports original Markdown and structured JSON without a target language, even after a translated revision was accepted, and replays the source snapshot after restart. It checks that no extra revision was created.
- A mock PDF fixture exercises the source mode through the task queue: the PDF output returns the verified managed original bytes while Markdown/JSON provide readable source text. It does not call the sidecar rebuild method or a translation model. This is a fixture transport regression, not real-PDF quality acceptance.
- The legacy fixture removes the new fields from an SQLite record and snapshot, closes the owner, takes a consistent file backup, restarts, and reads the accepted snapshot unchanged. An invalid source request leaves the snapshot list unchanged. A successful write upgrades the payload, while a simulated future schema version refuses another write. Restoring the backup brings back the legacy record and accepted snapshot.
- These are validation and transaction-failure injections, plus a backup/restore exercise. They do not simulate power loss or migrate a real user database.

Full-suite, package-smoke, and final commit results are recorded in the P02 PR.
