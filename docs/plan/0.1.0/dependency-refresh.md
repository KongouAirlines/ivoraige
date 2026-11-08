# Dependency refresh and latest-Node CI (2026-11-08)

Software remains `0.1.0`. This change starts at `main/9a7c930` on `codex/0.1.0-dependency-refresh` and updates the existing runtime dependency closure without changing application protocols, data schemas or the DSH integration.

## Versions and scope

| Package | Previous | Updated |
| --- | --- | --- |
| `zod` | 4.4.3 | 4.6.7 |
| `fast-uri` (AJV dependency) | 3.1.8 | 3.1.9 |
| `@modelcontextprotocol/server`, `client`, `core` | 2.3.1 | 2.4.0 |
| `@modelcontextprotocol/node` | 2.1.1 | 2.1.2 |
| `@hono/node-server` | 1.19.17 | 2.1.6 |
| `hono` | 4.13.13 | 4.13.17 |
| `yaml` | 2.9.0 | 2.9.1 |
| `semver` | 7.8.5 | 7.8.6 |
| `marked` (development only) | 18.1.1 | 18.1.3 |

Direct dependencies remain exact pins. Transitive packages are fixed by the lockfile. MCP node 2.1.2 explicitly accepts `@hono/node-server` `^1.19.9 || ^2.1.3` and requires server `^2.4.0`; no override bypasses upstream compatibility ranges. The server, client and core resolve to one matching 2.4.0 family.

DSH stays at `639ed015397290b3745d163aafe02ffee4aa3f84`, with its matching vendored Cordis, Cosmokit and Schemastery. `@earendil-works/pi-ai` remains 0.87.1. React, React DOM, jsdom, chokidar and BabelDOC are unchanged. The MCP wire mapping, storage formats, export behavior and engine compatibility policy are unchanged.

## CI and runtime policy

The [official Node release index](https://nodejs.org/dist/index.json) identified [26.13.0](https://nodejs.org/en/blog/release/v26.13.0) as the latest stable release on this date; 27.0.0-alpha.0.0.0 is a prerelease. The package workflow now runs the locked dependencies on exactly Node 26.13.0 across Linux, macOS and Windows, retaining both Python fixture stages, the full Node suite and the isolated package smoke. The previous Node 24 jobs and additional Windows 26.12.1 job are removed from the matrix. Issue triage is unchanged.

This CI choice does not withdraw Node 24 runtime support: `engines` and the runtime gate remain `>=24.22.1 <25 || >=26.12.1 <27`. Node 24 no longer has a CI job. The separately validated Windows portable runtime stays pinned to 26.12.1 with its matching license; this task does not rebuild or publish Windows/PDF release archives.

The local verification used the official isolated `node-v26.13.0-win-x64.zip`, SHA-256 `dcc60d59a0746999f99064a01c020445d54d84228c691cdbf25b49ac3b59150a`, matching the [official SHA-256 manifest](https://nodejs.org/dist/v26.13.0/SHASUMS256.txt). The system Node installation was not changed.

## Observed verification

Windows x64, Node 26.13.0, bundled npm 11.20.0 and Python 3.13.12:

- Every changed package's tarball URL and integrity were checked against `registry.npmjs.org`; the lockfile uses official registry URLs. A clean `npm ci --ignore-scripts` passed. The initial restricted-shell clean install failed with EPERM before the successful retry in the subprocess/loopback-capable execution environment.
- Official-registry `npm audit` reported **0 advisories** across the final lockfile. The machine's default npm mirror does not implement the audit endpoint, so its failed request is not audit evidence.
- `npm test` rebuilt Node and browser bundles, then passed **558 tests, 3 skipped, 0 failed** (561 total). The Windows skips are two file-symlink fixtures blocked by EPERM and a POSIX-permission fixture, not accepted coverage for those paths.
- Focused dependency-closure and MCP transport/lifecycle tests passed **24/24**. This covers the official 2.4.0 client with stdio and Streamable HTTP, cancellation and shutdown behavior.
- Python sidecar protocol/engine-boundary fixtures passed **20/20**; release archive audit fixtures passed **4/4**. They do not exercise a real BabelDOC engine or PDF quality.
- The generated DSH bundle lists **1,020 source inputs**. Its actual dependency inputs and matching license notices include zod 4.6.7, fast-uri 3.1.9, yaml 2.9.1 and semver 7.8.6; pi-ai remains 0.87.1. New regression tests check patched schema/URI versions in the lockfile, installed packages and actual bundle inputs, and matching MCP server/client/core versions.

`npm run smoke:package` passed with an **83-file** tarball: isolated parsing, same-version reinstall with complete data backup, saved settings, frozen snapshot and original exports, MCP discovery/call and static UI. Remote exact-head CI is checked separately in the pull request. No paid model, real credentials, private document corpus or user-library migration was used. Follow-up IDs were not added, advanced or resolved.
