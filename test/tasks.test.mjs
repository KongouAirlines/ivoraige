import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service, JobsLocal, Storage, StorageDomain, StorageSqlite } from '../dist/dsh.mjs'
import { Tasks } from '../src/tasks.mjs'
import { Parse } from '../src/parse.mjs'
import { Outputs } from '../src/outputs.mjs'
import { TxtSource } from '../src/adapters/txt-source.mjs'
import { Records } from '../src/records.mjs'
import { Importer } from '../src/import.mjs'

let translate = async ({ basis }) => ({ text: `译:${basis.sourceText}`, modelId: 'test',
  promptVersion: 'test-v1', tokens: { input: null, output: null } })
let preflight = async () => {}
class TestModel extends Service {
  constructor(ctx) { super(ctx, 'ivoraige.translationModel') }
  preflight(input) { return preflight(input) }
  translate(input) { return translate(input) }
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-tasks-'))
  const store = join(directory, 'records.sqlite')
  let ctx, tasks, records
  async function start() {
    ctx = new Context()
    await ctx.plugin(Outputs)
    await ctx.plugin(Parse)
    await ctx.plugin(TxtSource)
    await ctx.plugin(Storage)
    await ctx.plugin(StorageSqlite, { path: store })
    await ctx.plugin(StorageDomain, { backend: 'sqlite' })
    await ctx.plugin(Records)
    await ctx.plugin(Importer)
    await ctx.plugin(TestModel)
    await ctx.plugin(JobsLocal, { maxConcurrentJobsPerOwner: 1 })
    await ctx.plugin(Tasks)
    records = ctx.get('ivoraige.records')
    tasks = ctx.get('ivoraige.tasks')
    await tasks.ready
  }
  await start()
  t.after(async () => {
    if (ctx) { await tasks.close(); await ctx.fiber.dispose() }
    await rm(directory, { recursive: true, force: true })
  })
  return { get tasks() { return tasks }, get records() { return records },
    async restart() { await tasks.close(); await ctx.fiber.dispose(); await start() } }
}

const source = { format: 'txt', content: 'First.\n\nSecond.' }
async function document(f, sourceId = 'paper:1') {
  return (await f.records.importDocument(source, { sourceId, language: 'en' })).document
}

test('embedded Records without a prompt storage gate rejects new prompt fields atomically', async t => {
  const f = await fixture(t)
  const doc = await document(f)
  await assert.rejects(f.records.createTranslationTask(doc.id,
    { targetLang: 'zh-CN', promptTemplateId: 'chosen' }), { code: 'PRECONDITION_FAILED' })
  assert.equal(f.records.listTasks({ docId: doc.id }).length, 0)
  const task = await f.records.createTranslationTask(doc.id, { targetLang: 'zh-CN' })
  await assert.rejects(f.records.updateTask(task.id, current => ({ ...current,
    promptSelection: { prompt: { contentId: 'new' } } })), { code: 'PRECONDITION_FAILED' })
  assert.equal(f.records.getTask(task.id).promptSelection, undefined)
})

test('fast task commits accepted revisions and reuse skips model calls', async t => {
  const f = await fixture(t)
  const doc = await document(f)
  let calls = 0
  translate = async ({ basis }) => {
    calls++
    return { text: `译:${basis.sourceText}`, modelId: 'test', promptVersion: 'v1',
      tokens: { input: 3, output: 4 } }
  }
  const { taskId } = await f.tasks.submit(doc.id, { targetLang: 'zh-CN' })
  const done = await f.tasks.wait(taskId)
  assert.equal(done.state, 'succeeded')
  assert.equal(done.progress.done, 2)
  assert.equal(calls, 2)
  assert.equal(done.stats.tokens.translation.input, 6)
  const units = f.records.listUnits(doc.id, { targetLang: 'zh-CN' })
  assert.ok(units.every(unit => unit.acceptedRevisionId))
  const again = await f.tasks.submit(doc.id, { targetLang: 'zh-CN' })
  const reused = await f.tasks.wait(again.taskId)
  assert.equal(reused.state, 'succeeded')
  assert.equal(reused.stats.reusedUnits, 2)
  assert.equal(calls, 2)
})

