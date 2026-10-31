import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JobsLocal, Storage, StorageDomain, StorageSqlite } from '../dist/dsh.mjs'
import { createApp } from '../src/app.mjs'
import { Records } from '../src/records.mjs'
import { Importer } from '../src/import.mjs'
import { Tasks } from '../src/tasks.mjs'
import { serve } from '../src/http.mjs'

async function fixture(t, late) {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-late-task-'))
  const store = join(directory, 'records.sqlite')
  const app = await createApp({ ...(late ? {} : { store }), events: false, mcp: false })
  const f = { app, directory, store, release() {} }
  t.after(async () => {
    f.release()
    await app.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  f.server = await serve(app, { port: 0 })
  return f
}

async function mountRecords(f) {
  const { ctx } = f.app
  await ctx.plugin(Storage)
  await ctx.plugin(StorageSqlite, { path: f.store })
  await ctx.plugin(StorageDomain, { backend: 'sqlite' })
  await ctx.plugin(Records, { storageVersion: 2 })
  await ctx.get('ivoraige.records').ready
}

async function mountTasks(f) {
  const { ctx } = f.app
  await ctx.plugin(Importer)
  await ctx.plugin(JobsLocal, { maxConcurrentJobsPerOwner: 1 })
  await ctx.plugin(Tasks)
  await ctx.get('ivoraige.tasks').ready
}

async function heldImport(f) {
  let entered, release
  const started = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  f.release = release
  f.app.parse.register({ id: 'held', version: '1', formats: ['held'],
    inputKinds: ['text'], importMode: 'queued', match: file => file.format === 'held' ? 1 : 0,
    async parse(file) {
      entered()
      await gate
      file.signal?.throwIfAborted()
      return { format: 'held', title: 'Synthetic held import', chapters: [], resources: [],
        units: [{ order: 0, kind: 'body', sourceText: file.content, translatable: true }],
        sourceBinding: { adapterId: 'held' } }
    } })
  const { taskId } = await f.app.operations.invoke('importDocument', { format: 'held', language: 'en',
    contentBase64: Buffer.from('Synthetic source').toString('base64') })
  await started
  return taskId
}

test('task discovery and missing-service errors remain accurate before and between late mounts', async t => {
  const f = await fixture(t, true)
  const { operations, operationCatalog } = f.app
  const available = id => operationCatalog.list({ availableOnly: true }).some(item => item.id === id)
  assert.equal(available('listTasks'), false)
  assert.equal(available('getTask'), false)
  for (const [name, input] of [['listTasks', {}], ['getTask', { taskId: 'not-found' }]])
    await assert.rejects(operations.invoke(name, input), { code: 'COMPONENT_MISSING' })
  await assert.rejects(operations.waitTask('not-found', 0), { code: 'COMPONENT_MISSING' })
  await mountRecords(f)
  assert.equal(available('listTasks'), true)
  assert.equal(available('getTask'), false)
  assert.deepEqual((await operations.invoke('listTasks')).items, [])
  await assert.rejects(operations.invoke('getTask', { taskId: 'not-found' }), { code: 'COMPONENT_MISSING' })
  await mountTasks(f)
  assert.equal(available('getTask'), true)
  await assert.rejects(operations.invoke('getTask', { taskId: 'not-found' }), { code: 'NOT_FOUND' })
})

for (const late of [true, false]) {
  const order = late ? 'Operations before Records/Tasks' : 'default createApp order'
  test(`immediate task reads use the installed Records service: ${order}`, async t => {
    const f = await fixture(t, late)
    if (late) { await mountRecords(f); await mountTasks(f) }
    const taskId = await heldImport(f)
    const listed = await f.app.operations.invoke('listTasks')
    assert.ok(listed.items.some(item => item.id === taskId && item.state === 'running'))
    const response = await fetch(`${f.server.url}/api/tasks/${encodeURIComponent(taskId)}`)
    const body = await response.json()
    assert.equal(response.status, 200, JSON.stringify(body))
    assert.equal(body.task.id, taskId)
    assert.equal(body.task.state, 'running')
    assert.equal((await f.app.operations.waitTask(taskId, 0)).state, 'running')
    f.release()
    await f.app.ctx.get('ivoraige.tasks').wait(taskId)
    assert.equal((await f.app.operations.invoke('getTask', { taskId })).task.state, 'succeeded')
  })

  test(`task waits observe terminal state and release listeners: ${order}`, async t => {
    const f = await fixture(t, late)
    if (late) { await mountRecords(f); await mountTasks(f) }
    const taskId = await heldImport(f)
    const tasks = f.app.ctx.get('ivoraige.tasks')
    const before = tasks.listeners.size
    const subscribe = tasks.subscribe.bind(tasks)
    let signalSubscribed
    const subscribed = new Promise(resolve => { signalSubscribed = resolve })
    tasks.subscribe = listener => { const dispose = subscribe(listener); signalSubscribed(); return dispose }
    const waiting = fetch(`${f.server.url}/api/tasks/${encodeURIComponent(taskId)}?waitSeconds=2`)
    const registered = await Promise.race([subscribed.then(() => ({ subscribed: true })),
      waiting.then(response => ({ response }))])
    if (!registered.subscribed) {
      const body = await registered.response.json()
      assert.fail(`Wait returned before subscription: ${registered.response.status} ${JSON.stringify(body)}`)
    }
    assert.equal(tasks.listeners.size, before + 1)
    f.release()
    const response = await waiting
    const body = await response.json()
    assert.equal(response.status, 200, JSON.stringify(body))
    assert.equal(body.task.id, taskId)
    assert.equal(body.task.state, 'succeeded')
    assert.equal(tasks.listeners.size, before)
    assert.equal(f.app.operationCatalog.active.size, 0)
  })
}
