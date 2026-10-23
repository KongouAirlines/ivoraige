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

let entered
let markEntered
let aborts
class PendingModel extends Service {
  constructor(ctx) { super(ctx, 'ivoraige.translationModel') }
  translate({ signal }) {
    markEntered()
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { aborts++; reject(new Error('aborted')) }, { once: true })
    })
  }
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-lifecycle-'))
  const store = join(directory, 'records.sqlite')
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  await ctx.plugin(Outputs)
  await ctx.plugin(Parse)
  await ctx.plugin(TxtSource)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageSqlite, { path: store })
  await ctx.plugin(StorageDomain, { backend: 'sqlite' })
  const recordsFiber = ctx.plugin(Records)
  await recordsFiber
  await ctx.get('ivoraige.records').ready
  await ctx.plugin(Importer)
  await ctx.plugin(PendingModel)
  await ctx.plugin(JobsLocal, { maxConcurrentJobsPerOwner: 1 })
  const tasksFiber = ctx.plugin(Tasks)
  await tasksFiber
  const records = ctx.get('ivoraige.records')
  const tasks = ctx.get('ivoraige.tasks')
  await tasks.ready
  const { document } = await records.importDocument({ format: 'txt', content: 'One.\n\nTwo.' },
    { sourceId: 'lifecycle', language: 'en' })
  entered = new Promise(resolve => { markEntered = resolve })
  aborts = 0
  const { taskId } = await tasks.submit(document.id, { targetLang: 'zh' })
  await entered
  return { ctx, records, recordsFiber, tasks, tasksFiber, taskId, store }
}

test('direct root disposal aborts running work and startup recovery pauses it', async t => {
  const f = await fixture(t)
  const diagnostics = []
  const originalError = console.error
  console.error = (...parts) => { diagnostics.push(parts.join(' ')) }
  try { await f.ctx.fiber.dispose() } finally { console.error = originalError }
  assert.deepEqual(diagnostics, [])
  assert.equal(aborts, 1)
  const reopened = new Context()
  t.after(() => reopened.fiber.dispose())
  await reopened.plugin(Outputs)
  await reopened.plugin(Parse)
  await reopened.plugin(TxtSource)
  await reopened.plugin(Storage)
  await reopened.plugin(StorageSqlite, { path: f.store })
  await reopened.plugin(StorageDomain, { backend: 'sqlite' })
  await reopened.plugin(Records)
  await reopened.get('ivoraige.records').ready
  await reopened.plugin(JobsLocal, { maxConcurrentJobsPerOwner: 1 })
  await reopened.plugin(Tasks)
  await reopened.get('ivoraige.tasks').ready
  assert.equal(reopened.get('ivoraige.records').getTask(f.taskId).state, 'paused')
  await reopened.fiber.dispose()
})

test('task plugin unload aborts work and detaches its controller', async t => {
  const f = await fixture(t)
  const waiting = assert.rejects(f.tasks.wait(f.taskId), { code: 'PRECONDITION_FAILED' })
  await f.tasksFiber.dispose()
  await waiting
  assert.equal(aborts, 1)
  assert.equal(f.records.getTask(f.taskId).state, 'running')
  assert.equal(f.tasks.jobs.servesOwner(undefined), false)
  await f.tasks.shutdown()
  assert.equal(aborts, 1)
  const remounted = f.ctx.plugin(Tasks)
  await remounted
  await f.ctx.get('ivoraige.tasks').ready
  assert.equal(f.records.getTask(f.taskId).state, 'paused')
})

test('records plugin unload waits for dependent tasks before closing its domain', async t => {
  const f = await fixture(t)
  const diagnostics = []
  const originalError = console.error
  console.error = (...parts) => { diagnostics.push(parts.join(' ')) }
  try { await f.recordsFiber.dispose() } finally { console.error = originalError }
  assert.equal(aborts, 1)
  assert.equal(f.records.domain.closed, true)
  assert.deepEqual(diagnostics, [])
})

test('concurrent explicit close and root disposal both join the live worker', async t => {
  const f = await fixture(t)
  const closing = f.tasks.close()
  await f.ctx.fiber.dispose()
  await closing
  assert.equal(aborts, 1)
  assert.equal(f.tasks.running, null)
  assert.equal(f.tasks.jobs.servesOwner(undefined), false)
})

test('explicit close pauses work and repeated calls share the drain', async t => {
  const f = await fixture(t)
  await Promise.all([f.tasks.close(), f.tasks.close()])
  assert.equal(aborts, 1)
  assert.equal(f.records.getTask(f.taskId).state, 'paused')
  assert.equal(f.tasks.jobs.servesOwner(undefined), false)
})
