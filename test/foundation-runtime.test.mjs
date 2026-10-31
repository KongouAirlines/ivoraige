import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '../dist/dsh.mjs'
import { createApp } from '../src/app.mjs'
import { Operations } from '../src/operations.mjs'
import { waitForJob } from '../src/job-wait.mjs'

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('shutdown cleans the job when dispatch settlement waiting times out', { timeout: 10_000 }, async t => {
  const root = await directory(t)
  const app = await createApp({ store: join(root, 'records.sqlite') })
  t.after(async () => { await app.dispose(); await rm(root, { recursive: true, force: true }) })
  const { document } = await app.records.importDocument({ format: 'txt', content: 'Source.' },
    { sourceId: 'shutdown-wait-timeout', language: 'en' })
  const jobs = app.ctx.get('jobs')
  const waiting = deferred()
  jobs.wait = () => { waiting.resolve(); return new Promise(() => {}) }
  app.tasks.jobWaitTimeoutMs = 30
  app.tasks.run = async live => {
    await app.records.updateTask(live.taskId, task => ({ ...task, state: 'succeeded' }))
  }
  const { taskId } = await app.tasks.submit(document.id, { targetLang: 'zh' })
  await waiting.promise
  await app.tasks.shutdown()
  assert.equal((await app.tasks.get(taskId)).state, 'succeeded')
  assert.deepEqual(jobs.list(), [])
  assert.equal(jobs.hub.unscoped.size, 0)
})
async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-foundation-0.1.x-'))
  return root
}

test('empty Cordis host and parser composition activate only selected services', async () => {
  const ctx = new Context()
  assert.equal(ctx.get('jobs'), undefined)
  assert.equal(ctx.get('llm'), undefined)
  await ctx.fiber.dispose()
  const app = await createApp()
  assert.deepEqual(app.parse.listAdapters(), ['txt', 'markdown'])
  for (const service of ['jobs', 'storageDomain', 'llm', 'ivoraige.translationModel', 'ivoraige.records']) {
    assert.equal(app.ctx.get(service), undefined, service)
  }
  await app.dispose()
  assert.equal(app.ctx.get('ivoraige.parse'), undefined)
})

test('records provider withdrawal awaits an asynchronous injected consumer before closing storage', { timeout: 10_000 }, async t => {
  const root = await directory(t)
  const app = await createApp({ store: join(root, 'records.sqlite') })
  t.after(async () => { await app.dispose(); await rm(root, { recursive: true, force: true }) })
  const entered = deferred(), release = deferred()
  const records = app.records
  class Consumer extends Service {
    static inject = ['ivoraige.records']
    constructor(ctx) {
      super(ctx, 'foundation.consumer')
      assert.equal(records.domain.closed, false)
      ctx.effect(() => async () => {
        entered.resolve()
        assert.equal(records.domain.closed, false)
        await release.promise
        assert.equal(records.domain.closed, false)
        records.listDocuments()
      })
    }
  }
  await app.ctx.plugin(Consumer)
  const closing = app.ctx.fiber.dispose()
  await entered.promise
  assert.equal(records.domain.closed, false)
  release.resolve()
  await closing
  assert.equal(records.domain.closed, true)
  assert.equal(app.ctx.get('foundation.consumer'), undefined)
})

test('failure after task activation drains consumers and releases the store for reopening', async t => {
  const root = await directory(t)
  const store = join(root, 'records.sqlite')
  const init = Operations.prototype[Service.init]
  const failure = new Error('foundation partial activation')
  let failedContext, tasksClosed = false
  Operations.prototype[Service.init] = function () {
    failedContext = this.ctx
    const tasks = this.ctx.get('ivoraige.tasks')
    const close = tasks.close.bind(tasks)
    tasks.close = async () => { await close(); tasksClosed = true }
    throw failure
  }
  try { await assert.rejects(createApp({ store }), error => error === failure) }
  finally {
    if (init === undefined) delete Operations.prototype[Service.init]
    else Operations.prototype[Service.init] = init
  }
  assert.equal(tasksClosed, true)
  assert.equal(failedContext.get('ivoraige.records'), undefined)
  const reopened = await createApp({ store })
  await reopened.dispose()
  await rm(root, { recursive: true, force: true })
})

