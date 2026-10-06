# AGENTS.md — ivoraige

Guidance for AI coding agents working in this repository. Human-facing documentation lives in `README.md` and `docs/`; this file is the operational contract for agents.

## What this project is

ivoraige is a composable translation middleware. First application: English↔Chinese scientific translation. Two goals outrank everything else:

1. **Translate once.** A text is translated a single time per (content, language direction, constraints); every output (PDF, Markdown, JSON, EPUB, RAG, workbench) consumes the same accepted revisions. Never let an export or rebuild path invoke a translation model.
2. **Terminology persists.** Term bases survive individual tasks and are reused across tasks, with explicit applicability scope (see `docs/requirements/amendments/0001-term-applicability.md`).

## Current state

- MVP (M0–M4) is historical evidence. At the user's explicit request, `codex/restart-v2` starts the business kernel again from the v2.0 baseline at `12b8f37`; old business services/CLI/tests are removed. The retired MVP is version `0.0.0` on independent branch `codex/archive-mvp-0.0.0` (tag `v0.0.0`, commit `27eec14`). Retain the verified DSH bridge/build method; legacy experiments live only on the archive branch. The current software is `0.1.0-dev.0` (unreleased), independent of the v2.0 design document version. Track current capabilities and tests in `docs/plan/0.1.0/README.md`; do not count old acceptance results as new implementation progress. Name future implementation branches by software version; keep the current PR on `codex/restart-v2`.
- Active design baseline is **v2.0** in `docs/requirements/v2.0/`:
  - `01_design_v2.0.md` — architecture, data model, reuse key, frozen export snapshots, milestones M5–M8.
  - `02_UI-design_v2.0.md` — WebUI (shell layout, theming, per-plugin pages, PDF page, DeepL-style text page, workbench).
  - `03_API-protocol_v2.0.md` — REST/SSE/MCP/CLI protocol, error codes, Python sidecar JSON-RPC, asset management, concurrency locks.
