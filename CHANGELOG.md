# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- v2.0 design baseline in `docs/requirements/v2.0/`:
  - `01_design_v2.0.md` — single-kernel three-entry architecture (CLI / MCP / WebUI), three-OS single-file distribution (Node SEA + PyInstaller sidecars + npm), data model with explicit `reuseKey` and frozen `ExportSnapshot` contracts, Zotero four-mode use case, fine-translation workbench walkthrough, acceptance matrix, milestones M5–M8, risk register; registered constraints C1–C8.
  - `02_UI-design_v2.0.md` — WebUI design: light/dark theming, left-rail shell, per-plugin page registry, PDF processing page (settings / pipeline progress / performance & token summary / PDF.js preview), DeepL-style text translation page with regeneration versions, three-pane workbench.
  - `03_API-protocol_v2.0.md` — REST + SSE + MCP + CLI protocol: zod schemas, error-code table mapped to CLI exit codes, optimistic-lock concurrency rules, SSE event types, Python sidecar JSON-RPC protocol (handshake / capability negotiation / dual sidecars), model-weight asset management via `dsh-attachment` content-addressed store with Range resume, loopback token auth and DNS-rebinding protection.
- `AGENTS.md` rewritten in English as an agent-facing operational contract: project goals, nine architecture invariants, repository layout, commands, git workflow, subagent model-tier policy.

### Changed

- Archived the retired MVP as `0.0.0` on an independent branch and local tag. Removed legacy experiment code and CLI configuration examples from the restart branch; its development version is now `0.1.0-dev.0`.

- Restarted the business kernel from the v2.0 design on `codex/restart-v2`; removed the old CLI, business services and their test suites. Retained the pinned DSH bridge/build method, requirements and evaluation materials; historical experiment code is now on the archive branch. The new foundation does not yet implement the MVP translation/export capabilities.

- Export contract: all formats in one task share one frozen `ExportSnapshot`; in-flight outputs are immune to concurrent edits; snapshots are discoverable and deletable only when unreferenced.
- Concurrency model: revision writes use `baseRevisionId`, accept/unaccept uses `expectedAcceptedRevisionId`; stale writes return `409 CONFLICT`.

## [0.0.0] - 2026-09-30

MVP (M0–M4) completed; retired on 2026-10-03 and archived as `0.0.0` on `codex/archive-mvp-0.0.0`. This supersedes the former `0.2.0` designation without rewriting history. The restart is currently `0.1.0-dev.0` (unreleased).

### Added

- Text translation loop with configurable per-stage models (term building vs. body translation).
- Term candidate extraction from designated corpora, with provenance, confirmation workflow, and shared/project library composition.
- Accepted-revision storage with reuse: unchanged reruns and additional export formats perform zero new body-translation calls.
- PDF output via fixed BabelDOC adapter replaying accepted revisions (validated on MuMax3 sample pages 1/2/4); Markdown and JSON exports from the same revision set.
- Simplified CLI: `list`, `status`, `accept-drafts` batch version selection, reusable configuration.
- Requirements baseline v1.0 (44 feature items, F-01–F-44) with priorities, tool candidate pool (83 entries), and source records.
- ADR-0001 runtime selection: Cordis + DSH vendored model modules.
- Term-applicability amendment (amendments/0001): scope dimension orthogonal to library ownership.

### Known limitations

- PDF path limited to the fixed engine and configuration; not a general-purpose arbitrary-PDF tool.
- Explicit revision acceptance required; automatic version selection and a second parser integration pending.
- No Web UI, no external dictionary integration yet.

[Unreleased]: https://github.com/KongouAirlines/ivaraige/compare/v0.0.0...HEAD
[0.0.0]: https://github.com/KongouAirlines/ivaraige/tree/v0.0.0
