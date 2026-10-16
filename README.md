<div align="center">

# ivoraige

**Composable translation and file-processing infrastructure for people and AI.**

Bring the tools you need into one workspace. Translate, review, and keep working with your files.

**English** · [简体中文](README.zh-CN.md)

[Get started](#get-started) · [What works today](#what-works-today) · [Where we are heading](#where-we-are-heading) · [Documentation](https://github.com/KongouAirlines/ivaraige/blob/main/docs/README.md)

</div>

---

ivoraige brings separate translation and document tools into a workflow you can put together yourself. It is built for learners, students, researchers, and people who translate for the love of it—from study notes and papers to fiction and personal reading.

The goal is a shared foundation for people and AI: choose the capabilities you need, review the results, and carry your work forward across tools and output formats.

![ivoraige workbench with an original fiction excerpt and its accepted Chinese translation](docs/assets/0.1.0/workbench.jpg)

*The 0.1.0 preview workbench. This original sample uses a manually supplied translation; the current interface is primarily Chinese.*

## Make the workflow your own

- **Add what you need.** Start with text and Markdown. Install the optional PDF component when your workflow calls for it.
- **Keep a hand in the result.** Compare source and translation, save drafts, accept revisions, and return to earlier work.
- **Reuse accepted translations.** Export supported formats from one frozen snapshot. Exporting does not ask a model to translate again.
- **Choose how to work.** Use the browser workbench or CLI today. MCP access for AI clients is under review in [PR #18](https://github.com/KongouAirlines/ivaraige/pull/18).

## Get started

**Windows preview** — See [Releases](https://github.com/KongouAirlines/ivaraige/releases) and the [installation guide (中文)](docs/plan/0.1.0/installation-guide.md). The portable package includes its runtime: extract it and open `ivoraige.cmd`.

1. Open the workbench and import a TXT or Markdown file.
2. Configure a model when you want machine translation, or enter translations yourself.
3. Review and accept revisions, then export the result.

For PDF, install BabelDOC from **Settings → PDF**, restart the application, and follow the [PDF guide (中文)](docs/plan/0.1.0/pdf-guide.md).

Want to run from source? Follow the [development guide](https://github.com/KongouAirlines/ivaraige/blob/main/docs/plan/0.1.0/development-guide.md). Detailed guides are currently mostly in Chinese.

## What works today

**Early preview: `0.1.0-dev.0`.** Features and the interface are still evolving.

| Area | Available scope |
| --- | --- |
| Text & Markdown | Import, translation tasks, manual review, and Markdown/JSON export. Markdown supports a documented subset. |
| PDF · optional | Native-text English PDFs to Chinese monolingual PDFs, with source-page references and frozen PDF/Markdown/JSON export. |
| Saved work | Persistent documents, revisions, tasks, and export snapshots. |
| Access | Local browser workbench and CLI; MCP is a separate PR pending merge. |
| Platforms | Windows x64 portable package and PDF component. The Node.js kernel is tested on Windows, Linux, and macOS; this does not imply three-platform PDF packages. |

Scanned PDF OCR, bilingual PDF output, EPUB, reusable term libraries, Zotero integration, and general file-processing utilities are future work. A local workbench can still use an online model; it does not imply fully offline translation. See [capabilities and limits (中文)](docs/plan/0.1.0/capabilities.md).

## Where we are heading

- More document formats and basic file-processing tools, available as optional capabilities.
- Persistent terminology and richer review workflows for different kinds of translation.
- Integrations such as Zotero, alongside workflows for fiction, learning, and everyday reading.
- Dedicated support for the official Index-Translate API.
- An option to install ivoraige within DSH as a plugin; a lower-priority exploration.

These are directions, not delivery dates. See the [roadmap](https://github.com/KongouAirlines/ivaraige/blob/main/docs/plan/0.1.0/roadmap.md) for scope and tracking.

## Explore and contribute

[Using the workbench (中文)](docs/plan/0.1.0/workbench-guide.md) · [Model settings (中文)](docs/plan/0.1.0/settings-guide.md) · [Development](https://github.com/KongouAirlines/ivaraige/blob/main/docs/plan/0.1.0/development-guide.md) · [Issues](https://github.com/KongouAirlines/ivaraige/issues)

Tell us what you are trying to translate or process, where the workflow gets in your way, and which tools you would like to combine. Reproducible reports and original or shareable samples are especially useful.

Built with Cordis and DSH, with optional BabelDOC support. See [third-party acknowledgements](THIRD_PARTY.md).
