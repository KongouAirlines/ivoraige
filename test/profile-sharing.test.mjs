import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { createApp } from '../src/app.mjs'
import { managePlugins, parsePluginOptions, resolvePnpm } from '../src/plugin-install.mjs'
import { acquireProfile } from '../src/plugin-profile.mjs'

test('different stores share prepared settings; package writer remains excluded', async t => {
  const root = await mkdtemp(join(tmpdir(), 'profile-sharing-'))
  const settingsDir = join(root, 'settings')
  const apps = []
  t.after(async () => { for (const app of apps) await app.dispose(); await rm(root, { recursive: true, force: true }) })
  apps.push(await createApp({ store: join(root, 'a.sqlite'), settingsDir }))
  apps.push(await createApp({ store: join(root, 'b.sqlite'), settingsDir }))
  await assert.rejects(acquireProfile(settingsDir), error => error.code === 'CONFLICT' && /Settings profile/.test(error.message))
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import { acquireProfile } from ${JSON.stringify(new URL('../src/plugin-profile.mjs', import.meta.url).href)}; try { const lease = await acquireProfile(${JSON.stringify(settingsDir)}); lease.release(); process.exitCode = 2 } catch (error) { console.log(error.code) }`], { encoding: 'utf8', timeout: 5000 })
  assert.equal(child.status, 0)
  assert.match(child.stdout, /CONFLICT/)
  assert.match((await managePlugins({ directory: settingsDir, action: 'list' })).observation, /read-only/)
  await apps.pop().dispose()
  await assert.rejects(acquireProfile(settingsDir), { code: 'CONFLICT' })
  await apps.pop().dispose()
  const lease = await acquireProfile(settingsDir)
  lease.release()
})

test('list never creates a missing profile, and CLI cannot override operation fields', async t => {
  const root = await mkdtemp(join(tmpdir(), 'profile-list-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'absent')
  assert.deepEqual((await managePlugins({ directory, action: 'list' })).plugins, [])
  await assert.rejects(access(directory), { code: 'ENOENT' })
  for (const key of ['action', 'directory', 'name', 'packageDirectory', 'pnpmCommand', 'signal'])
    assert.throws(() => parsePluginOptions(JSON.stringify({ [key]: 'x' })), { code: 'INVALID_ARGUMENT' })
  assert.deepEqual(parsePluginOptions('{"storePath":"x","config":{}}'), { storePath: 'x', config: {} })
  await assert.rejects(resolvePnpm(join(root, 'missing-pnpm')), { code: 'COMPONENT_MISSING' })
})

// Explicitly remove global executable discovery: the locked package supplies pnpm.
test('pnpm development dependency works without a global executable', async () => {
  const oldPath = process.env.PATH
  try {
    process.env.PATH = ''
    const resolved = await resolvePnpm()
    assert.equal(resolved.command, process.execPath)
    assert.match(resolved.prefix[0], /pnpm[/\\]bin[/\\]pnpm\.cjs$/)
    const { execFileSync } = await import('node:child_process')
    assert.equal(execFileSync(resolved.command, [...resolved.prefix, '--version'], { encoding: 'utf8' }).trim(), '11.25.0')
  } finally { process.env.PATH = oldPath }
})
