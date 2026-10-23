# Cordis RC11 candidate execution

Execution date: 2026-10-23. This record separates the production baseline from an isolated source candidate. See [upstream and patch audit](cordis-rc11-upstream.md) and [independent probes](cordis-rc11-validation.md).

## Baseline

GitHub and local Git both reported main at `8dc548d9b08d8d6374c66920efca24135d9ce86d`. Foundation PRs #45, #46, #48 and #49 were open and unmerged. The isolated candidate starts from the independently reviewed #49 head `9c22bd38df1153624eb232db47d1cc67422e2b87`; `git merge-base --is-ancestor` confirms the final #45, #46 and #48 heads are its ancestors. The prior candidate #47 remains separate and is not an RC11 baseline.

The production runtime source is DSH `639ed015397290b3745d163aafe02ffee4aa3f84`, whose vendor table identifies Core RC7 and Loader RC5. Harness package `@deepseek-ai/cordis@4.0.4` is not a stable Core version.

Fresh Windows / Node 26.12.1 baseline execution in this isolated checkout:

| Check | Observed result |
| --- | --- |
| Exact root lock installation, `npm ci --no-audit --no-fund` | 173 packages installed |
| `npm run setup:dsh` | Clean checkout at the fixed production DSH SHA |
| `npm test` | 301/301 passed; zero failed, cancelled or skipped |
| `npm run smoke:package` | Passed; 70-file tarball, isolated install, parsing, same-version reinstall with full data backup, settings, frozen snapshot/original exports, MCP discovery/call and static assets |
| Preserved baseline tarball | 1,244,887 bytes; SHA256 `e1e9890bc6144df4ff417e2920ff6f6122224a651463b380d95b0280d4f46488` |

Local baseline logs and rollback artifacts are outside the Git checkout, in `../baseline-test.log`, `../baseline-package.log` and `../baseline-artifacts/`. The tarball was packed with only an untracked test addition; its runtime and business source remained at the baseline, and its release metadata correctly says the source tree was modified. Rebuilding the fixed baseline from a clean checkout is the durable rollback source; local artifacts are supplementary evidence.

## Fixed candidate and reproducibility

The explicit `IVORAIGE_RUNTIME=cordis-rc11` build mode replaces actual source resolution; changing a root npm version is not involved. The default `pinned` mode still uses the production DSH source. Server and browser builds share [the candidate resolver](../../../../scripts/runtime-patches/0.1.x/candidate-rc11.mjs), which rejects an unexpected or tracked-dirty source checkout and applies guarded source transformations without editing that checkout.

| Component | Candidate source |
| --- | --- |
| DSH application consumers | `639ed015397290b3745d163aafe02ffee4aa3f84` |
| Core RC11 + Loader RC8 | Cordis `0b96d9fd517b998e44e2209560c9e5f0671ce933` |
| Include, Group, Cosmokit, Schemastery | The production DSH vendor copies, with their existing private extensions; this candidate does not use upstream Include 1.1.1 |
| Local compatibility overlay | Seven named groups across six source files: Core disposal state and isolation lookup, Loader canonical fiber, DSH ConfigEditor config hook/single validation, AppBoot update hook and pi-ai config hook |

The isolation overlay adapts the behavior of post-tag #209 to RC11's getter implementation; it is not a cherry-pick of the full later refactor. #133's final disposal state is also explicitly adapted. Both are covered by strict probes. Neither change establishes that all DSH lifecycle or configuration extensions survived.

From a fresh checkout with the supported Node version:

```powershell
npm ci
npm run setup:dsh
$env:IVORAIGE_RUNTIME = 'cordis-rc11'
npm test
node --test test/runtime-probes/*.test.mjs
npm run smoke:package
```

On POSIX shells, set `export IVORAIGE_RUNTIME=cordis-rc11` instead. The first candidate build fetches the exact Cordis source. Each validation command has its own nonzero failure status; do not mask those statuses. Use a separate process or set the mode to `pinned` before rebuilding the production combination.

## Final local candidate observations

Windows / Node 26.12.1, same frozen bundle SHA256 `40561d61cb397b127ecad3780211d2b9b3fe7b222b34ceb7100be6c4d9db6d66`:

