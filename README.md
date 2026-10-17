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

*The 0.1.0 workbench. This original sample uses a manually supplied translation; the current interface is primarily Chinese.*

## Make the workflow your own

- **Add what you need.** Start with text and Markdown. Install the optional PDF component when your workflow calls for it.
- **Keep a hand in the result.** Compare source and translation, save drafts, accept revisions, and return to earlier work.
- **Reuse accepted translations.** Export supported formats from one frozen snapshot. Exporting does not ask a model to translate again.
- **Choose how to work.** Use the browser workbench or CLI, or connect an AI client to the shared kernel through [MCP](docs/plan/0.1.0/mcp-guide.md).

## Get started

**0.1.0 source and npm package** — Download the source archive or npm tarball from [v0.1.0](https://github.com/KongouAirlines/ivaraige/releases/tag/v0.1.0), then follow the [installation guide (中文)](docs/plan/0.1.0/installation-guide.md). The repository remains private, so downloads require repository access. See the [development guide (中文)](docs/plan/0.1.0/development-guide.md) to build from source. The new Windows portable package has not been built or validated; the existing [Windows `v0.1.0-dev.0` preview download](https://github.com/KongouAirlines/ivaraige/releases/tag/v0.1.0-dev.0) belongs to that earlier version.

1. Open the workbench and import a TXT or Markdown file.
2. Configure a model when you want machine translation, or enter translations yourself.
3. Review and accept revisions, then export the result.

For PDF, install BabelDOC from **Settings → PDF**, restart the application, and follow the [PDF guide (中文)](docs/plan/0.1.0/pdf-guide.md).

Want to run from source? Follow the [development guide](https://github.com/KongouAirlines/ivaraige/blob/main/docs/plan/0.1.0/development-guide.md). Detailed guides are currently mostly in Chinese.

## What works today

**First formal source version: `0.1.0`.** Features and the interface are still evolving.

| Area | Available scope |
| --- | --- |
| Text & Markdown | Import, translation tasks, manual review, and Markdown/JSON export. Markdown supports a documented subset. |
| PDF · optional | Native-text English PDFs to Chinese monolingual PDFs, with source-page references and frozen PDF/Markdown/JSON export. |
| Saved work | Persistent documents, revisions, tasks, and export snapshots. |
| Access | Local browser workbench, CLI, HTTP/SSE, and MCP over stdio or Streamable HTTP. |
| Platforms | The Node.js kernel has been tested on Windows, Linux, and macOS. The available Windows x64 portable package and PDF component belong to the earlier `v0.1.0-dev.0` release; no `0.1.0` Windows package has been built. |

These capabilities describe the `0.1.0` source and npm tarball built from it. The existing Windows `v0.1.0-dev.0` Release attachments predate MCP and optional-token component installation; they are not `0.1.0` packages. A new Windows package has not yet been built or validated. Public component sources can be read anonymously by this source build; private sources require explicit credentials.

Scanned PDF OCR, bilingual PDF output, EPUB, reusable term libraries, Zotero integration, and general file-processing utilities are future work. Online models receive the text you translate and may charge your provider account. A local workbench does not imply fully offline or free translation. See [capabilities and limits (中文)](docs/plan/0.1.0/capabilities.md).

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

See [contribution guidance](CONTRIBUTING.md) and [security reporting](SECURITY.md). Project licensing is pending team confirmation. Public access to the source, if enabled, does not itself grant an open-source license.

Built with Cordis and DSH, with optional BabelDOC support. See [third-party acknowledgements](THIRD_PARTY.md).
