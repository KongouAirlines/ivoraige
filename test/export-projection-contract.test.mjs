import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'
import { serve } from '../src/http.mjs'

const source = (extra = {}) => ({
  id: 'projection-source', version: '1', bindingSchemaVersion: 1, formats: ['projection-source'],
  readableText: (_binding, _unit, text) => text,
  match: file => file.format === 'projection-source' ? 1 : 0,
  parse: file => ({ format: 'projection-source', title: 'Projection fixture',
    units: [{ order: 0, kind: 'body', sourceText: file.content, translatable: true }],
    sourceBinding: { adapterId: 'projection-source' } }), ...extra,
})

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-projection-'))
  const config = { store: join(dir, 'records.sqlite') }
  let app = await createApp(config)
  t.after(async () => { await app.dispose(); await rm(dir, { recursive: true, force: true }) })
  const remove = app.parse.register(source())
  const { document } = await app.records.importDocument({ format: 'projection-source', content: 'Source v1' }, { language: 'en' })
  const unit = app.records.listUnits(document.id, { targetLang: 'zh' })[0]
  const first = await app.records.writeRevision(unit.id, { targetLang: 'zh', text: 'Accepted v1', baseRevisionId: null })
  await app.records.acceptRevision(first.id, { expectedAcceptedRevisionId: null })
  const snapshots = {
    source: await app.records.createSnapshot(document.id, { contentMode: 'source' }),
    'accepted-translation': await app.records.createSnapshot(document.id, { targetLang: 'zh' }),
  }
  const second = await app.records.writeRevision(unit.id, { targetLang: 'zh', text: 'Accepted v2', baseRevisionId: first.id })
  await app.records.acceptRevision(second.id, { expectedAcceptedRevisionId: first.id })
  return { get app() { return app }, document, snapshots, remove,
    async restart() { await app.dispose(); app = await createApp(config) } }
}

for (const scenario of ['missing-after-restart', 'withdrawn', 'version', 'binding-schema', 'projection']) {
  test(`bound export preflight rejects ${scenario} without writes while view-free output remains usable`, async t => {
    const f = await fixture(t)
    let removeReplacement
    if (scenario === 'missing-after-restart') await f.restart()
    else {
      f.remove()
      if (scenario === 'version') removeReplacement = f.app.parse.register(source({ version: '2' }))
      if (scenario === 'binding-schema') removeReplacement = f.app.parse.register(source({ bindingSchemaVersion: 2 }))
      if (scenario === 'projection') removeReplacement = f.app.parse.register(source({ readableText: undefined }))
    }
    const app = f.app, docId = f.document.id
    let rebuilds = 0, snapshotsCreated = 0
    app.outputs.register({ id: 'binary', requiredViews: [], supports: binding => binding.adapterId === 'projection-source',
      rebuild: frozen => { rebuilds++; return Buffer.from(frozen.units[0].text) } })
    const createSnapshot = app.records.createSnapshot.bind(app.records)
    t.mock.method(app.records, 'createSnapshot', (...args) => { snapshotsCreated++; return createSnapshot(...args) })
    const server = await serve(app, { port: 0 })
    const http = async (id, input) => {
      const response = await fetch(server.url + '/api/operations/' + id, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      })
      const body = await response.json()
      if (!response.ok) throw Object.assign(new Error(body.error.message), { code: body.error.code, status: response.status })
      return body
    }
    const entries = {
      operations: options => app.operations.invoke('exportDocument', { docId, ...options }),
      tasks: options => app.tasks.exportDocument(docId, options),
      exporter: options => app.exporter.exportDocument(docId, options),
      http: options => http('exportDocument', { docId, ...options }),
      mcp: options => app.mcp.tools.get('ivoraige_export').invoke({ docId, ...options }, {}),
    }
    const bound = { binding: app.records.record(docId).sourceBinding, provenance: f.document }
    // Other installed sources are compatible: global availability must not be
    // confused with this persisted document's pinned source implementation.
    assert.ok(app.outputs.listFormats().includes('json'))
    assert.deepEqual(app.outputs.listFormats(bound), ['binary'])
    assert.deepEqual(app.outputs.listAdapters(bound), ['binary'])
    assert.deepEqual(app.records.getDocument(docId).availableOutputs, ['binary'])
    assert.deepEqual((await http('getDocument', { docId })).document.availableOutputs, ['binary'])
    const state = app.events.subscribe().snapshot().state
    assert.deepEqual(state.documents.find(d => d.id === docId).availableOutputs, ['binary'])
    const expected = ['version', 'binding-schema', 'projection'].includes(scenario) ? 'PRECONDITION_FAILED' : 'COMPONENT_MISSING'
    for (const [entry, invoke] of Object.entries(entries)) {
      for (const contentMode of ['source', 'accepted-translation']) {
        for (const historical of [false, true]) {
          const mode = { contentMode, ...(contentMode === 'source' ? {} : { targetLang: 'zh' }),
            ...(historical ? { snapshotId: f.snapshots[contentMode].id } : {}) }
          for (const formats of [['md'], ['json'], ['binary', 'json']]) {
            await assert.rejects(invoke({ ...mode, outputs: formats.map(format => ({ format })) }),
              error => error.code === expected, `${entry}/${contentMode}/${historical}/${formats}`)
          }
        }
      }
    }
    assert.equal(snapshotsCreated, 0)
    assert.equal(rebuilds, 0)
    assert.equal(app.records.listSnapshots(docId).length, 2)
    assert.deepEqual(app.records.listTasks(), [])
    assert.deepEqual(app.records.listArtifacts(docId), [])
    for (const contentMode of ['source', 'accepted-translation']) {
      const mode = { contentMode, ...(contentMode === 'source' ? {} : { targetLang: 'zh' }) }
      const submitted = await entries.operations({ ...mode, outputs: [{ format: 'binary' }] })
      const task = await app.tasks.wait(submitted.taskId)
      assert.equal(task.state, 'succeeded')
      assert.equal(await readFile(task.artifacts[0].path, 'utf8'), contentMode === 'source' ? 'Source v1' : 'Accepted v2')
      const replay = await entries.exporter({ ...mode, snapshotId: f.snapshots[contentMode].id, outputs: [{ format: 'binary' }] })
      assert.equal(await readFile(replay.artifacts[0].path, 'utf8'), contentMode === 'source' ? 'Source v1' : 'Accepted v1')
    }
    removeReplacement?.()
    app.parse.register(source())
    assert.deepEqual(app.records.getDocument(docId).availableOutputs.sort(), ['binary', 'json', 'md'])
    for (const [entry, invoke] of Object.entries(entries)) {
      for (const contentMode of ['source', 'accepted-translation']) {
        const submitted = await invoke({ contentMode, ...(contentMode === 'source' ? {} : { targetLang: 'zh' }),
          snapshotId: f.snapshots[contentMode].id, outputs: [{ format: 'md' }, { format: 'json' }, { format: 'binary' }] })
        const done = submitted.taskId ? await app.tasks.wait(submitted.taskId) : submitted
        if (submitted.taskId) assert.equal(done.state, 'succeeded', entry)
        assert.equal(JSON.parse(await readFile(done.artifacts[1].path, 'utf8')).units[0].text,
          contentMode === 'source' ? 'Source v1' : 'Accepted v1')
      }
    }
  })
}

