import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-ownership-'))
  const store = join(dir, 'store.sqlite')
  let app = await createApp({ store })
  t.after(async () => { await app.dispose(); await rm(dir, { recursive: true, force: true }) })
  return { get app() { return app }, async restart() { await app.dispose(); app = await createApp({ store }) } }
}
async function document(records, sourceId, content = 'Same source.') {
  return (await records.importDocument({ format: 'txt', content }, { sourceId, language: 'en' })).document
}
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve }); return { promise, release } }

test('ownership indexes follow opaque additions, replacements, removals and reopen', async t => {
  const f = await fixture(t)
  const r = f.app.records
  const doc = await document(r, 'index')
  const original = r.record(doc.id).units[0].id
  const unitId = 'opaque/unit:α', revisionId = 'opaque.revision', taskId = 'import.not-a-prefix', artifactId = 'opaque:artifact'
  await r.update(doc.id, row => ({ ...row, units: row.units.map(unit => ({ ...unit, id: unitId })) }))
  assert.throws(() => r.locateUnit(original), { code: 'NOT_FOUND' })
  assert.throws(() => r.locateUnit(unitId, { docId: 'wrong' }), { code: 'NOT_FOUND' })
  const saved = await r.writeRevision(unitId, { targetLang: 'zh', text: '译文', baseRevisionId: null })
  await r.update(doc.id, row => ({ ...row, revisions: [{ ...row.revisions[0], id: revisionId }],
    latest: { [`${unitId}\u0000zh`]: revisionId } }))
  assert.throws(() => r.locateRevision(saved.id), { code: 'NOT_FOUND' })
  await r.acceptRevision(revisionId, { expectedAcceptedRevisionId: null })
  const task = await r.createTranslationTask(doc.id, { targetLang: 'zh' })
  await r.update(doc.id, row => ({ ...row, tasks: row.tasks.map(item => ({ ...item, id: taskId, state: 'paused' })) }))
  assert.throws(() => r.getTask(task.id), { code: 'NOT_FOUND' })
  const snapshot = await r.createSnapshot(doc.id, { contentMode: 'source' })
  const item = await r.addArtifact(doc.id, { snapshotId: snapshot.id, format: 'md', path: join(tmpdir(), 'unused-index-path') })
  await r.update(doc.id, row => ({ ...row, artifacts: [{ ...row.artifacts[0], id: artifactId }] }))
  assert.throws(() => r.locateArtifact(item.id), { code: 'NOT_FOUND' })
  await f.restart()
  assert.equal(f.app.records.locateUnit(unitId).docId, doc.id)
  assert.equal(f.app.records.locateRevision(revisionId).revision.text, '译文')
  assert.equal(f.app.records.getTask(taskId).state, 'paused')
  assert.equal(f.app.records.findReusable(unitId, { targetLang: 'zh' }).id, revisionId)
  assert.throws(() => f.app.records.locateArtifact(artifactId, { docId: 'wrong' }), { code: 'NOT_FOUND' })
  await f.app.records.deleteArtifact(doc.id, artifactId)
  assert.throws(() => f.app.records.locateArtifact(artifactId), { code: 'NOT_FOUND' })
  await f.app.records.update(doc.id, row => ({ ...row, units: [], revisions: [], tasks: [], accepted: {}, latest: {} }))
  for (const [lookup, value] of [['locateUnit', unitId], ['locateRevision', revisionId], ['getTask', taskId]])
    assert.throws(() => f.app.records[lookup](value), { code: 'NOT_FOUND' })
  await f.restart()
  assert.throws(() => f.app.records.locateUnit(unitId), { code: 'NOT_FOUND' })
})

