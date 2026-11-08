import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gte } from 'semver'
import packageInfo from '../package.json' with { type: 'json' }
import lockInfo from '../package-lock.json' with { type: 'json' }

const minimumVersions = new Map([
  ['zod', '4.6.7'],
  ['fast-uri', '3.1.9'],
])

test('lockfile and installed packages retain the dependency security baseline', async () => {
  for (const [name, minimum] of minimumVersions) {
    const suffix = `node_modules/${name}`
    const entries = Object.entries(lockInfo.packages).filter(([path]) => path === suffix || path.endsWith(`/${suffix}`))
    assert.ok(entries.length, `Missing locked dependency: ${name}`)
    for (const [path, locked] of entries) {
      assert.ok(gte(locked.version, minimum), `${path}@${locked.version} is below ${minimum}`)
      const installed = JSON.parse(await readFile(new URL(`../${path}/package.json`, import.meta.url), 'utf8'))
      assert.equal(installed.version, locked.version, `Installed/locked version mismatch: ${path}`)
    }
  }
  const server = packageInfo.dependencies['@modelcontextprotocol/server']
  assert.equal(packageInfo.devDependencies['@modelcontextprotocol/client'], server)
  for (const name of ['server', 'client', 'core']) {
    assert.equal(lockInfo.packages[`node_modules/@modelcontextprotocol/${name}`].version, server)
  }
})

test('the DSH bundle actually consumes the patched schema and URI dependencies', async () => {
  const evidence = JSON.parse(await readFile(new URL('../dist/build-evidence.json', import.meta.url), 'utf8'))
  assert.equal(evidence.target, 'node26', 'The default DSH build targets Node 26')
  const notices = await readFile(new URL('../dist/THIRD_PARTY_LICENSES.txt', import.meta.url), 'utf8')
  const roots = new Set(evidence.inputs.map(input => input.replaceAll('\\', '/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/|$)/)?.[1]).filter(Boolean))
  const seen = new Set()
  for (const root of roots) {
    const pkg = JSON.parse(await readFile(new URL(`../${root}/package.json`, import.meta.url), 'utf8'))
    const minimum = minimumVersions.get(pkg.name)
    if (!minimum) continue
    seen.add(pkg.name)
    assert.ok(gte(pkg.version, minimum), `Bundled ${pkg.name}@${pkg.version} is below ${minimum}`)
    assert.ok(notices.includes(`${pkg.name} ${pkg.version} (`), `Missing matching notice for ${pkg.name}`)
  }
  assert.deepEqual([...seen].sort(), [...minimumVersions.keys()].sort())
})
