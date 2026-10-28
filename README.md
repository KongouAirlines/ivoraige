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

### Adapter availability and readable outputs

Missing source components are classified from declared formats and compatible input kinds without executing their matchers. Readable JSON/Markdown exports require an explicit source `readableText` projection; TXT and Markdown declare identity projection, while binary outputs with no requested views remain independent of source projection. Output enumeration and selection share one availability rule and accept an optional content mode: disabled/failed outputs stay unavailable; an unavailable output may explicitly allow a mode through `canRunUnavailable`. Explicit output versions must be nonempty strings; omitted versions retain the `unversioned` compatibility value.

Explicit in-process output version pins are checked before export admission and again at execution. Resume validates the remaining outputs against the frozen snapshot's binding, mode and saved adapter/version before changing a paused/failed task to queued; already completed artifacts keep their checkpoints without needing their former output adapter. Source imports consistently exclude unavailable, disabled and failed adapters from discovery, automatic/explicit selection and queued execution.
