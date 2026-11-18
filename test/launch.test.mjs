import './fixtures/host-test-env.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { launch } from '../src/launch.mjs'
import { runCli } from '../src/cli.mjs'
import { createCleanup } from './fixtures/cleanup.mjs'

async function launchInTest(t, options) {
  try { return await launch(options) }
  catch (error) {
    if (!process.env.CI && ['EPERM', 'EACCES'].includes(error.code) && error.syscall === 'listen') {
      t.skip('Local sandbox does not permit owner socket listening')
      return null
    }
    throw error
  }
}

test('a second launch reuses the resident owner and rejects a different composition', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ivoraige-launch-race-'))
  const first = await launchInTest(t, { dataDir, open: false })
  if (!first) { await rm(dataDir, { recursive: true, force: true }); return }
  t.after(async () => { await first.close(); await rm(dataDir, { recursive: true, force: true }) })
  const second = await launch({ dataDir, open: false })
  assert.equal(second.reused, true)
  assert.equal(second.url, first.url)
  await second.close()
  await assert.rejects(launch({ dataDir, open: false, components: { repository: 'different/repository' } }), error => {
    assert.equal(error.code, 'CONFLICT')
    assert.equal(error.details?.reason, 'owner-config-mismatch')
    return true
  })
})

test('stopped owner accepts a repository override without rebinding its data domain', async t => {
  const defer = createCleanup(t)
  const dataDir = await mkdtemp(join(tmpdir(), 'ivoraige-repository-'))
  defer(() => rm(dataDir, { recursive: true, force: true }))
  const previous = process.env.IVORAIGE_COMPONENTS_REPOSITORY
  defer(() => {
    if (previous === undefined) delete process.env.IVORAIGE_COMPONENTS_REPOSITORY
    else process.env.IVORAIGE_COMPONENTS_REPOSITORY = previous
  })
  process.env.IVORAIGE_COMPONENTS_REPOSITORY = 'example/components'
  const first = await launchInTest(t, { dataDir, open: false })
  if (!first) return
  defer(() => first.close())
  assert.equal((await first.app.operations.invoke('componentStatus')).repository, 'example/components')
  const domain = first.dataDomainRef
  await first.close()
  // Capture every successful launch before any assertions: an obsolete
  // assert.rejects here leaked a resident owner and hung all three CI jobs.
  const next = await launch({ dataDir, open: false, components: { repository: 'explicit/components' } })
  defer(() => next.close())
  assert.equal(next.reused, false)
  assert.equal(next.dataDomainRef, domain)
  assert.notEqual(next.generation, first.generation)
  assert.equal((await next.app.operations.invoke('componentStatus')).repository, 'explicit/components')
})

test('first launch keeps text usable without PDF and reuses the same running workbench', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ivoraige-launch-'))
  const opened = []
  const first = await launchInTest(t, { dataDir, opener: url => opened.push(url) })
  if (!first) { await rm(dataDir, { recursive: true, force: true }); return }
  t.after(async () => { await first.close(); await rm(dataDir, { recursive: true, force: true }) })
  const capabilities = await first.app.operations.invoke('capabilities')
  assert.ok(capabilities.features.includes('component-installation'))
  assert.ok(capabilities.inputFormats.includes('txt'))
  assert.ok(!capabilities.inputFormats.includes('pdf'))
  assert.ok(capabilities.settingsPages.some(page => page.id === 'pdf'))
  const second = await launch({ dataDir, opener: url => opened.push(url) })
  assert.equal(second.reused, true)
  assert.equal(second.url, first.url)
  assert.equal(opened.length, 2)
  assert.ok(opened.every(url => url.startsWith('file://') && !url.includes('owner=') && !url.includes(first.url)))
  assert.notEqual(opened[0], opened[1])
  for (const page of opened) {
    const file = fileURLToPath(page)
    const html = await readFile(file, 'utf8')
    assert.match(html, /location\.replace\("http:\/\/127\.0\.0\.1:[0-9]+\/#owner=/)
    if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600)
  }
  await second.close()
  await assert.rejects(readFile(fileURLToPath(opened[1])))
  assert.equal((await fetch(`${first.url}/api/capabilities`)).status, 401)
  const status = await first.app.operations.invoke('componentStatus')
  assert.equal(status.credentialConfigured, false)
  assert.equal(status.installed, null)
})

test('program restart preserves accepted text and frozen output in the user directory', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ivoraige-launch-restart-'))
  let running
  try {
    running = await launchInTest(t, { dataDir, open: false })
    if (!running) return
    const { document } = await running.app.records.importDocument({ format: 'txt', content: 'Original text.' },
      { language: 'en', sourceId: 'installation-test' })
    const [unit] = running.app.records.listUnits(document.id, { targetLang: 'zh' })
    const revision = await running.app.records.writeRevision(unit.id, { targetLang: 'zh', text: '人工译文。', baseRevisionId: null })
    await running.app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
    const result = await running.app.exporter.exportDocument(document.id, { targetLang: 'zh', outputs: [{ format: 'md' }] })
    const original = await readFile(result.artifacts[0].path, 'utf8')
    await running.close()
    running = await launch({ dataDir, open: false })
    const repeated = await running.app.exporter.exportDocument(document.id, {
      targetLang: 'zh', snapshotId: result.snapshotId, outputs: [{ format: 'md' }] })
    assert.equal(await readFile(repeated.artifacts[0].path, 'utf8'), original)
    assert.match(original, /人工译文/)
    await running.close()
    const previous = process.env.IVORAIGE_DATA_DIR
    const previousStore = process.env.IVORAIGE_STORE
    try {
      process.env.IVORAIGE_DATA_DIR = dataDir
      delete process.env.IVORAIGE_STORE
      let output = ''
      assert.equal(await runCli(['documents', '--json'], {
        stdout: { write: text => { output += text } }, stderr: { write: text => { throw new Error(text) } },
      }), 0)
      assert.match(output, new RegExp(document.id))
    } finally {
      if (previous === undefined) delete process.env.IVORAIGE_DATA_DIR
      else process.env.IVORAIGE_DATA_DIR = previous
      if (previousStore === undefined) delete process.env.IVORAIGE_STORE
      else process.env.IVORAIGE_STORE = previousStore
    }
  } finally { await running?.close(); await rm(dataDir, { recursive: true, force: true }) }
})

test('browser opener failure leaves the owner usable and removes the pairing page', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ivoraige-launch-opener-'))
  let page, warning = ''
  const running = await launchInTest(t, { dataDir,
    opener: url => { page = url; throw new Error('no desktop opener') },
    stderr: { write: text => { warning += text } } })
  if (!running) { await rm(dataDir, { recursive: true, force: true }); return }
  t.after(async () => { await running.close(); await rm(dataDir, { recursive: true, force: true }) })
  assert.equal(running.reused, false)
  assert.match(warning, /owner remains available/)
  await assert.rejects(readFile(fileURLToPath(page)), { code: 'ENOENT' })
  assert.ok(await running.app.cli.invoke('capabilities', {}))
  const second = await launch({ dataDir, open: false })
  assert.equal(second.reused, true)
  await second.close()
})
