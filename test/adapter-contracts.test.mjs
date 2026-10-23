import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'

const sha = value => createHash('sha256').update(value).digest('hex')
const metadata = { language: 'en', sourceId: 'adapter-contract' }
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-adapters-'))
  const app = await createApp({ store: join(directory, 'records.sqlite'), exportDir: directory })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  return { app, directory }
}
function source(id, { version = '1', importMode, validateTranslation } = {}) {
  const parse = async file => ({ format: 'fixture', title: id,
    units: [{ order: 0, kind: 'body', sourceText: String(file.content), translatable: true }],
    chapters: [], resources: [{ id: 'image-1', mediaType: 'image/png', contentDigest: sha(String(file.content)),
      version: '1', location: 'private://may-move' }],
    sourceBinding: { adapterId: id, address: 'private://may-move' } })
  return { id, version, bindingSchemaVersion: 1, formats: ['fixture'],
    inputKinds: ['text', 'bytes'], cancellable: true, importMode,
    match: file => file.format === 'fixture' ? 1 : 0, parse, validateTranslation }
}

test('same-format source adapters need explicit selection and cannot forge another binding', async t => {
  const { app } = await fixture(t)
  app.parse.register(source('fixture-a'))
  app.parse.register(source('fixture-b'))
  const capabilities = await app.operations.invoke('capabilities')
  assert.equal(capabilities.inputFormats.filter(format => format === 'fixture').length, 1)
  assert.ok(!capabilities.inputFormats.includes('fixture-a'))
  await assert.rejects(app.records.importDocument({ format: 'fixture', content: 'A' }, metadata),
    { code: 'CONFLICT' })
  const { document } = await app.records.importDocument(
    { format: 'fixture', adapterId: 'fixture-a', content: 'A' }, metadata)
  assert.equal(document.sourceAdapterId, 'fixture-a')
  const record = app.records.record(document.id)
  assert.deepEqual(record.sourceIR.resources, [{ id: 'image-1', mediaType: 'image/png',
    contentDigest: sha('A'), version: '1' }])
  assert.deepEqual(record.resourceVersions, { 'image-1': `1:${sha('A')}` })
  assert.deepEqual(document.availableOutputs.sort(), ['json', 'md'])
  const readable = await app.exporter.exportDocument(document.id,
    { contentMode: 'source', outputs: [{ format: 'md' }, { format: 'json' }] })
  assert.match(await readFile(readable.artifacts[0].path, 'utf8'), /# fixture-a\n\nA\n/)
  assert.equal(JSON.parse(await readFile(readable.artifacts[1].path, 'utf8')).units[0].text, 'A')
  const snapshot = await app.records.createSnapshot(document.id, { contentMode: 'source' })
  await app.records.update(document.id, current => ({ ...current,
    resourceVersions: { 'image-1': `1:${sha('B')}` } }))
  assert.throws(() => app.records.resolveSnapshot(document.id, snapshot.id), { code: 'PRECONDITION_FAILED' })
  app.parse.register({ ...source('forger'), parse: async file => ({ ...(await source('forger').parse(file)),
    sourceBinding: { adapterId: 'fixture-a' } }) })
  await assert.rejects(app.parse.parse({ format: 'fixture', adapterId: 'forger', content: 'A' }),
    { code: 'INTERNAL' })
})

test('declared input kinds allow bytes and reject unsupported text before parsing', async t => {
  const { app } = await fixture(t)
  app.parse.register({ ...source('bytes-only'), inputKinds: ['bytes'] })
  await assert.rejects(app.parse.parse({ format: 'fixture', adapterId: 'bytes-only', content: 'text' }),
    { code: 'INVALID_ARGUMENT' })
  const parsed = await app.parse.parse({ format: 'fixture', adapterId: 'bytes-only', content: Buffer.from('binary') })
  assert.equal(parsed.sourceAdapterId, 'bytes-only')
})

test('Markdown-specific projection does not block JSON output', async t => {
  const { app } = await fixture(t)
  app.parse.register({ ...source('projection'), renderMarkdown: () => { throw new Error('MD unavailable') } })
  const { document } = await app.records.importDocument(
    { format: 'fixture', adapterId: 'projection', content: 'A' }, metadata)
  const json = await app.exporter.exportDocument(document.id,
    { contentMode: 'source', outputs: [{ format: 'json' }] })
  assert.equal(JSON.parse(await readFile(json.artifacts[0].path, 'utf8')).units[0].text, 'A')
  await assert.rejects(app.exporter.exportDocument(document.id,
    { contentMode: 'source', outputs: [{ format: 'md' }] }), /MD unavailable/)
})

test('readable-text projection does not block a binary source export', async t => {
  const { app } = await fixture(t)
  app.parse.register({ ...source('opaque'), readableText: () => { throw new Error('text unavailable') } })
  app.outputs.register({ id: 'opaque-bin', formats: ['opaque-bin'], supports: binding => binding.adapterId === 'opaque',
    rebuild: async () => Buffer.from([0, 255]) })
  const { document } = await app.records.importDocument(
    { format: 'fixture', adapterId: 'opaque', content: Buffer.from('A') }, metadata)
  const exported = await app.exporter.exportDocument(document.id,
    { contentMode: 'source', outputs: [{ format: 'opaque-bin' }] })
  assert.deepEqual(await readFile(exported.artifacts[0].path), Buffer.from([0, 255]))
  await assert.rejects(app.exporter.exportDocument(document.id,
    { contentMode: 'source', outputs: [{ format: 'json' }] }), /text unavailable/)
})

test('source validator pins implementation version on human edits and old-revision acceptance', async t => {
  const { app } = await fixture(t)
  const unregister = app.parse.register(source('validator', { validateTranslation: (_binding, _unit, text) => {
    if (text !== 'valid') throw new Error('private validator rejected text')
  } }))
  const { document } = await app.records.importDocument({ format: 'fixture', adapterId: 'validator', content: 'A' }, metadata)
  const unit = app.records.listUnits(document.id, { targetLang: 'zh' })[0]
  await assert.rejects(app.records.writeRevision(unit.id,
    { targetLang: 'zh', text: 'invalid', baseRevisionId: null }), /private validator rejected/)
  const revision = await app.records.writeRevision(unit.id,
    { targetLang: 'zh', text: 'valid', baseRevisionId: null })
  unregister()
  assert.equal(app.records.getDocument(document.id).id, document.id)
  await assert.rejects(app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null }),
    { code: 'COMPONENT_MISSING' })
  const removeReplacement = app.parse.register(source('validator', { version: '2' }))
  await assert.rejects(app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null }),
    { code: 'PRECONDITION_FAILED' })
  removeReplacement()
  app.parse.register(source('validator'))
  await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
})

