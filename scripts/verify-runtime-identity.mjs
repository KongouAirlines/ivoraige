import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const evidence = JSON.parse(await readFile(resolve(root, 'dist/build-evidence.json'), 'utf8'))
const browser = JSON.parse(await readFile(resolve(root, 'dist/web-build-evidence.json'), 'utf8'))
const mode = process.env.IVORAIGE_RUNTIME ?? 'pinned'
assert.ok(['pinned', 'cordis-rc11'].includes(mode), `Unknown runtime mode: ${mode}`)
const normalize = path => path.replaceAll('\\', '/')
const inputs = evidence.inputs.map(normalize)
const coreRoot = path => path.match(/^(.*(?:vendor\/cordis|cordis-rc11\/packages\/core))\/src\//)?.[1]
const roots = [...new Set(inputs.map(coreRoot).filter(Boolean))]
assert.equal(roots.length, 1, `Expected one Core source root; found ${JSON.stringify(roots)}`)
assert.equal(roots[0].endsWith('cordis-rc11/packages/core'), mode === 'cordis-rc11')
assert.equal(browser.runtimeMode, mode)
assert.deepEqual(browser.coreRoots, roots, 'Browser and host must select the same Core source')
assert.ok(!inputs.some(path => /node_modules\/(?:cordis|@deepseek-ai\/cordis|@cordisjs\/core)\//.test(path)),
  'A package Core is mixed with the source Core')
const componentRoots = {}
for (const name of ['loader', 'include']) {
  const pattern = new RegExp(`^(.*(?:vendor/${name}|cordis-rc11/packages/${name}))/src/`)
  const found = [...new Set(inputs.map(path => path.match(pattern)?.[1]).filter(Boolean))]
  assert.equal(found.length, 1, `Expected one ${name} source root`)
  const expected = name === 'loader' && mode === 'cordis-rc11'
    ? 'cordis-rc11/packages/loader' : `deepseek-harness/vendor/${name}`
  assert.ok(found[0].endsWith(expected), `${name} must come from ${expected}`)
  componentRoots[name] = found[0]
}
assert.ok(!inputs.some(path => /node_modules\/(?:@cordisjs\/plugin-(?:loader|include)|@deepseek-ai\/cordis-plugin-(?:loader|include))\//.test(path)),
  'A package Loader or Include is mixed with the source tuple')
const emitted = Object.values(evidence.outputs ?? {}).flatMap(output => Object.entries(output.inputs ?? {}))
const coreBytes = emitted.filter(([path]) => coreRoot(normalize(path)) === roots[0])
  .reduce((sum, [, info]) => sum + info.bytesInOutput, 0)
assert.ok(coreBytes > 0, 'Metafile must prove Core contributes bytes to the runtime output')
for (const file of ['context.ts', 'service.ts', 'fiber.ts', 'reflect.ts']) {
  assert.ok(emitted.some(([path, info]) => normalize(path) === `${roots[0]}/src/${file}` && info.bytesInOutput > 0),
    `Core ${file} did not contribute to the output`)
}
const runtime = await import(pathToFileURL(resolve(root, 'dist/dsh.mjs')))
for (const name of ['LlmRuntime', 'ConfigEditor', 'SettingsForms']) {
  assert.ok(runtime[name].prototype instanceof runtime.Service, `${name} must share the exported Service identity`)
}
const host = new runtime.Context()
assert.ok(runtime.Context.is(host))
await host.fiber.dispose()
const report = { mode, dshCommit: evidence.dshCommit, cordisCommit: evidence.cordisCommit ?? null,
  coreSourceRoot: roots[0], coreInputs: inputs.filter(path => coreRoot(path) === roots[0]), coreBytes,
  componentRoots,
  browserCoreRoots: browser.coreRoots,
  serviceIdentityChecks: ['LlmRuntime', 'ConfigEditor', 'SettingsForms'], patchIds: evidence.patchIds ?? [] }
await writeFile(resolve(root, 'dist/runtime-identity.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`Runtime identity passed: ${mode}; one Core (${report.coreInputs.length} source inputs, ${coreBytes} emitted bytes)`)
