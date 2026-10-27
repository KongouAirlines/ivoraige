<div align="center">

# ivoraige

**Composable translation and file-processing infrastructure for people and AI.**

Bring the tools you need into one workspace. Translate, review, and keep working with your files.

**English** · [简体中文](README.zh-CN.md)

[Get started](#get-started) · [What works today](#what-works-today) · [Where we are heading](#where-we-are-heading) · [Documentation](docs/README.md)

</div>

---

ivoraige brings separate translation and document tools into a workflow you can put together yourself. It is built for learners, students, researchers, and people who translate for the love of it—from study notes and papers to fiction and personal reading.

The goal is a shared foundation for people and AI: choose the capabilities you need, review the results, and carry your work forward across tools and output formats.

![ivoraige workbench with an original fiction excerpt and its accepted Chinese translation](docs/assets/0.1.0/workbench.jpg)

*The 0.1.0 workbench. This original sample uses a manually supplied translation; the current interface is primarily Chinese.*

## Make the workflow your own

- **Add what you need.** Start with text and Markdown. Install the optional PDF component when your workflow calls for it.
- **Keep a hand in the result.** Compare source and translation, save drafts, accept revisions, and return to earlier work.
- **Reuse accepted translations.** Export supported formats from one frozen snapshot. Exporting does not ask a model to translate again.
- **Keep the original structure.** CLI export with `--content-mode source` can produce Markdown or JSON without a target language or accepted translation. For imported PDFs, it can also copy the verified managed original PDF. The default remains accepted-translation export with `--target-lang`.
- **Select an implementation when needed.** `--format` names the document or output format; `--adapter ID` explicitly selects an installed implementation. Otherwise the highest match across compatible input views wins; equal matches require an explicit choice. Queued work keeps the selected implementation and version, and asks you to retry if it changes. A text-only adapter does not replace the optional component for PDF files or binary uploads.
- **Keep export history clear.** If another export blocks admission, the attempted export leaves no new snapshot; existing snapshots remain available.
- **Release work deliberately.** `abandon TASK_ID` ends a failed task's retry claim without changing its error history. `artifacts DOC_ID delete ARTIFACT_ID` removes its record and keeps file bytes. Add `--file-action delete-owned` only when you want to remove a kernel-managed export file. External `--out` files are never eligible for that action. Inspect `artifacts DOC_ID cleanup` after a failed file cleanup and retry the same delete request. See the [development guide](docs/plan/0.1.0/development-guide.md) for backup and recovery boundaries.
- **Back up before Q02 writes.** An existing store remains readable without a bulk conversion. Its first ownership, cleanup or abandon write raises the DSH records unit version before saving that row, so older binaries then refuse to open the store. Restore the complete SQLite and export-file backup to roll back.
- **Choose how to work.** Use the browser workbench or CLI, or connect an AI client to the shared kernel through [MCP](docs/plan/0.1.0/mcp-guide.md).
- **Correct settings errors before saving.** Invalid model compatibility values, including switches unsupported by every model API on a route, and invalid reasoning values are rejected as input errors; CLI `settings --set` rejects malformed JSON and non-object roots (such as `null` or arrays) with `INVALID_ARGUMENT` and exit code 2 in both local and remote modes.

## Get started

**Run 0.1.0 from source.** Follow the [installation guide (中文)](docs/plan/0.1.0/installation-guide.md). The previous Releases and their attachments have been withdrawn; prebuilt downloads will return in a later release. The source repository is public.

Use Node.js `>=24.22.1 <25 || >=26.12.1 <27` with npm. Later stable patches within either supported major are suitable for source use; Node 25 and future majors are outside the current supported range. For a Windows portable build, use the fixed Node.js 26.12.1 runtime.

1. Open the workbench and import a TXT or Markdown file.
2. Configure a model when you want machine translation, or enter translations yourself.
3. Review and accept revisions, then export the result.

For PDF, prepare the optional Windows development environment using the [PDF development guide (中文)](docs/plan/0.1.0/pdf-development.md), then follow the [PDF guide (中文)](docs/plan/0.1.0/pdf-guide.md). The default online component source currently has no downloadable Release.

For configuration, debugging, and contributing, see the [development guide](docs/plan/0.1.0/development-guide.md). Detailed guides are currently mostly in Chinese.

Component installation and document tasks share a bounded background-job quota. A queued document task waits for installation to finish; an installation requested during active document work reports a conflict so you can retry.

## What works today

**First formal source version: `0.1.0`.** Features and the interface are still evolving.

| Area | Available scope |
| --- | --- |
| Text & Markdown | Import, translation tasks, manual review, and Markdown/JSON export. Markdown supports a documented subset. |
| PDF · optional | Native-text English PDFs to Chinese monolingual PDFs, with source-page references and frozen PDF/Markdown/JSON export. |
| Saved work | Persistent documents, revisions, tasks, and export snapshots. |
| Access | Local browser workbench, CLI, HTTP/SSE, and MCP over stdio or Streamable HTTP. |
| Platforms | The Node.js kernel has been tested on Windows, Linux, and macOS. PDF development setup has been verified on Windows x64; prebuilt downloads are currently unavailable. |

These capabilities describe the `0.1.0` source. You can build a local npm tarball yourself. Component management supports anonymous public sources and explicitly authorized private sources, but the previous default Release has been withdrawn.

Scanned PDF OCR, bilingual PDF output, EPUB, reusable term libraries, Zotero integration, and general file-processing utilities are future work. Online models receive the text you translate and may charge your provider account. A local workbench does not imply fully offline or free translation. See [capabilities and limits (中文)](docs/plan/0.1.0/capabilities.md).

## Where we are heading

- More document formats and basic file-processing tools, available as optional capabilities.
- Persistent terminology and richer review workflows for different kinds of translation.
- Integrations such as Zotero, alongside workflows for fiction, learning, and everyday reading.
- Dedicated support for the official Index-Translate API.
- An option to install ivoraige within DSH as a plugin; a lower-priority exploration.

These are directions, not delivery dates. The [0.1.x plan](docs/plan/0.1.x/README.md) proposes incremental contracts and work packages; it does not describe delivered features. The [0.1.0 roadmap](docs/plan/0.1.0/roadmap.md) preserves the earlier direction and context.

## Explore and contribute

[Using the workbench (中文)](docs/plan/0.1.0/workbench-guide.md) · [Model settings (中文)](docs/plan/0.1.0/settings-guide.md) · [Development](docs/plan/0.1.0/development-guide.md) · [Issues](https://github.com/KongouAirlines/ivoraige/issues)

Tell us what you are trying to translate or process, where the workflow gets in your way, and which tools you would like to combine. Reproducible reports and original or shareable samples are especially useful.

See [contribution guidance](CONTRIBUTING.md) and [security reporting](SECURITY.md). The core uses **LGPL-3.0-or-later**; the business modules listed in [LICENSE](LICENSE) use **MIT**. The optional BabelDOC Python plugin uses **AGPL-3.0-only** and is packaged separately. Contributions require DCO sign-off.

Built with Cordis and DSH, with optional BabelDOC support. See [third-party acknowledgements](THIRD_PARTY.md).

Operation and entry composition is available for in-process hosts: register one schema/handler in `operationCatalog`, keep the returned disposer, and use the existing CLI/REST/MCP aliases or the internal generic operation projection. HTTP/CLI/MCP can be omitted independently. The existing workbench uses a subscription-ready barrier and authoritative state refetch; saved artifact reads share ownership, size policy and read leases. See [composition usage](docs/plan/0.1.0/development-guide.md#p04-operation-and-entry-composition) and [P04 evidence](docs/plan/0.1.x/evidence/foundation-p04.md).

For task-admitting or long-running operations, generic CLI `call` needs a persistent host (`--url` or a caller-supplied app); a self-owned local host rejects the call before creating work. Use the existing local CLI aliases to wait for task completion and receive its final exit code.

`delete-owned` requires resource access and export services. If either is unavailable, it returns `COMPONENT_MISSING` before changing the artifact record or creating a cleanup marker; record-only deletion still works with Records alone. MCP lists registered tools while required services are absent, and invocation returns `COMPONENT_MISSING` until they become available. `events: false` disables state streams while retaining the legacy `/api/events` task stream and remote CLI `--json-events`. The `components`, `exportDir`, and `maxArtifactBytes` options require a store.

### Adapter availability and readable outputs

Missing source components are classified from declared formats and compatible input kinds without executing their matchers. Export admission checks the selected outputs: if any declares `requiredViews`, missing Parse returns `COMPONENT_MISSING` before creating a snapshot or task. Output discovery, document `availableOutputs` and state summaries omit formats whose `requiredViews` need absent Parse. `exportDocument` is available when its services and at least one output in a supported content mode are available. Outputs with `requiredViews: []` remain usable without Parse. Readable JSON/Markdown exports require an explicit source `readableText` projection; TXT and Markdown declare identity projection, while binary outputs with no requested views remain independent of source projection. Output enumeration and selection share one availability rule and accept an optional content mode: disabled/failed outputs stay unavailable; an unavailable output may explicitly allow a mode through `canRunUnavailable`. Explicit output versions must be nonempty strings; omitted versions retain the `unversioned` compatibility value.

### Shared artifact file identity

Physical managed-file deletion counts references through file symlinks by their complete canonical target, including aliases in another directory or with a different filename. An unresolved dangling file symlink prevents physical deletion conservatively. Record-only deletion still retains bytes and does not require filesystem identity. Directory aliases and actual filesystem case sensitivity remain supported; external output files and symlink paths themselves are not authorized for managed deletion. The existing boundary against concurrent external replacement is unchanged.

Late operation-catalog mounting also connects registration/withdrawal notifications to the state bridge. Catalog withdrawal and bridge disposal release that listener.

### Task reads in composed hosts

Operations may mount before Records and Tasks. After those services finish mounting, immediate task reads and waits use the Records service present when the request begins; each wait keeps that store through its final read. Missing required services still report COMPONENT_MISSING, and default createApp mounting remains supported.

### MCP request cancellation

Disconnecting an MCP HTTP task poll releases that request subscription and leaves its persistent task running. The MCP HTTP boundary owns each raw Node request lifetime, independent of SDK Request.clone signal forwarding; simultaneous polls remain isolated. Finishing a normal request body does not mean the response disconnected. The same ownership applies to standalone createMcpHttp handlers, and endpoint shutdown aborts outstanding request lifetimes.
