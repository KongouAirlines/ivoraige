import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'
import { parameters } from '../src/protocol.mjs'
import { runCli } from '../src/cli.mjs'

test('source export needs no target language and never reads accepted translation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-source-'))
  const store = join(directory, 'records.sqlite')
  let app = await createApp({ store, exportDir: join(directory, 'out') })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const original = '# Heading\n\nOriginal body.\n'
  const { document } = await app.records.importDocument({ format: 'md', content: original },
    { sourceId: 'source:1', language: 'en' })
  const [heading, body] = app.records.listUnits(document.id, { targetLang: 'zh' })
  const revision = await app.records.writeRevision(body.id,
    { targetLang: 'zh', text: 'Translated body.', baseRevisionId: null })
  await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  const result = await app.tasks.exportDocument(document.id,
    { contentMode: 'source', outputs: [{ format: 'md' }, { format: 'json' }] })
  const completed = await app.tasks.wait(result.taskId)
  assert.equal(completed.state, 'succeeded')
  const markdown = await readFile(completed.artifacts[0].path, 'utf8')
  const json = JSON.parse(await readFile(completed.artifacts[1].path, 'utf8'))
  assert.equal(markdown, original)
  assert.equal(json.contentMode, 'source')
  assert.equal(json.document.targetLang, undefined)
  assert.deepEqual(json.units.map(unit => unit.decision.type), ['source', 'source'])
  assert.equal(json.units[1].text, 'Original body.')
  assert.equal(json.units[1].text.includes('Translated'), false)
  assert.equal(app.records.getSnapshot(document.id, result.snapshotId).targetLang, undefined)
  assert.equal(app.records.record(document.id).revisions.length, 1)
  assert.equal(completed.stats.llmCalls, 0)
  assert.equal(app.ctx.get('llm'), undefined)
  assert.equal(app.ctx.get('ivoraige.translationModel'), undefined)
  assert.equal(heading.translatable, true)
  await app.dispose()
  app = await createApp({ store, exportDir: join(directory, 'out') })
  const replay = await app.tasks.exportDocument(document.id,
    { contentMode: 'source', snapshotId: result.snapshotId, outputs: [{ format: 'json' }] })
  const replayed = await app.tasks.wait(replay.taskId)
  assert.equal(replayed.state, 'succeeded')
  assert.equal(JSON.parse(await readFile(replayed.artifacts[0].path, 'utf8')).units[1].text, 'Original body.')
})

test('accepted export requires targetLang at the entry boundary', () => {
  assert.equal(parameters.exportDocument.safeParse({ docId: 'doc', outputs: [{ format: 'json' }] }).success, false)
  assert.equal(parameters.exportDocument.safeParse({ docId: 'doc', contentMode: 'source',
    targetLang: 'zh', outputs: [{ format: 'json' }] }).success, false)
})

test('CLI accepts source content mode without a target language', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-source-cli-'))
  const store = join(directory, 'records.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const app = await createApp({ store })
  const { document } = await app.records.importDocument({ format: 'txt', content: 'Original source.' },
    { sourceId: 'cli:source', language: 'en' })
  await app.dispose()
  let out = '', err = ''
  const code = await runCli(['--store', store, 'export', document.id, '--format', 'json',
    '--content-mode', 'source'],
  { stdout: { write(chunk) { out += chunk } }, stderr: { write(chunk) { err += chunk } } })
  assert.equal(code, 0, err)
  assert.ok(JSON.parse(out).snapshotId)
})