test('component and business work share the pinned unowned quota without reporting model failure', { timeout: 10_000 }, async t => {
  const root = await directory(t)
  const app = await createApp({ store: join(root, 'records.sqlite'), settingsDir: join(root, 'settings'),
    components: { directory: join(root, 'components') } })
  const install = deferred(), model = deferred(), modelEntered = deferred(), blocked = deferred()
  t.after(async () => { install.resolve(); model.resolve(); await app.dispose(); await rm(root, { recursive: true, force: true }) })
  app.components.performInstall = async () => { await install.promise; return { restartRequired: false } }
  let calls = 0
  const translation = app.ctx.get('ivoraige.translationModel')
  translation.preflight = async () => {}
  translation.translate = async () => { calls++; modelEntered.resolve(); await model.promise; return { text: '译文' } }
  const { document } = await app.records.importDocument({ format: 'txt', content: 'Source.' },
    { sourceId: 'quota', language: 'en' })
  const update = app.records.updateTask.bind(app.records)
  const events = []
  app.tasks.subscribe(event => { if (event.data?.taskId === businessId) events.push(event) })
  let businessId
  app.records.updateTask = async (...args) => {
    const result = await update(...args)
    if (app.tasks.quotaBlocked && result.state === 'queued') blocked.resolve()
    return result
  }
  const installation = app.components.install()
  const business = await app.tasks.submit(document.id, { targetLang: 'zh' })
  businessId = business.taskId
  await blocked.promise
  assert.equal((await app.tasks.get(business.taskId)).state, 'queued')
  assert.equal((await app.tasks.get(business.taskId)).progress.stage, 'translate')
  assert.ok(events.some(event => event.type === 'task.queued'))
  assert.ok(events.some(event => event.type === 'task.progress' && event.data.stage === 'translate'))
  assert.equal((await app.tasks.get(business.taskId)).stats.llmCalls, 0)
  assert.equal(calls, 0)
  install.resolve()
  await waitForJob(app.ctx.get('jobs'), installation.taskId)
  await modelEntered.promise
  assert.throws(() => app.components.install(), { code: 'CONFLICT' })
  const finished = app.tasks.running.finished
  model.resolve()
  assert.equal((await app.tasks.wait(business.taskId)).state, 'succeeded')
  await finished
  assert.equal(calls, 1)
  const next = app.components.install()
  assert.equal((await waitForJob(app.ctx.get('jobs'), next.taskId)).status, 'completed')
})

test('job waits have one total deadline for nonterminal and unresponsive providers', async () => {
  for (const wait of [async () => ({ status: 'running' }), () => new Promise(() => {})]) {
    const started = performance.now()
    await assert.rejects(waitForJob({ wait }, 'held-job', 30), { code: 'UPSTREAM_FAILURE' })
    assert.ok(performance.now() - started < 2000)
  }
  assert.equal((await waitForJob({ wait: async () => ({ status: 'completed' }) }, 'done', 30)).status, 'completed')
})

test('job wait timeout preserves a completed task and removes its settled DSH job', { timeout: 10_000 }, async t => {
  const root = await directory(t)
  const app = await createApp({ store: join(root, 'records.sqlite') })
  t.after(async () => { await app.dispose(); await rm(root, { recursive: true, force: true }) })
  class FixedModel extends Service {
    constructor(ctx) { super(ctx, 'ivoraige.translationModel') }
    async translate() { return { text: 'translated' } }
  }
  await app.ctx.plugin(FixedModel)
  const { document } = await app.records.importDocument({ format: 'txt', content: 'Source.' },
    { sourceId: 'job-timeout-success', language: 'en' })
  const jobs = app.ctx.get('jobs')
  const wait = jobs.wait.bind(jobs)
  jobs.wait = () => new Promise(() => {})
  app.tasks.jobWaitTimeoutMs = 30
  const { taskId } = await app.tasks.submit(document.id, { targetLang: 'zh' })
  const finished = app.tasks.running.finished
  assert.equal((await app.tasks.wait(taskId)).state, 'succeeded')
  await finished
  jobs.wait = wait
  assert.equal((await app.tasks.get(taskId)).state, 'succeeded')
  assert.equal(jobs.list().length, 0)
})

