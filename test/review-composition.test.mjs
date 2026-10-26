import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, JobsLocal, Storage, StorageDomain, StorageSqlite } from '../dist/dsh.mjs'
import { Records } from '../src/records.mjs'
import { Tasks } from '../src/tasks.mjs'
import { Importer } from '../src/import.mjs'
import { Parse } from '../src/parse.mjs'
import { Outputs } from '../src/outputs.mjs'
import { Exporter } from '../src/export.mjs'
import { OperationCatalog } from '../src/operation-catalog.mjs'
import { Operations } from '../src/operations.mjs'
import { CoreOperations } from '../src/core-operations.mjs'
import { CapabilityCatalog, CapabilityContributions } from '../src/capability-catalog.mjs'
import { EntryEvents } from '../src/entry-events.mjs'
import { installEventState } from '../src/event-state.mjs'
import { createApp } from '../src/app.mjs'
import { serve } from '../src/http.mjs'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-review-composition-'))
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(dir, { recursive: true, force: true }) })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageSqlite, { path: join(dir, 'store.sqlite') })
  await ctx.plugin(StorageDomain, { backend: 'sqlite' })
  await ctx.plugin(OperationCatalog)
  await ctx.plugin(Operations)
  await ctx.plugin(CoreOperations)
  return { ctx, dir }
}

test('revision and export requirements reject missing services before reading or creating records', async t => {
  const { ctx, dir } = await fixture(t)
  await ctx.plugin(Records, { storageVersion: 2 })
  await ctx.plugin(JobsLocal)
  await ctx.plugin(Tasks)
  const records = ctx.get('ivoraige.records')
  await records.ready
  const catalog = ctx.get('ivoraige.operationCatalog')
  const cases = [
    ['writeRevision', { unitId: 'absent', targetLang: 'zh', baseRevisionId: null, text: 'translation' }],
    ['acceptRevision', { revisionId: 'absent', expectedAcceptedRevisionId: null }],
    ['exportDocument', { docId: 'absent', contentMode: 'source', outputs: [{ format: 'md' }] }],
  ]
  for (const [id, input] of cases) {
    assert.equal(catalog.list({ availableOnly: true }).some(item => item.id === id), false, id)
    await assert.rejects(catalog.invoke(id, input), { code: 'COMPONENT_MISSING' })
  }
  assert.deepEqual(records.listTasks(), [])
  await ctx.plugin(Parse)
  assert.equal(ctx.get('ivoraige.parse'), undefined, 'Parse itself requires Outputs')
  await ctx.plugin(Outputs)
  for (const [id] of cases.slice(0, 2)) assert.ok(catalog.list({ availableOnly: true }).some(item => item.id === id))
  assert.equal(catalog.list({ availableOnly: true }).some(item => item.id === 'exportDocument'), false)
  await ctx.plugin(Exporter, { root: join(dir, 'exports') })
  assert.ok(catalog.list({ availableOnly: true }).some(item => item.id === 'exportDocument'))
})

test('HTTP and MCP capabilities share export availability and reject admission without Exporter', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-review-discovery-'))
  const app = await createApp()
  t.after(async () => { await app.dispose(); await rm(dir, { recursive: true, force: true }) })
  const { ctx } = app
  await ctx.plugin(Storage)
  await ctx.plugin(StorageSqlite, { path: join(dir, 'store.sqlite') })
  await ctx.plugin(StorageDomain, { backend: 'sqlite' })
  await ctx.plugin(Records, { storageVersion: 2 })
  await ctx.plugin(JobsLocal)
  await ctx.plugin(Tasks)
  const records = ctx.get('ivoraige.records')
  await records.ready
  await ctx.plugin(Importer)
  const { document } = await records.importDocument({ format: 'txt', content: 'Synthetic source.' }, { language: 'en' })
  const server = await serve(app, { port: 0 })
  const exporter = () => ctx.plugin(Exporter, { root: join(dir, 'exports') })
  const check = async expected => {
    const http = await (await fetch(server.url + '/api/operations')).json()
    const capabilities = await app.operations.invoke('capabilities')
    const mcp = await app.mcp.tools.get('ivoraige_capabilities').invoke({}, {})
    for (const view of [http, capabilities, mcp])
      assert.equal(view.operations.find(item => item.id === 'exportDocument').available, expected)
  }
  await check(false)
  const input = { docId: document.id, contentMode: 'source', outputs: [{ format: 'md' }] }
  await assert.rejects(app.mcp.tools.get('ivoraige_export').invoke(input, {}), { code: 'COMPONENT_MISSING' })
  const rejected = await fetch(server.url + '/api/operations/exportDocument', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  })
  assert.equal(rejected.status, 503)
  assert.deepEqual(records.listTasks(), [])
  assert.deepEqual(records.listSnapshots(document.id), [])
  const fiber = exporter()
  await fiber
  await check(true)
  await fiber.dispose()
  await check(false)
})

test('late Records mount and withdrawal invalidate subscribed capability state', async t => {
  const { ctx } = await fixture(t)
  await ctx.plugin(CapabilityCatalog)
  await ctx.plugin(CapabilityContributions)
  await ctx.plugin(EntryEvents)
  const dispose = installEventState(ctx)
  t.after(dispose)
  const session = ctx.get('ivoraige.events').subscribe()
  const available = snapshot => snapshot.state.capabilities.capabilities.find(item => item.id === 'records').available
  const before = session.snapshot()
  assert.equal(available(before), false)
  session.acknowledge(before.stateRevision)
  const fiber = ctx.plugin(Records, { storageVersion: 2 })
  await fiber
  await ctx.get('ivoraige.records').ready
  const mounted = session.snapshot()
  assert.equal(available(mounted), true)
  assert.ok(mounted.stateRevision > before.stateRevision)
  assert.ok(session.drain().some(notice => notice.event?.type === 'capabilities.changed'))
  session.acknowledge(mounted.stateRevision)
  await fiber.dispose()
  const withdrawn = session.snapshot()
  assert.equal(available(withdrawn), false)
  assert.ok(withdrawn.stateRevision > mounted.stateRevision)
  assert.ok(session.drain().some(notice => notice.event?.type === 'capabilities.changed'))
})