test('pause waits for a unit boundary and resume continues from durable cursor', async t => {
  const f = await fixture(t)
  const doc = await document(f)
  let release
  let entered
  const started = new Promise(resolve => { entered = resolve })
  let calls = 0
  translate = async ({ basis }) => {
    calls++
    entered()
    await new Promise(resolve => { release = resolve })
    return { text: `译:${basis.sourceText}`, modelId: 'test', promptVersion: 'v1',
      tokens: { input: null, output: null } }
  }
  const { taskId } = await f.tasks.submit(doc.id, { targetLang: 'zh-CN', mode: 'careful' })
  await started
  const pausedPromise = f.tasks.pause(taskId)
  release()
  const paused = await pausedPromise
  assert.equal(paused.state, 'paused')
  assert.equal(paused.cursor, 1)
  const [firstUnit] = f.records.listUnits(doc.id, { targetLang: 'zh-CN' })
  const firstDraft = f.records.getUnit(firstUnit.id, { targetLang: 'zh-CN' }).draft.id
  await f.restart()
  assert.equal((await f.tasks.get(taskId)).state, 'paused')
  translate = async ({ basis }) => {
    calls++
    return { text: `译:${basis.sourceText}`, modelId: 'test',
      promptVersion: 'v1', tokens: { input: null, output: null } }
  }
  await f.tasks.resume(taskId)
  const done = await f.tasks.wait(taskId)
  assert.equal(done.state, 'succeeded')
  assert.equal(done.cursor, 2)
  assert.equal(calls, 2)
  assert.equal(f.records.getUnit(firstUnit.id, { targetLang: 'zh-CN' }).draft.id, firstDraft)
  assert.equal(f.records.listRevisions(firstUnit.id, { targetLang: 'zh-CN' }).length, 1)
})

test('cancel aborts the live call and concurrent submission conflicts', async t => {
  const f = await fixture(t)
  const doc = await document(f)
  let entered
  const started = new Promise(resolve => { entered = resolve })
  translate = ({ signal }) => new Promise((resolve, reject) => {
    entered()
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })
  const { taskId } = await f.tasks.submit(doc.id, { targetLang: 'zh-CN' })
  await started
  await assert.rejects(f.tasks.submit(doc.id, { targetLang: 'fr' }), { code: 'CONFLICT' })
  const canceled = await f.tasks.cancel(taskId)
  assert.equal(canceled.state, 'canceled')
  assert.equal(canceled.cursor, 0)
  assert.equal(f.records.listRevisions(f.records.listUnits(doc.id, { targetLang: 'zh-CN' })[0].id,
    { targetLang: 'zh-CN' }).length, 0)
})

test('careful task leaves drafts for acceptance', async t => {
  const f = await fixture(t)
  const doc = await document(f)
  translate = async ({ basis }) => ({ text: `译:${basis.sourceText}`, modelId: 'test',
    promptVersion: 'v1', tokens: { input: null, output: null } })
  const { taskId } = await f.tasks.submit(doc.id, { targetLang: 'zh-CN', mode: 'careful' })
  const done = await f.tasks.wait(taskId)
  assert.equal(done.state, 'succeeded')
  const view = f.records.getUnit(f.records.listUnits(doc.id, { targetLang: 'zh-CN' })[0].id,
    { targetLang: 'zh-CN' })
  assert.ok(view.draft)
  assert.equal(view.accepted, undefined)
})

test('queued tasks for another document can pause without starting a model call', async t => {
  const f = await fixture(t)
  const first = await document(f, 'paper:one')
  const second = await document(f, 'paper:two')
  let entered
  const started = new Promise(resolve => { entered = resolve })
  translate = ({ signal }) => new Promise((resolve, reject) => {
    entered()
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })
  const running = await f.tasks.submit(first.id, { targetLang: 'zh-CN' })
  await started
  const queued = await f.tasks.submit(second.id, { targetLang: 'zh-CN' })
  const paused = await f.tasks.pause(queued.taskId)
  assert.equal(paused.state, 'paused')
  assert.equal(paused.cursor, 0)
  await f.tasks.cancel(running.taskId)
  assert.equal((await f.tasks.get(queued.taskId)).state, 'paused')
})

test('canceling a queued task allows the next document to dispatch', async t => {
  const f = await fixture(t)
  const first = await document(f, 'paper:queue-one')
  const second = await document(f, 'paper:queue-two')
  const third = await document(f, 'paper:queue-three')
  let entered
  let release
  const started = new Promise(resolve => { entered = resolve })
  let calls = 0
  translate = async ({ basis }) => {
    calls++
    if (calls === 1) {
      entered()
      await new Promise(resolve => { release = resolve })
    }
    return { text: `译:${basis.sourceText}`, modelId: 'test', promptVersion: 'v1',
      tokens: { input: null, output: null } }
  }
  const running = await f.tasks.submit(first.id, { targetLang: 'zh-CN' })
  await started
  const queued = await f.tasks.submit(second.id, { targetLang: 'zh-CN' })
  const next = await f.tasks.submit(third.id, { targetLang: 'zh-CN' })
  assert.equal((await f.tasks.cancel(queued.taskId)).state, 'canceled')
  release()
  assert.equal((await f.tasks.wait(running.taskId)).state, 'succeeded')
  assert.equal((await f.tasks.wait(next.taskId)).state, 'succeeded')
  assert.equal((await f.tasks.get(queued.taskId)).cursor, 0)
})