test('duplicate IDs fail closed within and across documents and the combined task namespace', async t => {
  const f = await fixture(t), r = f.app.records
  const a = await document(r, 'duplicate-a'), b = await document(r, 'duplicate-b')
  const unitId = r.record(a.id).units[0].id
  const revision = await r.writeRevision(unitId, { targetLang: 'zh', text: '译文', baseRevisionId: null })
  const task = await r.createTranslationTask(a.id, { targetLang: 'zh' })
  const snapshot = await r.createSnapshot(a.id, { contentMode: 'source' })
  const artifact = await r.addArtifact(a.id, { snapshotId: snapshot.id, format: 'md', path: 'duplicate-output.md' })
  await r.updateTask(task.id, row => ({ ...row, state: 'failed' }))
  const source = r.record(a.id)
  await r.update(b.id, row => ({ ...row, units: source.units, revisions: source.revisions,
    tasks: source.tasks, artifacts: source.artifacts }))
  for (const [lookup, value] of [['locateUnit', unitId], ['locateRevision', revision.id], ['getTask', task.id], ['locateArtifact', artifact.id]])
    assert.throws(() => r[lookup](value), { code: 'CONFLICT' })
  // A supplied owner cannot conceal ambiguity elsewhere.
  assert.throws(() => r.locateUnit(unitId, { docId: a.id }), { code: 'CONFLICT' })
  await f.restart()
  const reopened = f.app.records
  assert.throws(() => reopened.locateUnit(unitId), { code: 'CONFLICT' })
  await reopened.table.delete(b.id)
  assert.equal(reopened.locateUnit(unitId).docId, a.id)
  await reopened.update(a.id, row => ({ ...row, units: [...row.units, row.units[0]] }))
  assert.throws(() => reopened.locateUnit(unitId), { code: 'CONFLICT' })
  await reopened.update(a.id, row => ({ ...row, units: row.units.slice(0, 1),
    operationTasks: [{ ...task, kind: 'export', snapshotId: snapshot.id, outputs: [] }] }))
  assert.throws(() => reopened.getTask(task.id), { code: 'CONFLICT' })
  await reopened.update(a.id, row => ({ ...row, operationTasks: [] }))
  const imported = await reopened.createImportTask('import identity')
  await reopened.importTable.put(task.id, { ...imported, id: task.id })
  assert.throws(() => reopened.getTask(task.id), { code: 'CONFLICT' })
  await reopened.importTable.delete(task.id)
  assert.equal(reopened.getTask(task.id).kind, 'translate')
})

test('failed and overlapping durable writes cannot publish phantom or stale ownership', async t => {
  const f = await fixture(t), r = f.app.records
  const doc = await document(r, 'commit-order')
  const oldId = r.record(doc.id).units[0].id
  const backend = r.table.host.unit, put = backend.putRecord.bind(backend)
  const entered = gate(), release = gate()
  let first = true
  backend.putRecord = async (...args) => {
    if (first) { first = false; entered.release(); await release.promise; throw new Error('injected durable failure') }
    return put(...args)
  }
  t.after(() => { backend.putRecord = put; release.release() })
  const rename = id => r.update(doc.id, row => ({ ...row, units: row.units.map(unit => ({ ...unit, id })) }))
  const failed = assert.rejects(rename('phantom-unit'), /injected durable failure/)
  await entered.promise
  const succeeding = rename('committed-unit')
  assert.equal(r.locateUnit(oldId).docId, doc.id)
  assert.throws(() => r.locateUnit('phantom-unit'), { code: 'NOT_FOUND' })
  assert.throws(() => r.locateUnit('committed-unit'), { code: 'NOT_FOUND' })
  const observed = []
  const stop = f.app.ctx.on('domain/changed', change => {
    if (change.table === 'documents' && change.key === doc.id) {
      observed.push(r.locateUnit(change.value.units[0].id).unit.id)
    }
  })
  release.release()
  await Promise.all([failed, succeeding])
  stop(); backend.putRecord = put
  assert.deepEqual(observed, ['committed-unit'])
  assert.throws(() => r.locateUnit(oldId), { code: 'NOT_FOUND' })
  assert.throws(() => r.locateUnit('phantom-unit'), { code: 'NOT_FOUND' })
  await Promise.all([rename('intermediate-unit'), rename('last-unit')])
  assert.equal(r.locateUnit('last-unit').docId, doc.id)
  assert.throws(() => r.locateUnit('intermediate-unit'), { code: 'NOT_FOUND' })
  let attempted
  backend.putRecord = async (table, key, value) => { attempted = value; throw new Error('failed insert') }
  await assert.rejects(document(r, 'failed-import'), /failed insert/)
  assert.throws(() => r.locateUnit(attempted.units[0].id), { code: 'NOT_FOUND' })
  backend.putRecord = put
  await f.restart()
  assert.equal(f.app.records.locateUnit('last-unit').docId, doc.id)
  assert.throws(() => f.app.records.locateUnit('phantom-unit'), { code: 'NOT_FOUND' })
})