test('reimport with a new source implementation version keeps the old document and creates new provenance', async t => {
  const { app } = await fixture(t)
  const removeV1 = app.parse.register(source('versioned'))
  const file = { format: 'fixture', adapterId: 'versioned', content: 'Same content' }
  const first = await app.tasks.importDocument(file, metadata)
  assert.equal(first.document.sourceAdapterVersion, '1')
  const originalSnapshot = await app.records.createSnapshot(first.document.id, { contentMode: 'source' })
  removeV1()
  const removeV2 = app.parse.register(source('versioned', { version: '2' }))
  const second = await app.tasks.importDocument(file, metadata)
  assert.notEqual(second.document.id, first.document.id)
  assert.equal(app.records.record(second.document.id).fingerprint,
    app.records.record(first.document.id).fingerprint)
  assert.equal(second.document.sourceAdapterVersion, '2')
  assert.equal((await app.tasks.get(second.taskId)).adapterVersion, '2')
  assert.equal(app.records.getDocument(first.document.id).sourceAdapterVersion, '1')
  assert.deepEqual(app.records.getSnapshot(first.document.id, originalSnapshot.id), originalSnapshot)
  assert.equal(app.records.resolveSnapshot(first.document.id, originalSnapshot.id).snapshot.id, originalSnapshot.id)
  assert.equal(app.records.listDocuments().length, 2)
  removeV2()
  app.parse.register(source('versioned', { version: '2', importMode: 'queued' }))
  const queued = await app.tasks.importDocument(file, metadata, { wait: false })
  const completed = await app.tasks.wait(queued.taskId)
  assert.equal(completed.state, 'succeeded')
  assert.equal(completed.preparedDocId, second.document.id)
  assert.equal(completed.adapterVersion, '2')
})