test('resume rejects a changed basis for completed checkpoints', async t => {
  const f = await fixture(t)
  const doc = await document(f)
  let release
  let entered
  const started = new Promise(resolve => { entered = resolve })
  translate = async ({ basis }) => {
    entered()
    await new Promise(resolve => { release = resolve })
    return { text: `译:${basis.sourceText}`, modelId: 'test', promptVersion: 'v1',
      tokens: { input: null, output: null } }
  }
  const { taskId } = await f.tasks.submit(doc.id, { targetLang: 'zh-CN' })
  await started
  const pausing = f.tasks.pause(taskId)
  release()
  await pausing
  const [unit] = f.records.listUnits(doc.id, { targetLang: 'zh-CN' })
  const basis = f.records.getBasis(unit.id, { targetLang: 'zh-CN' })
  await f.records.setConstraints(unit.id, { targetLang: 'zh-CN',
    effectiveContext: basis.effectiveContext, effectiveTarget: { style: 'formal' },
    termConstraintSetId: 'terms:changed' })
  await assert.rejects(f.tasks.resume(taskId), { code: 'PRECONDITION_FAILED' })
  assert.equal((await f.tasks.get(taskId)).state, 'paused')
})

test('failed model attempts are counted and errors omit provider details', async t => {
  const f = await fixture(t)
  const doc = await document(f)
  translate = async () => { throw new Error('secret-key-value') }
  const { taskId } = await f.tasks.submit(doc.id, { targetLang: 'zh-CN' })
  const failed = await f.tasks.wait(taskId)
  assert.equal(failed.state, 'failed')
  assert.equal(failed.stats.llmCalls, 1)
  assert.equal(failed.cursor, 0)
  assert.ok(!JSON.stringify(failed).includes('secret-key-value'))
  translate = async ({ basis }) => ({ text: `译:${basis.sourceText}`, modelId: 'test',
    promptVersion: 'v1', tokens: { input: null, output: null } })
  await f.tasks.resume(taskId)
  const done = await f.tasks.wait(taskId)
  assert.equal(done.state, 'succeeded')
  assert.equal(done.stats.llmCalls, 3)
})

test('closing the gate during held preflight prevents model dispatch and call accounting', async t => {
  const f = await fixture(t)
  const doc = await document(f)
  let entered, release
  const started = new Promise(resolve => { entered = resolve })
  const held = new Promise(resolve => { release = resolve })
  preflight = () => { entered(); return held }
  let calls = 0
  translate = () => { calls++; throw new Error('model must not be called') }
  const { taskId } = await f.tasks.submit(doc.id, { targetLang: 'zh-CN' })
  await started
  f.tasks.stopAccepting()
  release()
  const paused = await f.tasks.wait(taskId)
  assert.equal(paused.state, 'paused')
  assert.equal(paused.cursor, 0)
  assert.equal(paused.stats.llmCalls, 0)
  assert.equal(calls, 0)
  preflight = async () => {}
})

test('closing the gate during held call accounting prevents model dispatch and restores count', async t => {
  const f = await fixture(t)
  const doc = await document(f)
  preflight = async () => {}
  let entered, release
  const started = new Promise(resolve => { entered = resolve })
  const held = new Promise(resolve => { release = resolve })
  const originalIncrement = f.records.incrementTaskCall.bind(f.records)
  f.records.incrementTaskCall = async taskId => {
    const updated = await originalIncrement(taskId)
    entered()
    await held
    return updated
  }
  let calls = 0
  translate = () => { calls++; throw new Error('model must not be called') }
  const { taskId } = await f.tasks.submit(doc.id, { targetLang: 'zh-CN' })
  await started
  assert.equal(f.records.getTask(taskId).stats.llmCalls, 1)
  await f.records.updateTask(taskId, current => ({ ...current, stats: { ...current.stats,
    stageDurationsMs: { ...current.stats.stageDurationsMs, translate: 91 },
    tokens: { ...current.stats.tokens, export: { input: 7, output: 9 } } } }))
  f.tasks.stopAccepting()
  release()
  const paused = await f.tasks.wait(taskId)
  assert.equal(paused.state, 'paused')
  assert.equal(paused.cursor, 0)
  assert.equal(paused.stats.llmCalls, 0)
  assert.equal(paused.stats.reuseRatio, 0)
  assert.deepEqual(paused.stats.tokens.translation, { input: null, output: null })
  assert.deepEqual(paused.stats.tokens.export, { input: 7, output: 9 })
  assert.equal(paused.stats.stageDurationsMs.translate >= 91, true)
  assert.equal(calls, 0)
})