test('version-one record remains readable and restores from a consistent backup', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-source-legacy-'))
  const store = join(directory, 'records.sqlite')
  const backup = join(directory, 'records.backup.sqlite')
  let app = await createApp({ store })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const { document } = await app.records.importDocument({ format: 'txt', content: 'Legacy source.' },
    { sourceId: 'legacy:1', language: 'en' })
  const [unit] = app.records.listUnits(document.id, { targetLang: 'zh' })
  const revision = await app.records.writeRevision(unit.id,
    { targetLang: 'zh', text: 'Legacy translation.', baseRevisionId: null })
  await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  const snapshot = await app.records.createSnapshot(document.id, { targetLang: 'zh' })
  await app.records.table.update(document.id, record => {
    const { schemaVersion, sourceIR, ...legacy } = record
    return { ...legacy, snapshots: legacy.snapshots.map(({ contentMode, ...item }) => item) }
  })
  await app.dispose()
  await copyFile(store, backup)
  app = await createApp({ store })
  const legacy = app.records.record(document.id)
  assert.equal(legacy.schemaVersion, undefined)
  assert.equal(legacy.snapshots[0].contentMode, undefined)
  assert.equal(app.records.resolveSnapshot(document.id, snapshot.id).units[0].text, 'Legacy translation.')
  assert.equal(app.records.record(document.id).schemaVersion, undefined)
  await assert.rejects(app.records.createSnapshot(document.id, { contentMode: 'source', targetLang: 'zh' }),
    { code: 'INVALID_ARGUMENT' })
  assert.equal(app.records.record(document.id).snapshots.length, 1)
  await app.records.createSnapshot(document.id, { contentMode: 'source' })
  assert.equal(app.records.record(document.id).schemaVersion, 2)
  assert.equal(app.records.record(document.id).sourceIR.legacy, true)
  const upgradedIdentity = app.records.record(document.id).sourceIR.identity
  const fresh = await app.records.importDocument({ format: 'txt', content: 'Legacy source.' },
    { sourceId: 'legacy:fresh', language: 'en' })
  assert.equal(upgradedIdentity, app.records.record(fresh.document.id).sourceIR.identity)
  assert.equal(app.records.record(document.id).fingerprint, legacy.fingerprint)
  for (const schemaVersion of [3, 0, -1]) {
    await app.records.table.update(document.id, record => ({ ...record, schemaVersion }))
    await assert.rejects(app.records.createSnapshot(document.id, { contentMode: 'source' }),
      { code: 'PRECONDITION_FAILED' })
  }
  await app.records.table.update(document.id, record => ({ ...record, schemaVersion: 2,
    sourceIR: { ...record.sourceIR, version: 2 } }))
  await assert.rejects(app.records.createSnapshot(document.id, { contentMode: 'source' }),
    { code: 'PRECONDITION_FAILED' })
  assert.equal(app.records.listSnapshots(document.id).length, 2)
  await app.dispose()
  await copyFile(backup, store)
  app = await createApp({ store })
  assert.equal(app.records.listSnapshots(document.id).length, 1)
  assert.equal(app.records.resolveSnapshot(document.id, snapshot.id).units[0].text, 'Legacy translation.')
})

test('legacy PDF upgrade keeps an approximate identity when source inventory is unknown', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-source-pdf-legacy-'))
  const app = await createApp({ store: join(directory, 'records.sqlite') })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const { document } = await app.records.importDocument({ format: 'txt', content: 'Extracted PDF unit.' },
    { sourceId: 'legacy:pdf', language: 'en' })
  await app.records.table.update(document.id, record => {
    const { schemaVersion, sourceIR, ...legacy } = record
    return { ...legacy, document: { ...legacy.document, format: 'pdf' } }
  })
  await app.records.createSnapshot(document.id, { contentMode: 'source' })
  const upgraded = app.records.record(document.id)
  assert.equal(upgraded.sourceIR.identityScope, 'approximate-legacy')
  assert.equal(upgraded.sourceIR.chapters, undefined)
  assert.equal(upgraded.sourceIR.resources, undefined)
})

test('legacy text format with an unknown adapter keeps approximate identity', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-source-custom-legacy-'))
  const app = await createApp({ store: join(directory, 'records.sqlite') })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const { document } = await app.records.importDocument({ format: 'txt', content: 'Custom text.' },
    { sourceId: 'legacy:custom', language: 'en' })
  await app.records.table.update(document.id, record => {
    const { schemaVersion, sourceIR, ...legacy } = record
    return { ...legacy, sourceBinding: { adapterId: 'custom-txt' } }
  })
  const before = app.records.record(document.id)
  await app.records.createSnapshot(document.id, { contentMode: 'source' })
  const upgraded = app.records.record(document.id)
  assert.equal(upgraded.sourceIR.identityScope, 'approximate-legacy')
  assert.equal(upgraded.sourceIR.chapters, undefined)
  assert.equal(upgraded.sourceIR.resources, undefined)
  assert.equal(upgraded.fingerprint, before.fingerprint)
})

test('known legacy Markdown binding reconstructs the native source identity', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-source-md-legacy-'))
  const app = await createApp({ store: join(directory, 'records.sqlite') })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const file = { format: 'md', content: '# Title\n\nBody.\n' }
  const { document } = await app.records.importDocument(file,
    { sourceId: 'legacy:markdown', language: 'en' })
  const nativeIdentity = app.records.record(document.id).sourceIR.identity
  await app.records.table.update(document.id, record => {
    const { schemaVersion, sourceIR, ...legacy } = record
    return legacy
  })
  await app.records.createSnapshot(document.id, { contentMode: 'source' })
  assert.equal(app.records.record(document.id).sourceIR.identityScope, 'reconstructed-text')
  assert.equal(app.records.record(document.id).sourceIR.identity, nativeIdentity)
})
