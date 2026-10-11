import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launch } from '../src/launch.mjs'
import { runCli } from '../src/cli.mjs'

test('first launch keeps text usable without PDF and reuses the same running workbench', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ivoraige-launch-'))
  const opened = []
  const first = await launch({ dataDir, opener: url => opened.push(url) })
  t.after(async () => { await first.close(); await rm(dataDir, { recursive: true, force: true }) })
  const capabilities = await (await fetch(`${first.url}/api/capabilities`)).json()
  assert.ok(capabilities.features.includes('component-installation'))
  assert.ok(capabilities.inputFormats.includes('txt'))
  assert.ok(!capabilities.inputFormats.includes('pdf'))
  assert.ok(capabilities.settingsPages.some(page => page.id === 'pdf'))
  const second = await launch({ dataDir, opener: url => opened.push(url) })
  assert.equal(second.reused, true)
  assert.equal(second.url, first.url)
  assert.deepEqual(opened, [first.url, first.url])
  await second.close()
  assert.equal((await fetch(`${first.url}/api/capabilities`)).status, 200)
  const status = await (await fetch(`${first.url}/api/components`)).json()
  assert.equal(status.credentialConfigured, false)
  assert.equal(status.installed, null)
})

test('program restart preserves accepted text and frozen output in the user directory', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ivoraige-launch-restart-'))
  let running
  try {
    running = await launch({ dataDir, open: false })
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
