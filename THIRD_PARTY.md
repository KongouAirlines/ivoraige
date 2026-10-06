# Third-party runtime sources

On `codex/restart-v2`, the pinned source bridge, dependency lock and build
license handling are retained. The retired MVP business model service is on
`codex/archive-mvp-0.0.0` (tag `v0.0.0`). The current CLI and WebUI are
new implementations for `0.1.0-dev.0`.

The restarted records service now mounts the same pinned DSH storage hub,
storage-domain and storage-sqlite plugins. SQLite comes from Node's built-in
`node:sqlite`; business code never accesses that backend directly. The npm
tarball includes the generated DSH bundle, WebUI assets and license notices.

The translation stage also mounts the pinned `dsh-llm`, `dsh-llm-pi-ai`,
`dsh-credentials-local`, and `dsh-jobs-local` plugins. The business layer in
`src/translation-model.mjs` assembles translation requests; `src/tasks.mjs`
adds the durable document queue and checkpoints. It does not implement a
provider HTTP client or a second credentials backend. Credentials use DSH's
named environment references or its managed YAML file. The text workbench
boots a DSH profile with `dsh-settings` and `dsh-config-editor`; model routes
and selection persist there and can update live. The React WebUI and CLI
forward to the same kernel operations as HTTP. Export consumes frozen
revisions and does not call the LLM.

The current build uses Cordis, LLM runtime, pi-ai adapter, profile/settings and storage modules from
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) at commit
`639ed015397290b3745d163aafe02ffee4aa3f84`. The DSH source is MIT licensed,
Copyright (c) 2026 DeepSeek. Its vendored Cordis, cosmokit and schemastery
copies retain their upstream MIT license and attribution files; the build uses
these matching vendored copies, rather than separately updating Cordis.

The source checkout and generated bundle are local, ignored artifacts. Obtain
the fixed checkout with `npm run setup:dsh`; an existing clean checkout at the
fixed commit is reused. Run `npm ci` in a clean project, then `npm run build`.
With the M1 experiment dependencies already present, the build can reuse
`experiments/cordis-dsh/node_modules` without reinstalling them.

The dependency lockfile fixes `@earendil-works/pi-ai` 0.87.1,
`@standard-schema/spec` 1.1.0, `@eslint-community/regexpp` 4.12.2,
`ajv` 8.20.0, `chokidar` 4.0.3, `esbuild` 0.28.2, `js-yaml` 4.3.2,
`resolve.exports` 2.0.3, `semver` 7.8.5, `yaml` 2.9.0, `zod` 4.4.3,
`react` 18.3.1 and `react-dom` 18.3.1, plus their transitive dependencies.
These dependencies come from the pinned DSH source used in the build closure:
`credentials-local` imports `yaml` and `chokidar`; `config-editor` imports both
`js-yaml` and `yaml` (the latter preserves YAML structure and comments);
`app-boot` also imports `js-yaml`. Its compatibility modules import `semver`,
the config-schema projector loads `ajv`, its pattern validator loads
`@eslint-community/regexpp`, and profile resolution imports
`resolve.exports`. React and React DOM power the browser workbench. The
dependency audit reported zero advisories for this lockfile during the
current stage.

esbuild bundles the reachable Node runtime into `dist/dsh.mjs` and the browser
runtime into `dist/web/app.js`. The Node output includes `DSH-LICENSE.txt`,
`THIRD_PARTY_LICENSES.txt` with actual bundled package notices, and
`build-evidence.json` listing its source inputs. The WebUI output includes
`dist/web/THIRD_PARTY_LICENSES.txt` for React, React DOM and scheduler. Keep
these notices with any distributed bundle. The DSH bundle preserves attribution
headers; the build embeds the pinned LLM package version so its attribution
does not read the project's manifest or depend on the original checkout path.

The current translation service in `src/translation-model.mjs` uses DSH LLM
routes. Credential values are resolved by DSH at runtime; setup and build do
not read model credentials. The current workbench persists a named credential
reference and DSH model settings, while explicit translation configuration
remains available for examples and tests. When a provider omits usage, the
business task records unknown (`null`) rather than zero.
