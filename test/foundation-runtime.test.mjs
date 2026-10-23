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
  app.records.updateTask = async (...args) => {
    const result = await update(...args)
    if (app.tasks.quotaBlocked && result.state === 'queued') blocked.resolve()
    return result
  }
  const installation = app.components.install()
  const business = await app.tasks.submit(document.id, { targetLang: 'zh' })
  await blocked.promise
  assert.equal((await app.tasks.get(business.taskId)).state, 'queued')
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