test('a pre-P03 unversioned record keeps its legacy deduplication identity', async t => {
  const { app } = await fixture(t)
  const removeOld = app.parse.register({ ...source('legacy'), version: undefined })
  const file = { format: 'fixture', adapterId: 'legacy', content: 'Same content' }
  const first = await app.records.importDocument(file, metadata)
  await app.records.update(first.document.id, current => {
    const { sourceAdapterId, sourceAdapterVersion, bindingSchemaVersion, ...document } = current.document
    return { ...current, document }
  })
  removeOld()
  app.parse.register(source('legacy', { version: '2' }))
  const again = await app.tasks.importDocument(file, metadata)
  assert.equal(again.deduplicated, true)
  assert.equal(again.document.id, first.document.id)
  assert.equal((await app.tasks.get(again.taskId)).adapterVersion, '2')
  assert.equal(app.records.listDocuments().length, 1)
})

test('binary output keeps selected adapter identity, version and bytes across task admission', async t => {
  const { app } = await fixture(t)
  const { document } = await app.records.importDocument({ format: 'txt', content: 'Input' }, metadata)
  const first = { id: 'binary-a', version: '1', formats: ['bin'], supports: binding => binding.adapterId === 'txt',
    rebuild: async () => Buffer.from([0, 255, 1]) }
  const second = { ...first, id: 'binary-b', rebuild: async () => Buffer.from([2, 254, 3]) }
  const removeFirst = app.outputs.register(first)
  app.outputs.register(second)
  await assert.rejects(app.tasks.exportDocument(document.id,
    { contentMode: 'source', outputs: [{ format: 'bin' }] }), { code: 'CONFLICT' })
  const pinned = await app.tasks.exportDocument(document.id,
    { contentMode: 'source', outputs: [{ format: 'bin', adapterId: 'binary-a' }] })
  const task = await app.tasks.wait(pinned.taskId)
  assert.equal(task.state, 'succeeded')
  assert.equal(task.outputs[0].adapterId, 'binary-a')
  assert.equal(task.outputs[0].adapterVersion, '1')
  assert.equal(task.artifacts[0].adapterId, 'binary-a')
  assert.deepEqual(await readFile(task.artifacts[0].path), Buffer.from([0, 255, 1]))
  removeFirst()
  app.outputs.register({ ...first, version: '2' })
  await assert.rejects(app.exporter.exportDocument(document.id, { contentMode: 'source',
    snapshotId: pinned.snapshotId, outputs: [{ format: 'bin', adapterId: 'binary-a', adapterVersion: '1' }] }),
  { code: 'PRECONDITION_FAILED' })
  await assert.rejects(app.exporter.exportDocument(document.id, { contentMode: 'source',
    snapshotId: pinned.snapshotId, outputs: [{ format: 'bin', adapterId: 'absent', adapterVersion: '1' }] }),
  { code: 'COMPONENT_MISSING' })
})

