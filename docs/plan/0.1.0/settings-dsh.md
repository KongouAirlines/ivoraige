# 0.1.0 settings client reuse (S0)

Pinned DSH source: `639ed015397290b3745d163aafe02ffee4aa3f84`, installed by `npm run setup:dsh` under `experiments/vendor/deepseek-harness`. The browser build resolves these sources directly and fails on an unlisted DSH package import. This keeps the client choice tied to the same pinned source as the server bundle.

## Reused boundary

`web/settings-runtime.mjs` uses DSH `ui-slots` `SlotCore`. It declares `settings.section` as a root-scoped ordered list, the same slot shape specified by `packages/client/ui-settings/src/client/contract/slots.ts`. Every bundled page is registered with `{ id, label, order }`, and the live DSH ledger supplies the ordered snapshot. Each page registration is owned by an actual Cordis plugin fiber; disposing that fiber releases its slot registration. The host sends data-only page descriptors. Executable React components are selected from the static web build.

The runtime API is `createSettingsRuntime({ models: ModelsPage, pdf: PdfPage })`. `await runtime.sync(descriptors)` applies host registrations, `runtime.getSnapshot()` returns stable ordered `{ id, label, order, component }` rows, `runtime.subscribe(listener)` supports `useSyncExternalStore`, and `await runtime.dispose()` releases the fibers and root declaration. Unknown host page IDs are omitted until a matching component is bundled. Identical descriptors preserve the snapshot reference. Concurrent sync calls are serialized and only the latest generation publishes navigation.

The settings runtime's DSH dependency closure, observed from its esbuild output, is `ui-slots/src/index.ts`, `vendor/cordis/src/{context,events,fiber,logger,reflect,registry,utils}.ts`, and `vendor/cosmokit/src/{misc,string,time,types}.ts`. Type-only dependencies disappear from the bundle. The production `dist/web/app.js` includes this source. `dist/settings-runtime-test.mjs` is a separate Node-importable build for tests, outside the package's published file list. `scripts/build-web.mjs` removes the obsolete `dist/web/settings-runtime.mjs` duplicate from prior builds; the SPA does not fetch it. `dist/web/THIRD_PARTY_LICENSES.txt` includes the pinned DSH root, Cordis, and Cosmokit licenses alongside React's notices.

## Shell decision

The upstream `ui-settings-general` SettingsRoot is coupled to DSH sidebar, connection, locale, shortcuts, remote settings, store, modal primitives, CSS modules, and its General/onboarding content. `ui-settings` itself requires `remote` and `remote.settings` for schema forms and a describe mirror. The current ivoraige SPA has REST/SSE and its own workbench, without that client composition. S0 therefore reuses DSH's settings registration contract and Cordis lifecycle while the window uses a local dialog shell. The dialog only projects registered page components; it does not own page registration or settings persistence. Model persistence remains in the existing DSH-backed kernel services.

## Observed verification

On this branch, `node scripts/build-web.mjs` completed. `node --test test/settings-runtime.test.mjs test/settings-navigation.test.mjs` passed seven tests covering model-only, PDF-only, both, neither, ordered component identity, unmount, identical refresh, rapid superseding updates, a removal supersession race, disposal during a Cordis registration, invalid descriptors, and owned settings history positions. These checks run the bundled pinned DSH and Cordis code. They do not establish browser keyboard behavior, PDF processing, or the later S1/S2 editing flows.
