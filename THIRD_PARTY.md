# Third-party runtime sources

On `codex/restart-v2`, the pinned source bridge, dependency lock and build
license handling are retained. The old M2 business model service is archived
on `v0.0.0`; the final paragraph is historical reference. The current CLI and
WebUI are new implementations.

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
The added boot dependencies support DSH profile/settings composition; React
and React DOM power the browser workbench. The dependency audit reported zero
advisories for this lockfile during the current stage.

esbuild bundles the reachable Node runtime into `dist/dsh.mjs` and the browser
runtime into `dist/web/app.js`. The Node output includes `DSH-LICENSE.txt`,
`THIRD_PARTY_LICENSES.txt` with actual bundled package notices, and
`build-evidence.json` listing its source inputs. The WebUI output includes
`dist/web/THIRD_PARTY_LICENSES.txt` for React, React DOM and scheduler. Keep
these notices with any distributed bundle. The DSH bundle preserves attribution
headers; the build embeds the pinned LLM package version so its attribution
does not read the project's manifest or depend on the original checkout path.

The business service in `src/model.mjs` mounts explicit OpenAI-compatible
provider routes through DSH. Credential values are resolved by DSH from the
named environment variables at runtime; setup and build do not read `.env`
files or model credentials. Role endpoints must be explicit, and non-loopback
endpoints require `network: true`. Loopback services such as an unauthenticated
LM Studio server may omit `apiKeyEnv`; the mount then supplies a unique,
non-secret dummy credential reference and removes it when unloaded, preventing
ambient provider credential discovery. Remote endpoints require an explicit
credential reference. The SDK's normalized usage cannot prove
whether provider counts were supplied, so M2 records usage as unknown.