// Count collection visits, not elapsed time: wrap only reads, leaving storage and
// its durable-commit notifications intact. An all-library scan must see these.
function countReads(records) {
  const get = records.table.get.bind(records.table), entries = records.table.entries.bind(records.table)
  const counts = { entries: 0, rows: 0, items: 0 }
  const wrap = record => record && { ...record, ...Object.fromEntries(
    ['units', 'revisions', 'tasks', 'operationTasks', 'artifacts'].map(collection => [collection,
      new Proxy(record[collection] ?? [], { get(array, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) counts.items++
        return Reflect.get(array, key, receiver)
      } })])) }
  records.table.get = key => wrap(get(key))
  records.table.entries = function* () {
    counts.entries++
    for (const [key, record] of entries()) { counts.rows++; yield [key, wrap(record)] }
  }
  return { counts, restore() { records.table.get = get; records.table.entries = entries } }
}

test('lookup work stays bounded when the library grows from 1 to 40 documents', async t => {
  const f = await fixture(t), r = f.app.records
  const content = Array.from({ length: 200 }, (_, i) => `Unit ${i}.`).join('\n\n')
  const doc = await document(r, 'scale-0', content)
  const ids = r.record(doc.id).units.slice(0, 20).map(unit => unit.id)
  const task = await r.createTranslationTask(doc.id, { targetLang: 'zh' })
  const measure = () => {
    const probe = countReads(r)
    try {
      for (const unitId of ids) {
        r.getUnit(unitId, { targetLang: 'zh' })
        r.getBasis(unitId, { targetLang: 'zh' })
        r.findReusable(unitId, { targetLang: 'zh' })
        r.getTask(task.id)
      }
      assert.throws(() => r.locateUnit('absent-unit'), { code: 'NOT_FOUND' })
      return { ...probe.counts }
    } finally { probe.restore() }
  }
  const small = measure()
  for (let i = 1; i < 40; i++) await document(r, `scale-${i}`, content)
  const large = measure()
  assert.deepEqual(large, small)
  assert.equal(large.entries, 0)
  assert.ok(large.items < 500, JSON.stringify(large))
  const probe = countReads(r)
  try { await r.updateTask(task.id, row => ({ ...row, state: 'paused' })) }
  finally { probe.restore() }
  assert.equal(probe.counts.entries, 0, 'a document update must not rebuild from the whole library')
  t.diagnostic(`1 and 40 documents: ${JSON.stringify(large)}`)
})

test('reuse commit uses indexed source ownership and rejects an ambiguous source', async t => {
  const f = await fixture(t), r = f.app.records
  const a = await document(r, 'reuse-a'), b = await document(r, 'reuse-b')
  const sourceUnit = r.record(a.id).units[0].id, targetUnit = r.record(b.id).units[0].id
  const revision = await r.writeRevision(sourceUnit, { targetLang: 'zh', text: '译文', baseRevisionId: null })
  await r.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  assert.equal(r.findReusable(targetUnit, { targetLang: 'zh' }).id, revision.id)
  const task = await r.createTranslationTask(b.id, { targetLang: 'zh' })
  await r.updateTask(task.id, row => ({ ...row, state: 'running' }))
  const args = { unitId: targetUnit, expectedBasis: r.getBasis(targetUnit, { targetLang: 'zh' }),
    baseRevisionId: null, expectedAcceptedRevisionId: null, reusedRevisionId: revision.id }
  await r.update(b.id, row => ({ ...row, revisions: [r.record(a.id).revisions[0]] }))
  await assert.rejects(r.commitTaskUnit(task.id, args), { code: 'CONFLICT' })
  await r.update(b.id, row => ({ ...row, revisions: [] }))
  const probe = countReads(r)
  try { await r.commitTaskUnit(task.id, args) } finally { probe.restore() }
  assert.equal(probe.counts.entries, 0)
  assert.equal(r.getTask(task.id).cursor, 1)
  assert.equal(r.getUnit(targetUnit, { targetLang: 'zh' }).accepted.text, '译文')
  await f.restart()
  assert.equal(f.app.records.getUnit(targetUnit, { targetLang: 'zh' }).accepted.text, '译文')
})