test('public HTTP capabilities and subscribed state canonicalize input aliases identically', async t => {
  const app = await createApp()
  t.after(() => app.dispose())
  const server = await serve(app, { port: 0 })
  const session = app.events.subscribe()
  const capabilities = await (await fetch(server.url + '/api/capabilities')).json()
  const state = await (await fetch(server.url + '/api/state?subscriptionId=' + session.ready.subscriptionId)).json()
  assert.deepEqual(capabilities.inputFormats, ['txt', 'md'])
  assert.deepEqual(state.state.capabilities.inputFormats, capabilities.inputFormats)
})


test('source withdrawal after admission fails the queued task and preserves its frozen snapshot for retry', async t => {
  const f = await fixture(t)
  const { app, document } = f
  const schedule = t.mock.method(app.tasks, 'schedule', () => {})
  const submitted = await app.tasks.exportDocument(document.id, { contentMode: 'source', outputs: [{ format: 'json' }] })
  assert.equal(app.records.getTask(submitted.taskId).state, 'queued')
  f.remove()
  schedule.mock.restore()
  app.tasks.schedule()
  const failed = await app.tasks.wait(submitted.taskId)
  assert.equal(failed.state, 'failed')
  assert.match(failed.error.message, /Source adapter is unavailable/)
  assert.equal(app.records.getSnapshot(document.id, submitted.snapshotId).id, submitted.snapshotId)
  assert.deepEqual(app.records.listArtifacts(document.id), [])
  app.parse.register(source())
  await app.tasks.resume(submitted.taskId)
  const done = await app.tasks.wait(submitted.taskId)
  assert.equal(done.state, 'succeeded')
  assert.equal(done.snapshotId, submitted.snapshotId)
  assert.equal(JSON.parse(await readFile(done.artifacts[0].path, 'utf8')).units[0].text, 'Source v1')
})

test('discovery checks structural compatibility without executing source projections', async t => {
  const f = await fixture(t)
  f.remove()
  let calls = 0
  f.app.parse.register(source({ readableText: () => { calls++; throw new Error('projection execution failed') },
    status: () => ({ state: 'unavailable' }) }))
  // An unavailable importer can still project already frozen data. Import status
  // is not a proxy for output capability, and arbitrary adapter code runs only at execution.
  assert.ok(f.app.records.getDocument(f.document.id).availableOutputs.includes('json'))
  assert.equal(calls, 0)
  await assert.rejects(f.app.exporter.exportDocument(f.document.id,
    { contentMode: 'source', outputs: [{ format: 'json' }] }), /projection execution failed/)
  assert.equal(calls, 1)
  assert.equal(f.app.records.listSnapshots(f.document.id).length, 2)
})