| Gate | Observed result |
| --- | --- |
| Actual source and emitted graph | Passed. One Core root, nine Core inputs and 47,707 emitted Core bytes; one RC8 Loader root; fixed DSH Include root. Browser selects the same Core source. |
| Runtime class identity | Exported LlmRuntime, ConfigEditor and SettingsForms share the exported Service identity. The installed app and Records share the same Context root. |
| Full ordinary suite | **291/301 passed, ten failed**, zero cancelled/skipped. Log: `../candidate-test.log`. A prior run affected by concurrent rebuilding was discarded and is not this result. |
| Independent lifecycle/isolation suite | **9/11 passed**, two DSH V6 disposal regressions. The old combination passed 10/11, failing only the isolation bug targeted by #209. |
| Independent consumer subset | **61/68 passed**, seven settings/profile failures. Log: `../rc11-targeted-final.log`. |
| Clean installed tarball | Constructed and installed a 73-file package containing source/metafile/identity evidence; shared identities passed. The strict smoke then **failed** after settings PATCH: `configured.settings.selected` remained null. Log: `../candidate-package.log`. |
| Existing record, source and frozen-output compatibility | Existing tests for pre-P03 identity, old snapshots, owned-source restart/relocation, frozen outputs, parse-only composition, cancellation/recovery and local full-text translation passed within the full run. This does not override failed configuration/entry gates or establish safe use of real user profiles. |
| Three-platform CI | The workflow runs both `pinned` and `cordis-rc11` on Windows/macOS/Ubuntu Node 24.22.1 and Windows Node 26.12.1. Candidate probes and tarball smoke still execute after an ordinary-suite failure; no failure is converted to success. Final branch checks provide the remote results. |

The ten full-suite failures are two component-install task lookups through HTTP/CLI, the credential-free DeepSeek preset catalogue, six model-settings tests and one settings-pages profile/restart test. This is a regression on the production DSH consumer SHA, not reuse of #47's newer DSH pin. No test expectation was changed to make the candidate pass.

The source and identity evidence is included in the actual package as `dist/build-evidence.json`, `dist/web-build-evidence.json` and `dist/runtime-identity.json`. A supplementary local candidate archive is retained in `../candidate-artifacts/`; it was packed from the modified candidate checkout and is not a released package. The frozen bundle hash above, exact source SHAs, guarded overlay and committed build wiring identify what was tested.

## Blocking semantics, cost and recommendation

**Do not adopt this candidate. P01/P05 runtime gates failed.** Keeping only the old Loader with RC11 Core instead also failed at Include startup (`null.entry`); swapping upstream Include directly failed the build because DSH AppBoot/ConfigEditor require its private patch/schema exports. These alternatives are diagnostic slices, not supported tuples.

The central unresolved contract is active effective configuration. Production DSH stores the validated object, including volatile references, in `Fiber.config`. Its Loader `_commitVolatile()` updates the actual mounted instance's references. RC11 stores raw input in `Fiber.config` and computes the validated object locally during activation. Copying the old Loader method therefore does not reach the live instance. Candidate validation must also avoid publishing an uncommitted resolved object over the active one. A safe migration needs a defined Core–Loader config/commit/update interface, a migrated V22 implementation and consumer regression evidence; adding that state and maintaining it privately exceeds a routine compatibility patch.

Two other verified costs remain: the DSH V6 ownership ordering that makes disposal callable during `internal/plugin`, and teardown-observer error containment that prevents one observer from starving later observers or owned cleanup. The candidate's new probes expose both regressions. Include persistence/lazy-expression behavior also remains a compatibility obligation; retaining the old Include in a build is not evidence of complete RC11 integration.

The existing overlay is seven small compatibility groups; it is **not** a complete patch migration. [The audit](cordis-rc11-upstream.md) accounts for all 22 production vendor modifications and identifies retained, equivalent, irrelevant and unresolved items. Further work would require maintained Core configuration state, Loader volatile/diff semantics, lifecycle ownership hardening and Include/DSH consumer integration, followed by these same gates. The concrete failed behavior, rather than the number of touched packages, is the stopping reason.

Retain DSH `639ed015397290b3745d163aafe02ffee4aa3f84` as the supported choice for now. Reassess when DSH supplies a fixed RC11-compatible consumer/configuration contract and lifecycle patch set, or when maintaining that bounded private compatibility layer is an explicit project decision. The isolated source candidate, strict failures and dual-mode build are the deliverable; migration success, P05 distribution acceptance and production adoption are not claimed.

Rollback uses the complete production source tuple and prior artifacts: rebuild with `IVORAIGE_RUNTIME=pinned`, then run the ordinary suite and package smoke. No Records, record/snapshot schema, external API, plugin packaging or product UI source was changed. All runtime experiments used generated stores/profiles, inert fixtures and local provider doubles; no real user database or credential was migrated.

This rollback path was executed after the candidate experiments: `npm test` passed **301/301**, and the updated **73-file** clean tarball smoke passed with the same provenance/identity assertions. Logs are `../rollback-test.log` and `../rollback-package.log`. The restored DSH bundle SHA256 is `008ad36d90bbd8c1c9008e0e21cf331cdd95a09c34c6353c9a6c465da937b4e0`, equal to the preserved initial baseline bundle.
