# AGENTS.md — ivoraige

Guidance for AI coding agents working in this repository. Human-facing documentation lives in `README.md` and `docs/`; this file is the operational contract for agents.

## What this project is

ivoraige is a composable translation middleware. First application: English↔Chinese scientific translation. Two goals outrank everything else:

1. **Translate once.** A text is translated a single time per (content, language direction, constraints); every output (PDF, Markdown, JSON, EPUB, RAG, workbench) consumes the same accepted revisions. Never let an export or rebuild path invoke a translation model.
2. **Terminology persists.** Term bases survive individual tasks and are reused across tasks, with explicit applicability scope (see `docs/requirements/amendments/0001-term-applicability.md`).

## Current state

- MVP (M0–M4) is complete: text translation loop, term candidate building, accepted-revision storage, BabelDOC replay producing PDF/Markdown/JSON from one accepted revision set, simplified CLI. Tests: `test/*.test.mjs`, all passing.
- Active design baseline is **v2.0** in `docs/requirements/v2.0/`:
  - `01_design_v2.0.md` — architecture, data model, reuse key, frozen export snapshots, milestones M5–M8.
  - `02_UI-design_v2.0.md` — WebUI (shell layout, theming, per-plugin pages, PDF page, DeepL-style text page, workbench).
  - `03_API-protocol_v2.0.md` — REST/SSE/MCP/CLI protocol, error codes, Python sidecar JSON-RPC, asset management, concurrency locks.
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

- `src/` — kernel: `app.mjs` (composition), `cli.mjs`, `records.mjs` (documents/units/revisions), `translation.mjs`, `terms.mjs`, `task.mjs`, `export.mjs`, `pdf-output.mjs`, `source-providers.mjs`, `adapters/` (BabelDOC binding), `dsh-bridge.ts` (DSH vendored runtime).
- `test/` — `node --test` suites; must stay green.
- `experiments/` — verification rigs (`cordis-dsh`, `pdf-injection`); read-only reference, not production code.
- `evaluation/private/` — copyrighted originals, extracted text, alignment data. Git-ignored by convention; work directly inside it, do not commit its contents.
- `evaluation/runs/` — run outputs.
- `docs/requirements/` (v1.0 frozen, v2.0 active design, amendments), `docs/research/` (tool selection evidence), `docs/plan/mvp/` (milestone records), `docs/decisions/` (ADRs).
- `scripts/` — `setup-dsh.mjs` (vendor DSH), `build.mjs` (esbuild bundle for tests).

## Commands

```bash
npm run setup:dsh   # vendor the pinned DSH runtime (first setup / refresh)
npm test            # build + run all tests
node --test test/text-workflow.test.mjs   # single suite
```

Node >= 24. Type "module" (ESM). Do not downgrade the engines field without verifying the dependency closure.

## Conventions

- **Match existing patterns.** `src/*.mjs` modules with a thin `dsh-bridge.ts`; extend, don't restructure. The v2.0 docs describe the target architecture; migrate incrementally, keep tests green at every step.
- **Boring over clever.** Reuse existing components (DSH plugins, verified OSS) before writing new code. No speculative abstractions, no frameworks for hypothetical needs.
- **Evidence over assertion.** Never write "verified" for code you didn't run; never claim a capability from a name or README. Distinguish observed results from inference. MVP evidence lives in `docs/plan/mvp/`.
- **Proportionate verification.** After a change, verify the affected path (run the suite or a smoke command). Do not re-verify untouched artifacts, re-scan the whole corpus, or add hash gates to routine file passing. Existing import hashes are reused as-is.
- **Originals are read-only.** Modify derived data, never the copyrighted originals in `evaluation/private/`.
- **No scope creep.** Do the requested task. Surface additional issues once, at the end; do not fold them into the change.

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