- Current new capabilities: TXT/Markdown import, DSH domain/SQLite persistence, language-scoped revisions/acceptance and applicability checks, frozen snapshots, MD/JSON export, and durable import/translation/export tasks. `createApp({store})` enables records; without a store it remains parse-only. `createApp({store,settingsDir})` boots DSH profile/settings/config-editor, credentials, model and jobs; explicit `translation` configuration remains available for examples/tests. CLI, HTTP/SSE and React WebUI now share kernel operations; MCP remains pending. Fast acceptance, careful drafts, pause/resume/cancel and model setting persistence are implemented. Default tests use a local mock provider; an authorized DeepSeek three-unit bilingual smoke and a separate four-call browser workbench run have been observed. Node 24 CI passed 63 tests and package smoke on Windows, Linux and macOS for `c28c583` ([run 37314672867](https://github.com/KongouAirlines/ivaraige/actions/runs/37314672867)). Full scientific quality evaluation, PDF and terminology assembly remain pending. No migration from the retired MVP store.
- Requirements v1.0 (`docs/requirements/v1.0/`) is the frozen feature baseline (44 items, F-01–F-44). Do not renumber or reprioritize.
- Design constraints C1–C8 are registered in `01_design_v2.0.md` §0. They are decided, not open: three OS targets; CLI + MCP + WebUI on one kernel; single-deployment packaging; DSH plugin reuse for AI infrastructure (C8); term-base schema deferred (C7).

## Architecture invariants (do not violate)

1. **Entries contain no logic.** CLI, MCP server, and WebUI only forward to kernel services. New capability = kernel service + one registration per entry.
2. **Export never translates.** Output adapters cannot obtain the LLM service (Cordis `inject` does not provide it). This is a mechanism, not a discipline.
3. **Frozen snapshots.** Every export task freezes an `ExportSnapshot` at acceptance time; all formats in one task share one `snapshotId`. Editing during export must not change in-flight outputs. Schema and lifecycle: `03_API-protocol_v2.0.md` §2/§3.3.
4. **Reuse requires applicability, not just key match.** `reuseKey` is a lookup index only; reuse also requires the applicability check (source revision, effective context, effective target, term constraint set). See `01_design_v2.0.md` §3.2.
5. **Term scope before match.** Term resolution filters by applicability scope first, then form/language/sense. Project-library priority never overrides scope (amendment 0001).
6. **AI infrastructure comes from DSH plugins.** Model access (`dsh-llm` + `dsh-llm-pi-ai`), credentials, settings, storage, jobs: mount the corresponding DSH plugin. Write no parallel implementation. Only the translation business layer (term assembly, reuse, same-source output, source binding) is ours.
7. **Python only through the sidecar protocol.** The kernel never imports Python. BabelDOC and MinerU are separate PyInstaller sidecars speaking NDJSON JSON-RPC 2.0 over stdio (`03_API-protocol_v2.0.md` §7).
8. **Usage unknown ≠ zero.** When a provider omits token usage, record it as unknown/null, never 0.
9. **Cross-engine mapping is unverified.** MinerU parsing feeding BabelDOC rebuild requires a separately verified many-to-many source binding. Until then, the BabelDOC capture path is the only PDF route; do not claim otherwise.

## Repository layout

- `src/` — restarted kernel composition, parsing services/adapters, and retained `dsh-bridge.ts`. Only installed and tested capabilities are available; rebuild business services in stages.
- `src/records.mjs` / `basis.mjs` — per-document atomic records and reuse applicability; one kernel owns each SQLite file. `src/export.mjs` renders only resolved frozen snapshots. Output adapters receive data, never the Cordis context.
- `src/tasks.mjs` / `translation-model.mjs` — document translation orchestration over DSH jobs and llm. Revisions and unit checkpoints commit together; startup pauses unfinished tasks for explicit resume. Close tasks before disposing the storage context. Unsupported term assembly must fail explicitly.
- `test/` — `node --test` suites; must stay green.
- `experiments/` — archive pointer only; old verification rigs are on `codex/archive-mvp-0.0.0` and the `v0.0.0` tag. Ignored local vendor/dependency caches may remain here.
- `evaluation/private/` — copyrighted originals, extracted text, alignment data. Git-ignored by convention; work directly inside it, do not commit its contents.
- `evaluation/runs/` — run outputs.
- `docs/requirements/` (v1.0 frozen, v2.0 active design, amendments), `docs/research/` (tool selection evidence), `docs/plan/mvp/` (milestone records), `docs/decisions/` (ADRs).
- `scripts/` — `setup-dsh.mjs` (vendor DSH), `build.mjs` (esbuild bundle for tests).

## Commands

```bash
npm run setup:dsh   # vendor the pinned DSH runtime (first setup / refresh)
npm test            # build + run all tests
node --test test/*.test.mjs              # current foundation suites after build
npm run smoke:package                   # after build: isolated tarball install and persistence/export smoke
```

Node >= 24. Type "module" (ESM). Do not downgrade the engines field without verifying the dependency closure.

## Conventions

- **Follow the restart decision.** The user requested a fresh business implementation, overriding the earlier incremental migration advice. Keep a thin DSH bridge and small Cordis services; implement the v2.0 target in working stages, without restoring the old business layer by default. Keep the current suites green at every stage.
- **Boring over clever.** Reuse existing components (DSH plugins, verified OSS) before writing new code. No speculative abstractions, no frameworks for hypothetical needs.
- **Evidence over assertion.** Never write "verified" for code you didn't run; never claim a capability from a name or README. Distinguish observed results from inference. MVP evidence in `docs/plan/mvp/` is retired reference; old source links are resolved on `codex/archive-mvp-0.0.0` or the `v0.0.0` tag, not the current implementation.
- **Proportionate verification.** After a change, verify the affected path (run the suite or a smoke command). Do not re-verify untouched artifacts, re-scan the whole corpus, or add hash gates to routine file passing. Existing import hashes are reused as-is.
- **Originals are read-only.** Modify derived data, never the copyrighted originals in `evaluation/private/`.
- **No scope creep.** Do the requested task. Surface additional issues once, at the end; do not fold them into the change.

## Follow-up tracking

- Follow [the follow-up register rules](docs/plan/deferred.md). Each newly discovered out-of-scope issue lives in `docs/plan/follow-ups/<stable-id>.md`; existing milestone capabilities stay in the implementation plan. Recording an item does not authorize implementation.
- Before related work, read relevant workspace items and, as needed, compare the local target branch. For stage planning, use `npm run followups -- --refs <target> <participating-branches>`; this reads committed local snapshots, not uncommitted changes or live remote state. Do not scan every branch for routine tasks.
- Search for duplicates before recording a finding. Include evidence, impact, scope, deferral reason, reassessment trigger, and acceptance conditions. Do not defer a fix required for the current task's acceptance or expand implementation scope merely because a follow-up exists.
- When taking up an item, check existing implementation branches/PRs and record the branch, scope, and acceptance conditions. Local absence is not proof that no other agent is working on it; coordinate overlapping work. Git records are not a global claim lock.
- At stage completion, update related items with observed verification and implementation links. Branch verification alone remains in progress, pending merge. Mark resolved only after acceptance and integration into the named target branch; preserve unfinished scope.
- When merging, reconcile duplicate items and branch-specific evidence without silently overwriting it. Before abandoning a branch, carry valuable unfinished findings into the target branch through a documentation change. Preserve duplicate IDs as redirects to the retained item.
- In the final report, list IDs added, advanced, or resolved. Keep current behavior in feature documentation and historical evidence in implementation records; link them to the item instead of maintaining separate status lists.

## API and protocol work

`03_API-protocol_v2.0.md` is normative for anything crossing a process or entry boundary: error codes (§1.3), optimistic-lock fields (`baseRevisionId` vs `expectedAcceptedRevisionId`, §1.4), SSE event shapes (§4), CLI stdout/exit-code discipline (§5), MCP tool mapping (§6), sidecar methods (§7). If an implementation need contradicts the spec, update the spec in the same change.

## Git workflow

- After completing a stage and its verification, create one local commit directly; no need to ask. Review the staged diff before committing; report the commit hash.
- Push only when the user instructs. PR work happens on a feature branch (e.g. `docs/v2.0-design`), never by committing to `main` first.
- Keep `evaluation/private/` and `evaluation/runs/` out of commits per existing ignore rules; check staged content once when adding new locations.

## Subagents and model selection

Subagents and parallel work are pre-authorized. Choose the model by task difficulty and set it explicitly when spawning (never inherit a high tier by accident):

| Work | Preferred |
|---|---|
| Metadata checks, cataloging, mechanical operations under explicit rules | `gpt-6-luna`, low/medium |
| Ordinary development, parsing glue, bilingual alignment, terminology organization, coordination | `gpt-6-sol`, medium |
| Hard architecture or scientific/technical problems the lower tiers cannot resolve | `gpt-6-astra`, specific problems only |

Escalate based on the actual problem, not a mechanical retry count. Do not spawn an agent to save a few lines of work, and do not start one agent per file. When delegating: state the goal, inputs, and write-scope; have the agent return result paths, a brief conclusion, and open questions. Do not paste whole chats or whole books into prompts. Long tasks get long wait windows; no second-level polling.

## When unsure

The v2.0 design docs answer most "how" questions; amendment 0001 answers terminology-scope questions; `docs/decisions/` records why. If a real ambiguity remains, ask one short question with the options ranked — do not guess and rewrite.
