# AGENTS.md — ivoraige

Guidance for AI coding agents working in this repository. Human-facing documentation lives in `README.md` and `docs/`; this file is the operational contract for agents.

## What this project is

ivoraige is composable translation and file-processing infrastructure for people and AI. Learners, students, researchers, and volunteer and hobby translators can assemble only the capabilities they need, including for novels and other mixed-format work. English↔Chinese scientific translation is an early application, not the sole product center. Composition and reuse guide product design. Within translation workflows, two invariants apply:

1. **Translate once.** A text is translated a single time per (content, language direction, constraints); every output (PDF, Markdown, JSON, EPUB, RAG, workbench) consumes the same accepted revisions. Never let an export or rebuild path invoke a translation model.
2. **Terminology persists.** Term bases survive individual tasks and are reused across tasks, with explicit applicability scope (see `docs/requirements/amendments/0001-term-applicability.md`).

## Baselines and current evidence

- Software is `0.1.0-dev.0` (unreleased); v2.0 is the design document version. The retired MVP is version `0.0.0` on `codex/archive-mvp-0.0.0` and tag `v0.0.0`. Do not count its acceptance results as current implementation progress or restore its business layer by default.
- For current capabilities and limits use [the 0.1.0 capability map](docs/plan/0.1.0/capabilities.md); for implementation and verification use [the development guide](docs/plan/0.1.0/development-guide.md) and the relevant stage record.
- The active design baseline is [v2.0](docs/requirements/v2.0/01_design_v2.0.md), with [UI](docs/requirements/v2.0/02_UI-design_v2.0.md) and [process/entry protocol](docs/requirements/v2.0/03_API-protocol_v2.0.md). Requirements [v1.0](docs/requirements/v1.0/) remains frozen (F-01–F-44); do not renumber or reprioritize. C1–C8 in v2.0 §0 are decided constraints, including three OS targets, one kernel for CLI/MCP/WebUI, deployment, DSH reuse, and deferred term-base schema.

## Architecture invariants (do not violate)

1. **Entries contain no business logic.** CLI, MCP server, and WebUI expose installed kernel operations through their protocols. Add a capability to its owning service or adapter, then register it in relevant entries; an entry must not import a concrete format or provider implementation.
2. **Export never translates.** Output adapters cannot obtain the LLM service (Cordis `inject` does not provide it). This is a mechanism, not a discipline.
3. **Frozen snapshots.** Every export task freezes an `ExportSnapshot` at acceptance time; all formats in one task share one `snapshotId`. Editing during export must not change in-flight outputs. Schema and lifecycle: `03_API-protocol_v2.0.md` §2/§3.3.
4. **Reuse requires applicability, not just key match.** `reuseKey` is a lookup index only; reuse also requires the applicability check (source revision, effective context, effective target, term constraint set). See `01_design_v2.0.md` §3.2.
5. **Term scope before match.** Term resolution filters by applicability scope first, then form/language/sense. Project-library priority never overrides scope (amendment 0001).
6. **AI infrastructure comes from DSH plugins.** Model access (`dsh-llm` + `dsh-llm-pi-ai`), credentials, settings, storage, jobs: mount the corresponding DSH plugin. Write no parallel implementation. Only the translation business layer (term assembly, reuse, same-source output, source binding) is ours.
7. **Python only through the sidecar protocol.** The kernel never imports Python. The BabelDOC sidecar speaks NDJSON JSON-RPC 2.0 over stdio (`03_API-protocol_v2.0.md` §7), with development and packaged Windows runtimes; a separate MinerU sidecar and other-platform packaging remain future work.
8. **Usage unknown ≠ zero.** When a provider omits token usage, record it as unknown/null, never 0.
9. **Cross-engine mapping is unverified.** MinerU parsing feeding BabelDOC rebuild requires a separately verified many-to-many source binding. Until then, the BabelDOC capture path is the only PDF route; do not claim otherwise.

## Composition and capability ownership

Follow [ADR-0002](docs/decisions/0002-plugin-composition-0.1.0.md). The composition root may know concrete plugins and installation choices; shared services depend on declared contracts, not a particular format, provider, entry, or sidecar. Format-specific source binding, validation, and replay belong to adapters. Providers and bridges contribute through a narrow registration or service contract rather than adding branches to shared operations. Plugin boundaries follow independently selectable capabilities and lifecycle ownership, not every function.

Declare required and optional dependencies, availability behavior, registration, and cleanup for each added capability. Missing optional components must leave unrelated capabilities usable and give a specific unavailable result when selected. Register listeners, routes, adapters, jobs, subprocesses, and UI contributions with their disposer; close owned work before its dependency is disposed. Do not assume runtime hot unload is required for every component: test the lifecycle the product actually supports, including restart activation where applicable. Prefer a mature upstream plugin/tool over parallel infrastructure; verify its real contract before claiming support. If a format issue comes from our invocation timing or data adaptation, fix that boundary; do not implement a parallel upstream parser or reject usable input to conceal an upstream limitation. Validate source ownership, protocol integrity and frozen-output correctness at their owning boundary, while reporting recoverable quality limitations. Add only the abstraction needed by a working composition, and verify both selected and absent capability paths.

## Repository layout

