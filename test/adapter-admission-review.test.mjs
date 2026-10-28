import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-admission-'))
  const app = await createApp({ store: join(directory, 'records.sqlite'), exportDir: join(directory, 'out') })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  return app
}
const output = (extra = {}) => ({ id: 'pin-test', version: '1', formats: ['pin-test'], requiredViews: [],
  supports: binding => binding.adapterId === 'txt', rebuild: () => 'frozen output', ...extra })
async function document(app) {
  const { document } = await app.records.importDocument({ format: 'txt', content: 'source' }, { language: 'en' })
  const unit = app.records.listUnits(document.id, { targetLang: 'zh' })[0]
  const revision = await app.records.writeRevision(unit.id, { targetLang: 'zh', text: 'translation', baseRevisionId: null })
  await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  return document.id
}

test('explicit output version is a constraint at registry, task and direct export admission', async t => {
  const app = await fixture(t), docId = await document(app)
  app.outputs.register(output())
  const options = { contentMode: 'source', outputs: [{ format: 'pin-test', adapterVersion: 'wrong' }] }
  await assert.rejects(app.tasks.exportDocument(docId, options), { code: 'PRECONDITION_FAILED' })
  assert.throws(() => app.outputs.get('pin-test', { adapterVersion: 'wrong' }), { code: 'PRECONDITION_FAILED' })
  await assert.rejects(app.exporter.exportDocument(docId, options), { code: 'PRECONDITION_FAILED' })
  assert.deepEqual(app.records.listSnapshots(docId), [])
  assert.deepEqual(app.records.listTasks(), [])
  for (const adapterVersion of ['', ' ', null, 1])
    await assert.rejects(app.tasks.exportDocument(docId, { ...options, outputs: [{ format: 'pin-test', adapterVersion }] }),
      { code: 'INVALID_ARGUMENT' })
  const submitted = await app.tasks.exportDocument(docId,
    { ...options, outputs: [{ format: 'pin-test', adapterVersion: '1' }] })
  const done = await app.tasks.wait(submitted.taskId)
  assert.equal(done.state, 'succeeded')
  assert.equal(done.outputs[0].adapterVersion, '1')
  assert.equal(done.artifacts[0].adapterVersion, '1')
  app.outputs.register(output({ id: 'unversioned', formats: ['unversioned'], version: undefined }))
  assert.equal(app.outputs.get('unversioned', { adapterVersion: 'unversioned' }).id, 'unversioned')
})

for (const state of ['paused', 'failed']) {
  test(`resume checks pending persisted output pins before changing a ${state} task`, async t => {
    for (const contentMode of ['source', 'accepted-translation']) {
      for (const change of ['missing', 'version', 'disabled', 'binding', 'mode']) {
        await t.test(`${contentMode}/${change}`, async t => {
          const app = await fixture(t), docId = await document(app)
          const remove = app.outputs.register(output())
          const schedule = t.mock.method(app.tasks, 'schedule', () => {})
          const submitted = await app.tasks.exportDocument(docId,
            { contentMode, ...(contentMode === 'source' ? {} : { targetLang: 'zh' }), outputs: [{ format: 'pin-test' }] })
          await app.tasks.pause(submitted.taskId)
          if (state === 'failed') await app.records.updateTask(submitted.taskId,
            task => ({ ...task, state, error: { stage: 'export', message: 'fixture failure' } }))
          const before = app.records.getTask(submitted.taskId)
          const queueBefore = [...app.tasks.queue]
          const schedulesBefore = schedule.mock.callCount()
          const snapshot = app.records.getSnapshot(docId, submitted.snapshotId)
          remove()
          let removeReplacement
          if (change !== 'missing') removeReplacement = app.outputs.register(output({
            ...(change === 'version' ? { version: '2' } : {}),
            ...(change === 'disabled' ? { status: () => ({ state: 'disabled' }) } : {}),
            ...(change === 'binding' ? { supports: binding => binding.adapterId === 'other' } : {}),
            ...(change === 'mode' ? { supports: (_binding, mode) => mode !== contentMode } : {}),
          }))
          await assert.rejects(app.tasks.resume(submitted.taskId),
            { code: change === 'missing' ? 'COMPONENT_MISSING' : 'PRECONDITION_FAILED' })
          assert.deepEqual(app.records.getTask(submitted.taskId), before)
          assert.deepEqual(app.records.getSnapshot(docId, submitted.snapshotId), snapshot)
          assert.deepEqual([...app.tasks.queue], queueBefore)
          assert.equal(schedule.mock.callCount(), schedulesBefore)
          assert.deepEqual(app.records.listArtifacts(docId), [])
          removeReplacement?.()
          app.outputs.register(output())
          schedule.mock.restore()
          await app.tasks.resume(submitted.taskId)
          const done = await app.tasks.wait(submitted.taskId)
          assert.equal(done.state, 'succeeded')
          assert.equal(done.snapshotId, submitted.snapshotId)
          assert.equal(done.outputs[0].adapterVersion, '1')
          assert.equal(done.artifacts[0].adapterVersion, '1')
        })
      }
    }
  })
}

for (const blocked of ['unavailable', 'disabled', 'failed']) {
  test(`${blocked} sources cannot be auto-selected, explicitly selected or executed from a queued selection`, async t => {
    const app = await fixture(t)
    let state = blocked, matches = 0, parses = 0
    app.parse.register({ id: 'state-test', version: '1', formats: ['state-test'], importMode: 'queued',
      status: () => ({ state }), match: () => { matches++; return 1 },
      parse: file => { parses++; return { format: 'state-test', title: 'source',
        sourceBinding: { adapterId: 'state-test' },
        units: [{ order: 0, kind: 'body', sourceText: String(file.content), translatable: true }] } },
    })
    for (const explicit of [false, true]) {
      await assert.rejects(app.operations.invoke('importDocument', { format: 'state-test',
        ...(explicit ? { adapterId: 'state-test' } : {}), contentBase64: Buffer.from('source').toString('base64'), language: 'en' }),
      { code: 'COMPONENT_MISSING' })
    }
    assert.equal(app.parse.listAdapters().includes('state-test'), false)
    assert.equal(app.parse.listFormats().includes('state-test'), false)
    assert.equal(matches, 0)
    assert.equal(parses, 0)
    assert.deepEqual(app.records.listDocuments(), [])
    assert.deepEqual(app.records.listTasks(), [])
    state = 'ready'
    const selection = app.parse.selectPrepared(app.parse.prepareInput({ format: 'state-test', content: 'source' }))
    state = blocked
    assert.throws(() => app.parse.assertSelection(selection), { code: 'COMPONENT_MISSING' })
    state = 'ready'
    const schedule = t.mock.method(app.tasks, 'schedule', () => {})
    const submitted = await app.operations.invoke('importDocument', { format: 'state-test',
      contentBase64: Buffer.from('source').toString('base64'), language: 'en' })
    state = blocked
    schedule.mock.restore()
    app.tasks.schedule()
    const done = await app.tasks.wait(submitted.taskId)
    assert.equal(done.state, 'failed')
    assert.equal(parses, 0)
    assert.deepEqual(app.records.listDocuments(), [])
  })
}
