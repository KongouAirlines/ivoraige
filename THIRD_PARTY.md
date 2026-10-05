# Third-party runtime sources

On `codex/restart-v2`, the verified source bridge, dependency lock and build
license handling below are retained. The old M2 business model service and CLI
are removed; their integration details in the final paragraph are historical
reference (archive `v0.0.0`), not capabilities of the restarted kernel.

The restarted records service now mounts the same pinned DSH storage hub,
storage-domain and storage-sqlite plugins. SQLite comes from Node's built-in
`node:sqlite`; business code never accesses that backend directly. The npm
tarball includes the generated DSH bundle and both generated license notices.

The translation stage also mounts the pinned `dsh-llm`, `dsh-llm-pi-ai`,
`dsh-credentials-local`, and `dsh-jobs-local` plugins. The business layer in
`src/translation-model.mjs` assembles translation requests; `src/tasks.mjs`
adds the durable document queue and checkpoints. It does not implement a
provider HTTP client or a second credentials backend. Credentials use DSH's
named environment references or its managed YAML file. Provider routes are
explicit startup configuration; settings/profile UI integration remains pending.

M2 builds the real Cordis, LLM runtime, pi-ai adapter and storage modules from
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
`@standard-schema/spec` 1.1.0, `chokidar` 4.0.3, `esbuild` 0.28.0,
`js-yaml` 4.2.0, `yaml` 2.9.0 and
`zod` 4.4.3, plus their transitive dependencies. esbuild bundles the reachable
runtime dependency closure into `dist/dsh.mjs`. The output includes
`DSH-LICENSE.txt`, `THIRD_PARTY_LICENSES.txt` with the actual bundled package
notices, and `build-evidence.json` listing its source inputs. Keep these license
files with any distributed bundle. The bundle preserves DSH attribution
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