- `src/` — kernel composition, services, adapters, and the DSH bridge; availability follows installed and tested capabilities.
- `src/records.mjs` / `basis.mjs` — per-document atomic records and reuse applicability; one kernel owns each SQLite file. `src/export.mjs` renders only resolved frozen snapshots. Output adapters receive data, never the Cordis context.
- `src/tasks.mjs` / `translation-model.mjs` — document translation orchestration over DSH jobs and llm. Revisions and unit checkpoints commit together; startup pauses unfinished tasks for explicit resume. Close tasks before disposing the storage context. Unsupported term assembly must fail explicitly.
- `src/adapters/pdf.mjs` / `src/sidecar.mjs` / `sidecars/babeldoc/` — optional PDF source/replay adapter and Python subprocess protocol. Windows development setup is `scripts/setup-pdf.ps1`; user guidance is in `docs/plan/0.1.0/pdf-guide.md`, developer setup in `docs/plan/0.1.0/pdf-development.md`. Import tasks may be canceled but not resumed.
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
- **Version-based naming, always.** Directories and files that record project content are named by software version (`docs/plan/0.1.0/`), never by relative or process wording (`restart`, `legacy`, `old`, `new`, `final`, `backup`, `current`). Prose may describe a process, but anchors, links, branch names and artifact paths must resolve to a version. The design baseline version (`v2.0`) is a document version, distinct from software versions (`0.0.0` archived MVP, current `0.1.0-dev.0`); never conflate them. Development branches are named by software version (e.g. `codex/0.1.0-markdown-compat`); run output directories likewise (`evaluation/runs/<name>-0.1.0/`). Sole exception: follow-up item IDs in `docs/plan/follow-ups/` are stable semantic slugs that must not change across versions (see Follow-up tracking).
- **Boring over clever.** Reuse existing components (DSH plugins, verified OSS) before writing new code. No speculative abstractions, no frameworks for hypothetical needs.
- **Evidence over assertion.** Never write "verified" for code you didn't run; never claim a capability from a name or README. Distinguish observed results from inference. MVP evidence in `docs/plan/mvp/` is retired reference; old source links are resolved on `codex/archive-mvp-0.0.0` or the `v0.0.0` tag, not the current implementation.
- **Proportionate verification.** After a change, verify the affected path (run the suite or a smoke command). Do not re-verify untouched artifacts, re-scan the whole corpus, or add hash gates to routine file passing. Existing import hashes are reused as-is.
- **Originals are read-only.** Modify derived data, never the copyrighted originals in `evaluation/private/`.
- **No scope creep.** Do the requested task. Surface additional issues once, at the end; do not fold them into the change.
- **Keep user guidance in sync.** When behavior or setup changes, update `README.md` (English) and `README.zh-CN.md` together and the relevant user guide; put observed verification in the versioned stage record. `AGENTS.md` is for agent operations, not a substitute for user documentation or a running feature-status log.

## Follow-up tracking

- Follow [the follow-up register rules](docs/plan/follow-ups/README.md). Each newly discovered out-of-scope issue lives in `docs/plan/follow-ups/<stable-id>.md`; existing milestone capabilities stay in the implementation plan. Recording an item does not authorize implementation.
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

## GitHub writing and interaction

- **Write for repository readers.** Issues, PR descriptions, reviews and comments explain the problem, affected behavior, technical reasoning, evidence and relevant limitations. Keep agent instructions, user authorization, delegation, budgets and stopping conditions in the chat. Do not append compliance statements such as "not merged" or "waiting for review". Mention another PR or merge order only when a concrete dependency, conflict or integration requirement matters to readers.
- **Match the artifact.** Issues describe observed versus expected behavior, reproduction, impact and acceptance conditions; distinguish proposals from confirmed defects. PR titles and bodies describe the final full diff against the base, not a chronological work log. Review replies answer the specific concern. General comments add material information that is not already clear from the thread or checks.
- **Use proportionate evidence.** State what was actually verified and any limitation that changes confidence. Link detailed logs and stage records rather than copying them. Keep environment and commit context when results differ; do not erase failures or uncertainty while editing prose. Internal model budgets stay out of public discussion, but measured zero-model export behavior is relevant evidence.
- **Respond on the merits.** Check feedback against code and requirements. For a fix, explain the resulting behavior and relevant regression coverage, with a commit reference when useful. For disagreement, provide evidence and the tradeoff; for deferred work, explain the remaining impact and link a verified follow-up. Do not claim a question is resolved merely because a reply was posted.
- **Separate authorization from publication.** Follow the user's existing authorization for posting, editing, resolving and closing; do not add per-comment approval gates when those actions are already authorized. New scope or consequential decisions still require the applicable authorization. Do not copy these permission rules into repository-facing messages.
- **Resolve accurately.** Under authorization, resolve a review thread after its fix is pushed and relevant verification supports it, or after the discussion has reached agreement. Keep open threads with disputed evidence, unanswered questions or remaining work. Thread resolution is not reviewer approval, PR merge or issue completion. Close issues only when their acceptance conditions and integration requirements are met, unless explicitly closed for another stated reason. Use closing keywords only for issues the PR actually completes; use ordinary references otherwise. The follow-up register retains its own integration-based status rules.
- **Avoid notification noise.** Reply in the original review thread. Add a summary comment only when several changes need synthesis or new evidence matters; do not repeat every inline reply or narrate routine CI polling. Update the PR body when its scope or behavior changes instead of appending a running log.
- **Edit with attribution intact.** When authorized to tidy existing text, edit our own descriptions/comments in place, preserve substantive evidence and links, and leave other reviewers' words and review decisions intact. Do not resolve threads or close issues as a side effect of editorial cleanup.
- **Publication check.** Before sending, ask whether each sentence helps a maintainer understand, verify or decide on the change. Remove sentences whose only purpose is to report the agent's compliance. Keep acknowledgments natural and brief; no mandatory thanks, fixed headings or exhaustive checklists.

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