test('job wait timeout fails an active task and removes its settled DSH job', { timeout: 10_000 }, async t => {
  const root = await directory(t)
  const app = await createApp({ store: join(root, 'records.sqlite') })
  t.after(async () => { await app.dispose(); await rm(root, { recursive: true, force: true }) })
  const { document } = await app.records.importDocument({ format: 'txt', content: 'Source.' },
    { sourceId: 'job-timeout-active', language: 'en' })
  const jobs = app.ctx.get('jobs')
  const wait = jobs.wait.bind(jobs)
  jobs.wait = () => new Promise(() => {})
  app.tasks.jobWaitTimeoutMs = 30
  app.tasks.run = async () => {} // Simulate a producer that returns without settling its business task.
  const { taskId } = await app.tasks.submit(document.id, { targetLang: 'zh' })
  const failed = await app.tasks.wait(taskId)
  jobs.wait = wait
  assert.equal(failed.state, 'failed')
  assert.equal(failed.error.stage, 'translate')
  assert.equal(jobs.list().length, 0)
})

test('a stopping DSH job is removed only after its producer settles', { timeout: 10_000 }, async t => {
  const root = await directory(t)
  const app = await createApp({ store: join(root, 'records.sqlite') })
  t.after(async () => { await app.dispose(); await rm(root, { recursive: true, force: true }) })
  const jobs = app.ctx.get('jobs')
  const producer = deferred()
  const jobId = jobs.start({ kind: 'stalled-business', label: 'Stalled business job',
    run: () => ({ done: producer.promise, cancel: () => {} }) })
  app.tasks.cleanupJob(jobId)
  assert.equal(jobs.get(jobId).status, 'stopping')
  assert.equal(jobs.hub.unscoped.size, 2)
  producer.resolve({ status: 'killed' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(jobs.hub.unscoped.size, 1)
  assert.equal(jobs.list().length, 0)
})

test('close and teardown remove an already stopping job after later DSH settlement', { timeout: 10_000 }, async t => {
  for (const action of ['close', 'shutdown']) await t.test(action, async t => {
    const root = await directory(t)
    const app = await createApp({ store: join(root, 'records.sqlite') })
    t.after(async () => { await app.dispose(); await rm(root, { recursive: true, force: true }) })
    const jobs = app.ctx.get('jobs')
    const producer = deferred()
    const jobId = jobs.start({ kind: 'closing-business', label: 'Closing business job',
      run: () => ({ done: producer.promise, cancel: () => {} }) })
    app.tasks.cleanupJob(jobId)
    await app.tasks[action]()
    assert.equal(jobs.get(jobId).status, 'stopping')
    producer.resolve({ status: 'killed' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(jobs.list().length, 0)
    assert.equal(jobs.hub.unscoped.size, 0)
  })
})

test('pause, cancel and close win a race with saturated job admission', { timeout: 10_000 }, async t => {
  for (const action of ['pause', 'cancel', 'close']) await t.test(action, async t => {
    const root = await directory(t)
    const app = await createApp({ store: join(root, 'records.sqlite') })
    const entered = deferred(), release = deferred(), installation = deferred()
    t.after(async () => {
      release.resolve(); installation.resolve({ status: 'completed' })
      await app.dispose(); await rm(root, { recursive: true, force: true })
    })
    const jobs = app.ctx.get('jobs')
    jobs.start({ kind: 'component-install', label: 'Held install',
      run: () => ({ done: installation.promise, cancel: () => installation.resolve({ status: 'killed' }) }) })
    const { document } = await app.records.importDocument({ format: 'txt', content: 'Source.' },
      { sourceId: action, language: 'en' })
    const update = app.records.updateTask.bind(app.records)
    app.records.updateTask = async (...args) => {
      const result = await update(...args)
      if (result.state === 'running') { entered.resolve(); await release.promise }
      return result
    }
    const { taskId } = await app.tasks.submit(document.id, { targetLang: 'zh' })
    await entered.promise
    const changing = action === 'close' ? app.tasks.close() : app.tasks[action](taskId)
    // pause/cancel first read the task through ready's continuation.
    await Promise.resolve()
    release.resolve()
    await changing
    assert.equal((await app.tasks.get(taskId)).state, action === 'cancel' ? 'canceled' : 'paused')
    assert.equal((await app.tasks.get(taskId)).stats.llmCalls, 0)
    assert.equal(app.tasks.queue.includes(taskId), false)
  })
})

test('control intent survives the in-flight quota deferral write', { timeout: 10_000 }, async t => {
  for (const action of ['pause', 'cancel', 'close']) await t.test(action, async t => {
    const root = await directory(t)
    const app = await createApp({ store: join(root, 'records.sqlite') })
    const entered = deferred(), release = deferred(), installation = deferred()
    t.after(async () => {
      release.resolve(); installation.resolve({ status: 'completed' })
      await app.dispose(); await rm(root, { recursive: true, force: true })
    })
    app.ctx.get('jobs').start({ kind: 'component-install', label: 'Held install',
      run: () => ({ done: installation.promise, cancel: () => installation.resolve({ status: 'killed' }) }) })
    const { document } = await app.records.importDocument({ format: 'txt', content: 'Source.' },
      { sourceId: `write-${action}`, language: 'en' })
    const update = app.records.updateTask.bind(app.records)
    app.records.updateTask = async (taskId, transform) => {
      if (!app.tasks.quotaBlocked) return update(taskId, transform)
      // Capture the transform's result while the visible record is running,
      // then defer its commit. Intent arrives after the transform read flags.
      const next = transform(app.records.getTask(taskId))
      entered.resolve()
      await release.promise
      return update(taskId, () => next)
    }
    const { taskId } = await app.tasks.submit(document.id, { targetLang: 'zh' })
    await entered.promise
    const changing = action === 'close' ? app.tasks.close() : app.tasks[action](taskId)
    await Promise.resolve()
    release.resolve()
    await changing
    assert.equal((await app.tasks.get(taskId)).state, action === 'cancel' ? 'canceled' : 'paused')
    assert.equal((await app.tasks.get(taskId)).stats.llmCalls, 0)
    assert.equal(app.tasks.queue.includes(taskId), false)
  })
})

test('canceling an import before quota admission releases its buffered source', { timeout: 20_000 }, async t => {
  for (const phase of ['running', 'quota-write']) for (const action of ['cancel', 'close']) {
    await t.test(`${phase}: ${action}`, async t => {
      const root = await directory(t)
      const app = await createApp({ store: join(root, 'records.sqlite'), settingsDir: join(root, 'settings'),
        components: { directory: join(root, 'components') } })
      const entered = deferred(), release = deferred(), installation = deferred()
      t.after(async () => {
        release.resolve(); installation.resolve()
        await app.dispose(); await rm(root, { recursive: true, force: true })
      })
      app.components.performInstall = async () => { await installation.promise; return { restartRequired: false } }
      app.components.install()
      const update = app.records.updateTask.bind(app.records)
      app.records.updateTask = async (taskId, transform) => {
        if (phase === 'quota-write' && app.tasks.quotaBlocked) {
          const next = transform(app.records.getTask(taskId))
          if (next.state === 'queued') { entered.resolve(); await release.promise }
          return update(taskId, () => next)
        }
        const next = await update(taskId, transform)
        if (phase === 'running' && next.state === 'running') { entered.resolve(); await release.promise }
        return next
      }
      const { taskId } = await app.tasks.importDocument({ format: 'txt', content: 'x'.repeat(1024 * 1024) },
        { sourceId: `${phase}-${action}`, language: 'en' }, { wait: false })
      await entered.promise
      assert.equal(app.tasks.running.jobId, null)
      assert.equal(app.tasks.pendingImports.get(taskId).file.content.length, 1024 * 1024)
      const changing = action === 'close' ? app.tasks.close() : app.tasks.cancel(taskId)
      await Promise.resolve()
      release.resolve()
      await changing
      assert.equal((await app.tasks.get(taskId)).state, 'canceled')
      assert.equal(app.tasks.queue.includes(taskId), false)
      assert.equal(app.tasks.pendingImports.has(taskId), false)
      assert.equal(app.records.listDocuments().length, 0)
      assert.equal((await app.tasks.get(taskId)).stats.llmCalls, 0)
    })
  }
})
