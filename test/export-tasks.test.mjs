import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
async function bounded(promise) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out waiting for export task')), 5000)
  })]) } finally { clearTimeout(timer) }
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-export-tasks-'))
  const store = join(directory, 'records.sqlite')
  const exportDir = join(directory, 'out')
  let app = await createApp({ store, exportDir })
  const gates = []
  t.after(async () => {
    for (const gate of gates) gate.resolve()
    await app.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  return {
    get app() { return app },
    gate() { const gate = deferred(); gates.push(gate); return gate },
    async restart() { await app.dispose(); app = await createApp({ store, exportDir }); return app },
  }
}
async function document(app, sourceId, content) {
  const { document } = await app.records.importDocument({ format: 'txt', content }, { sourceId, language: 'en' })
  const [unit] = app.records.listUnits(document.id, { targetLang: 'zh' })
  const revision = await app.records.writeRevision(unit.id, {
    targetLang: 'zh', text: `译文：${content}`, baseRevisionId: null,
  })
  await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  return document
}
function slowAdapter(app, entered, gate, calls) {
  app.outputs.register({ id: 'slow', supports: binding => binding.adapterId === 'txt',
    async rebuild(data) {
      calls.count++
      entered.resolve(data.snapshot.id)
      await gate.promise
      return data.units[0].text
    },
  })
}

test('a queued export pauses durably and resumes after restart', async t => {
  const f = await fixture(t)
  const entered = deferred(), gate = f.gate(), calls = { count: 0 }
  slowAdapter(f.app, entered, gate, calls)
  const first = await document(f.app, 'export:queue:first', 'First source.')
  const second = await document(f.app, 'export:queue:second', 'Second source.')
  const blocker = await f.app.tasks.exportDocument(first.id, { targetLang: 'zh', outputs: [{ format: 'slow' }] })
  await bounded(entered.promise)
  const queued = await f.app.tasks.exportDocument(second.id, { targetLang: 'zh', outputs: [{ format: 'md' }] })
  assert.equal((await f.app.tasks.get(queued.taskId)).state, 'queued')
  const paused = await f.app.tasks.pause(queued.taskId)
  assert.equal(paused.state, 'paused')
  assert.equal(paused.cursor, 0)
  await assert.rejects(f.app.records.deleteSnapshot(second.id, queued.snapshotId),
    error => error.code === 'CONFLICT' && error.details.taskIds?.includes(queued.taskId))
  gate.resolve()
  assert.equal((await bounded(f.app.tasks.wait(blocker.taskId))).state, 'succeeded')
  await f.restart()
  assert.equal((await f.app.tasks.get(queued.taskId)).state, 'paused')
  await f.app.tasks.resume(queued.taskId)
  const done = await bounded(f.app.tasks.wait(queued.taskId))
  assert.equal(done.state, 'succeeded')
  assert.equal(done.cursor, 1)
  assert.equal(done.artifacts[0].snapshotId, queued.snapshotId)
  assert.match(await readFile(done.artifacts[0].path, 'utf8'), /译文：Second source/)
  assert.equal(calls.count, 1)
})

test('pause at a format boundary preserves artifact checkpoint across restart', async t => {
  const f = await fixture(t)
  const entered = deferred(), gate = f.gate(), calls = { count: 0 }
  slowAdapter(f.app, entered, gate, calls)
  const doc = await document(f.app, 'export:format-boundary', 'Measured twice.')
  const submitted = await f.app.tasks.exportDocument(doc.id, {
    targetLang: 'zh', outputs: [{ format: 'slow' }, { format: 'md' }],
  })
  await bounded(entered.promise)
  const pausing = f.app.tasks.pause(submitted.taskId)
  gate.resolve()
  const paused = await bounded(pausing)
  assert.equal(paused.state, 'paused')
  assert.equal(paused.cursor, 1)
  assert.equal(paused.progress.done, 1)
  assert.equal(paused.artifacts.length, 1)
  const firstArtifact = paused.artifacts[0]
  assert.equal(firstArtifact.format, 'slow')
  await f.restart()
  const persisted = await f.app.tasks.get(submitted.taskId)
  assert.equal(persisted.cursor, 1)
  assert.deepEqual(persisted.artifacts.map(item => item.id), [firstArtifact.id])
  await f.app.tasks.resume(submitted.taskId)
  const done = await bounded(f.app.tasks.wait(submitted.taskId))
  assert.equal(done.state, 'succeeded')
  assert.equal(done.cursor, 2)
  assert.deepEqual(done.artifacts.map(item => item.format), ['slow', 'md'])
  assert.equal(done.artifacts[0].id, firstArtifact.id)
  assert.equal(f.app.records.listArtifacts(doc.id).length, 2)
  assert.equal(calls.count, 1)
})

test('canceling a pending export releases its snapshot when no artifact exists', async t => {
  const f = await fixture(t)
  const entered = deferred(), gate = f.gate(), calls = { count: 0 }
  slowAdapter(f.app, entered, gate, calls)
  const first = await document(f.app, 'export:cancel:first', 'Blocker.')
  const second = await document(f.app, 'export:cancel:second', 'Pending.')
  const blocker = await f.app.tasks.exportDocument(first.id, { targetLang: 'zh', outputs: [{ format: 'slow' }] })
  await bounded(entered.promise)
  const pending = await f.app.tasks.exportDocument(second.id, { targetLang: 'zh', outputs: [{ format: 'md' }] })
  assert.equal((await f.app.tasks.cancel(pending.taskId)).state, 'canceled')
  assert.deepEqual(f.app.records.listArtifacts(second.id), [])
  await f.app.records.deleteSnapshot(second.id, pending.snapshotId)
  assert.deepEqual(f.app.records.listSnapshots(second.id), [])
  gate.resolve()
  assert.equal((await bounded(f.app.tasks.wait(blocker.taskId))).state, 'succeeded')
  assert.equal((await f.app.tasks.get(pending.taskId)).state, 'canceled')
})