test('direct exporter rejects missing or changed adapters without orphaning a snapshot', async t => {
  const { app } = await fixture(t)
  const { document } = await app.records.importDocument({ format: 'txt', content: 'Input' }, metadata)
  const before = app.records.listSnapshots(document.id).length
  await assert.rejects(app.exporter.exportDocument(document.id,
    { contentMode: 'source', outputs: [{ format: 'missing' }] }), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(app.exporter.exportDocument(document.id,
    { contentMode: 'source', outputs: [{ format: 'json', adapterVersion: 'old' }] }),
  { code: 'PRECONDITION_FAILED' })
  assert.equal(app.records.listSnapshots(document.id).length, before)
})

test('direct exporter compensates a snapshot if its adapter disappears during creation', async t => {
  const { app } = await fixture(t)
  const { document } = await app.records.importDocument({ format: 'txt', content: 'Input' }, metadata)
  const original = app.records.createSnapshot.bind(app.records)
  let entered, release
  const created = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  t.after(() => { release(); app.records.createSnapshot = original })
  app.records.createSnapshot = async (...args) => {
    const snapshot = await original(...args)
    entered()
    await gate
    return snapshot
  }
  const unregister = app.outputs.register({ id: 'race-output', formats: ['race-bin'],
    supports: () => true, rebuild: async () => 'unused' })
  const exporting = app.exporter.exportDocument(document.id,
    { contentMode: 'source', outputs: [{ format: 'race-bin', adapterId: 'race-output' }] })
  await created
  unregister()
  release()
  await assert.rejects(exporting, { code: 'COMPONENT_MISSING' })
  assert.deepEqual(app.records.listSnapshots(document.id), [])
})

test('queued output cannot drift to a replacement of the same format or version', async t => {
  const { app } = await fixture(t)
  const { document } = await app.records.importDocument({ format: 'txt', content: 'Input' }, metadata)
  const { document: other } = await app.records.importDocument({ format: 'txt', content: 'Other' },
    { ...metadata, sourceId: 'other' })
  let started, release
  const entered = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { release = resolve })
  t.after(() => release())
  app.outputs.register({ id: 'blocker', formats: ['block'], supports: () => true,
    rebuild: async () => { started(); await gate; return Buffer.from([1]) } })
  const replace = app.outputs.register({ id: 'queue-a', version: '1', formats: ['queued-bin'],
    supports: () => true, rebuild: async () => Buffer.from([2]) })
  const blocker = await app.tasks.exportDocument(document.id,
    { contentMode: 'source', outputs: [{ format: 'block' }] })
  await entered
  const queued = await app.tasks.exportDocument(other.id,
    { contentMode: 'source', outputs: [{ format: 'queued-bin' }] })
  assert.equal((await app.tasks.get(queued.taskId)).outputs[0].adapterId, 'queue-a')
  replace()
  app.outputs.register({ id: 'queue-b', version: '1', formats: ['queued-bin'],
    supports: () => true, rebuild: async () => Buffer.from([3]) })
  release()
  assert.equal((await app.tasks.wait(blocker.taskId)).state, 'succeeded')
  assert.equal((await app.tasks.wait(queued.taskId)).state, 'failed')
  assert.deepEqual(app.records.listArtifacts(other.id), [])
  const missing = app.outputs.register({ id: 'queue-a', version: '2', formats: ['queued-bin'],
    supports: () => true, rebuild: async () => Buffer.from([4]) })
  await assert.rejects(app.exporter.exportDocument(other.id, { contentMode: 'source',
    snapshotId: queued.snapshotId, outputs: (await app.tasks.get(queued.taskId)).outputs }),
  { code: 'PRECONDITION_FAILED' })
  missing()
})

test('queued source pins adapter and cancel aborts adapter-owned work', async t => {
  const { app } = await fixture(t)
  const { document } = await app.records.importDocument({ format: 'txt', content: 'Input' }, metadata)
  let started, release
  const entered = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { release = resolve })
  t.after(() => release())
  app.outputs.register({ id: 'blocker', formats: ['block'], supports: () => true,
    rebuild: async () => { started(); await gate; return 'hold' } })
  const blocker = await app.tasks.exportDocument(document.id,
    { contentMode: 'source', outputs: [{ format: 'block' }] })
  await entered
  const old = source('queued-source', { importMode: 'queued' })
  const remove = app.parse.register(old)
  const queued = await app.tasks.importDocument(
    { format: 'fixture', content: 'Queued', adapterId: 'queued-source' }, metadata, { wait: false })
  assert.equal((await app.tasks.get(queued.taskId)).adapterVersion, '1')
  remove()
  app.parse.register({ ...old, version: '2' })
  release()
  await app.tasks.wait(blocker.taskId)
  assert.equal((await app.tasks.wait(queued.taskId)).state, 'failed')
  assert.equal(app.records.listDocuments().length, 1)

  let enteredImport
  const begun = new Promise(resolve => { enteredImport = resolve })
  const cancelable = { ...source('cancelable', { importMode: 'queued' }),
    async import(file, persist) {
      enteredImport()
      await new Promise((_resolve, reject) => file.signal.addEventListener('abort',
        () => reject(file.signal.reason), { once: true }))
      return persist(await this.parse(file))
    } }
  app.parse.register(cancelable)
  const active = await app.tasks.importDocument(
    { format: 'fixture', content: 'Cancel', adapterId: 'cancelable' }, metadata, { wait: false })
  await begun
  await app.tasks.cancel(active.taskId)
  assert.equal((await app.tasks.wait(active.taskId)).state, 'canceled')
  assert.equal(app.records.listDocuments().length, 1)
})
