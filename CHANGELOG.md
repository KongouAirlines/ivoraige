# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Rebuilt the text workbench with TXT/Markdown import, shared CLI/HTTP/SSE and React pages for documents, revisions, tasks and settings. DSH profiles and named credentials persist model routing; translation tasks support fast acceptance, careful drafts, pause/resume/cancel, manual revision acceptance and rollback.
- Added language-scoped revisions, applicability checks, frozen export snapshots, and Markdown/JSON output from the same accepted revisions. Export does not call a model; durable task checkpoints and accepted revisions survive restart.
- Added npm packaging and Node 24 CI on Windows, Linux and macOS, with an opt-in DeepSeek smoke workflow.
- Added the v2.0 architecture, UI and API protocol design baseline in `docs/requirements/v2.0/`; it describes the future product separately from the current `0.1.0-dev.0` implementation.

### Changed

- Archived the retired MVP as `0.0.0` on independent branch `codex/archive-mvp-0.0.0` and tag `v0.0.0`. The earlier `0.2.0` label was never issued as a release; the archive uses `0.0.0` to distinguish that retired implementation from the new `0.1.0-dev.0` line. Historical commits remain unchanged.
- Restarted the business kernel on `codex/restart-v2`; retained the pinned DSH bridge/build method, requirements and evaluation material, while replacing the old business services, CLI and tests.

## [0.0.0] - 2026-10-03

MVP (M0–M4) historical implementation, retired and archived on `codex/archive-mvp-0.0.0` (tag `v0.0.0`, commit `27eec14`).

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

[Unreleased]: https://github.com/KongouAirlines/ivaraige/pull/4
[0.0.0]: https://github.com/KongouAirlines/ivaraige/tree/codex/archive-mvp-0.0.0
