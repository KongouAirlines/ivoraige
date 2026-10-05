import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-tasks-'))
  const store = join(directory, 'records.sqlite')
  let app = await createApp({ store })
  t.after(async () => { if (app) await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  return { get records() { return app.records }, async restart() { await app.dispose(); app = await createApp({ store }) } }
}

test('task checkpoint, accepted revision and cursor persist together across restart', async t => {
  const f = await fixture(t)
  const { document } = await f.records.importDocument({ format: 'txt', content: 'First.\n\nSecond.' },
    { sourceId: 'tasks:1', language: 'en' })
  const units = f.records.listUnits(document.id, { targetLang: 'zh' })
  const task = await f.records.createTranslationTask(document.id, { targetLang: 'zh' })
  await assert.rejects(f.records.createTranslationTask(document.id, { targetLang: 'fr' }),
    error => error.code === 'CONFLICT' && error.details.taskId === task.id)
  await f.records.updateTask(task.id, task => ({ ...task, state: 'running' }))
  await f.records.incrementTaskCall(task.id)
  const first = await f.records.commitTaskUnit(task.id, { unitId: units[0].id,
    expectedBasis: f.records.getBasis(units[0].id, { targetLang: 'zh' }),
    baseRevisionId: null, expectedAcceptedRevisionId: null,
    result: { text: '第一。', modelId: 'test-model', tokens: { input: 7, output: 3 } } })
  assert.equal(first.task.cursor, 1)
  assert.equal(first.revision.status, 'accepted')
  await f.restart()
  assert.equal(f.records.getTask(task.id).cursor, 1)
  assert.equal(f.records.getTask(task.id).checkpoints[0].revisionId, first.revision.id)
  assert.equal(f.records.getUnit(units[0].id, { targetLang: 'zh' }).accepted.text, '第一。')
  await assert.rejects(f.records.commitTaskUnit(task.id, { unitId: units[0].id,
    expectedBasis: f.records.getBasis(units[0].id, { targetLang: 'zh' }),
    baseRevisionId: first.revision.id, expectedAcceptedRevisionId: first.revision.id,
    result: { text: '重复。' } }), { code: 'CONFLICT' })
  const second = await f.records.commitTaskUnit(task.id, { unitId: units[1].id,
    expectedBasis: f.records.getBasis(units[1].id, { targetLang: 'zh' }),
    baseRevisionId: null, expectedAcceptedRevisionId: null, result: { text: '第二。' } })
  assert.equal(second.task.cursor, 2)
  assert.deepEqual(second.task.stats.tokens.translation, { input: null, output: null })
  assert.equal(second.task.stats.llmCalls, 1)
  assert.equal(second.task.stats.reuseRatio, 0)
})

test('changed basis and concurrent edit reject model response without advancing task', async t => {
  const f = await fixture(t)
  const { document } = await f.records.importDocument({ format: 'txt', content: 'Source.' },
    { sourceId: 'tasks:2', language: 'en' })
  const [unit] = f.records.listUnits(document.id, { targetLang: 'zh' })
  const task = await f.records.createTranslationTask(document.id, { targetLang: 'zh', mode: 'careful' })
  await f.records.updateTask(task.id, task => ({ ...task, state: 'running' }))
  const expectedBasis = f.records.getBasis(unit.id, { targetLang: 'zh' })
  await f.records.setConstraints(unit.id, { targetLang: 'zh', effectiveContext: {},
    effectiveTarget: { style: 'formal' }, termConstraintSetId: 'none' })
  const commit = (basis, baseRevisionId) => f.records.commitTaskUnit(task.id, { unitId: unit.id,
    expectedBasis: basis, baseRevisionId, expectedAcceptedRevisionId: null,
    result: { text: '机器译文' } })
  await assert.rejects(commit(expectedBasis, null), { code: 'PRECONDITION_FAILED' })
  const human = await f.records.writeRevision(unit.id, { targetLang: 'zh', text: '人工译文', baseRevisionId: null })
  await assert.rejects(commit(f.records.getBasis(unit.id, { targetLang: 'zh' }), null), { code: 'CONFLICT' })
  assert.equal(f.records.getTask(task.id).cursor, 0)
  assert.deepEqual(f.records.listRevisions(unit.id, { targetLang: 'zh' }).map(r => r.id), [human.id])
})

test('cross-document reuse copies a local revision and checks live applicability', async t => {
  const f = await fixture(t)
  const source = { format: 'txt', content: 'Repeated.' }
  const a = (await f.records.importDocument(source, { sourceId: 'reuse:a', language: 'en' })).document
  const b = (await f.records.importDocument(source, { sourceId: 'reuse:b', language: 'en' })).document
  const [aUnit] = f.records.listUnits(a.id, { targetLang: 'zh' })
  const [bUnit] = f.records.listUnits(b.id, { targetLang: 'zh' })
  const accepted = await f.records.writeRevision(aUnit.id, { targetLang: 'zh', text: '重复。', baseRevisionId: null })
  await f.records.acceptRevision(accepted.id, { expectedAcceptedRevisionId: null })
  const task = await f.records.createTranslationTask(b.id, { targetLang: 'zh' })
  await f.records.updateTask(task.id, task => ({ ...task, state: 'running' }))
  const basis = f.records.getBasis(bUnit.id, { targetLang: 'zh' })
  const reused = await f.records.commitTaskUnit(task.id, { unitId: bUnit.id, expectedBasis: basis,
    baseRevisionId: null, expectedAcceptedRevisionId: null, reusedRevisionId: accepted.id })
  assert.equal(reused.reused, true)
  assert.equal(reused.revision.text, '重复。')
  assert.notEqual(reused.revision.id, accepted.id)
  assert.equal(reused.task.stats.reusedUnits, 1)
  assert.equal(f.records.getUnit(bUnit.id, { targetLang: 'zh' }).accepted.id, reused.revision.id)
})

test('same-unit reuse checkpoints accepted text without hiding a later human draft', async t => {
  const f = await fixture(t)
  const { document } = await f.records.importDocument({ format: 'txt', content: 'Original.' },
    { sourceId: 'reuse:same', language: 'en' })
  const [unit] = f.records.listUnits(document.id, { targetLang: 'zh' })
  const accepted = await f.records.writeRevision(unit.id,
    { targetLang: 'zh', text: '已接受。', baseRevisionId: null })
  await f.records.acceptRevision(accepted.id, { expectedAcceptedRevisionId: null })
  const draft = await f.records.writeRevision(unit.id,
    { targetLang: 'zh', text: '人工草稿。', baseRevisionId: accepted.id })
  const task = await f.records.createTranslationTask(document.id, { targetLang: 'zh' })
  await f.records.updateTask(task.id, task => ({ ...task, state: 'running' }))
  const committed = await f.records.commitTaskUnit(task.id, { unitId: unit.id,
    expectedBasis: f.records.getBasis(unit.id, { targetLang: 'zh' }),
    baseRevisionId: draft.id, expectedAcceptedRevisionId: accepted.id,
    reusedRevisionId: accepted.id })
  assert.equal(committed.reused, true)
  assert.equal(committed.task.cursor, 1)
  assert.equal(f.records.getUnit(unit.id, { targetLang: 'zh' }).accepted.id, accepted.id)
  assert.equal(f.records.getUnit(unit.id, { targetLang: 'zh' }).draft.id, draft.id)
  assert.equal(f.records.listRevisions(unit.id, { targetLang: 'zh' }).length, 2)
})

test('local accepted human choice takes priority over a reusable translation from another document', async t => {
  const f = await fixture(t)
  const source = { format: 'txt', content: 'Term.' }
  const first = (await f.records.importDocument(source, { sourceId: 'choice:a', language: 'en' })).document
  const second = (await f.records.importDocument(source, { sourceId: 'choice:b', language: 'en' })).document
  const [firstUnit] = f.records.listUnits(first.id, { targetLang: 'zh' })
  const [secondUnit] = f.records.listUnits(second.id, { targetLang: 'zh' })
  const foreign = await f.records.writeRevision(firstUnit.id,
    { targetLang: 'zh', text: '术语。', baseRevisionId: null })
  await f.records.acceptRevision(foreign.id, { expectedAcceptedRevisionId: null })
  const local = await f.records.writeRevision(secondUnit.id,
    { targetLang: 'zh', text: '名词。', baseRevisionId: null })
  await f.records.acceptRevision(local.id, { expectedAcceptedRevisionId: null })
  assert.equal(f.records.findReusable(secondUnit.id, { targetLang: 'zh' }).id, local.id)
  const task = await f.records.createTranslationTask(second.id, { targetLang: 'zh' })
  await f.records.updateTask(task.id, task => ({ ...task, state: 'running' }))
  const checkpoint = await f.records.commitTaskUnit(task.id, { unitId: secondUnit.id,
    expectedBasis: f.records.getBasis(secondUnit.id, { targetLang: 'zh' }),
    baseRevisionId: local.id, expectedAcceptedRevisionId: local.id, reusedRevisionId: local.id })
  assert.equal(checkpoint.task.stats.reusedUnits, 1)
  assert.equal(checkpoint.task.stats.reuseRatio, 1)
  assert.equal(f.records.getUnit(secondUnit.id, { targetLang: 'zh' }).accepted.id, local.id)
})

test('token unknowns survive partial usage and a failed model attempt', async t => {
  const f = await fixture(t)
  const { document } = await f.records.importDocument({ format: 'txt', content: 'One.\n\nTwo.' },
    { sourceId: 'stats:partial', language: 'en' })
  const units = f.records.listUnits(document.id, { targetLang: 'zh' })
  const task = await f.records.createTranslationTask(document.id, { targetLang: 'zh' })
  await f.records.updateTask(task.id, task => ({ ...task, state: 'running' }))
  await f.records.incrementTaskCall(task.id) // failed invocation, no result to commit
  await f.records.incrementTaskCall(task.id)
  const first = await f.records.commitTaskUnit(task.id, { unitId: units[0].id,
    expectedBasis: f.records.getBasis(units[0].id, { targetLang: 'zh' }),
    baseRevisionId: null, expectedAcceptedRevisionId: null,
    result: { text: '一。', tokens: { input: 4, output: null } } })
  assert.deepEqual(first.task.stats.tokens.translation, { input: null, output: null })
  await f.records.incrementTaskCall(task.id)
  const second = await f.records.commitTaskUnit(task.id, { unitId: units[1].id,
    expectedBasis: f.records.getBasis(units[1].id, { targetLang: 'zh' }),
    baseRevisionId: null, expectedAcceptedRevisionId: null,
    result: { text: '二。', tokens: { input: 2, output: 2 } } })
  assert.equal(second.task.stats.llmCalls, 3)
  assert.deepEqual(second.task.stats.tokens.translation, { input: null, output: null })
  assert.equal(second.task.stats.reuseRatio, 0)
})

test('partial provider usage retains known input and unknown output', async t => {
  const f = await fixture(t)
  const { document } = await f.records.importDocument({ format: 'txt', content: 'One.\n\nTwo.' },
    { sourceId: 'stats:partial-only', language: 'en' })
  const [unit] = f.records.listUnits(document.id, { targetLang: 'zh' })
  const task = await f.records.createTranslationTask(document.id, { targetLang: 'zh' })
  await f.records.updateTask(task.id, task => ({ ...task, state: 'running' }))
  await f.records.incrementTaskCall(task.id)
  const committed = await f.records.commitTaskUnit(task.id, { unitId: unit.id,
    expectedBasis: f.records.getBasis(unit.id, { targetLang: 'zh' }),
    baseRevisionId: null, expectedAcceptedRevisionId: null,
    result: { text: '一。', tokens: { input: 4, output: null } } })
  assert.deepEqual(committed.task.stats.tokens.translation, { input: 4, output: null })
  const afterSecondAttempt = await f.records.incrementTaskCall(task.id)
  assert.deepEqual(afterSecondAttempt.stats.tokens.translation, { input: null, output: null })
})
