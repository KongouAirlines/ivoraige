import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hostConfigBinding } from '../src/host-bootstrap.mjs'
import { createApp } from '../src/app.mjs'

test('new settings and component paths bind to a canonical parent before creation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-binding-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const actual = join(root, 'actual'), alias = join(root, 'alias')
  await mkdir(actual)
  const canonicalActual = await realpath(actual)
  try { await symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Directory symlinks are blocked'); return }
    throw error
  }
  const settingsDir = join(alias, 'new', 'settings')
  const componentDir = join(alias, 'new', 'components')
  const options = { store: join(actual, 'store.sqlite'), registryRoot: join(root, 'registry'),
    settingsDir, components: { directory: componentDir } }
  const before = await hostConfigBinding(options)
  assert.equal(before.settingsDir, join(canonicalActual, 'new', 'settings'))
  assert.equal(before.componentDir, join(canonicalActual, 'new', 'components'))
  await mkdir(settingsDir, { recursive: true })
  await mkdir(componentDir, { recursive: true })
  const after = await hostConfigBinding(options)
  assert.deepEqual(after, before)
  let app = await createApp(options)
  const domain = app.dataDomainRef
  await app.dispose()
  app = await createApp(options)
  try { assert.equal(app.dataDomainRef, domain) }
  finally { await app.dispose() }
})
