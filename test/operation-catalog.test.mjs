import test from 'node:test'
import assert from 'node:assert/strict'
import { Context, z } from '../dist/dsh.mjs'
import { OperationCatalog } from '../src/operation-catalog.mjs'
import { Operations } from '../src/operations.mjs'
import { CoreOperations } from '../src/core-operations.mjs'
import { SettingsPages } from '../src/settings-pages.mjs'
import { Parse } from '../src/parse.mjs'
import { Outputs } from '../src/outputs.mjs'
import { TxtSource } from '../src/adapters/txt-source.mjs'
import { McpRegistry } from '../src/mcp-registry.mjs'
import { OperationTools } from '../src/mcp-tools.mjs'
import { createApp } from '../src/app.mjs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('catalog registers one schema and handler, delegates through the facade, and disposes', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(OperationCatalog)
  await ctx.plugin(Operations)
  const catalog = ctx.get('ivoraige.operationCatalog')
  const operations = ctx.get('ivoraige.operations')
  let changes = 0
  const unsubscribe = catalog.subscribeChanges(() => { changes++ })
  const dispose = catalog.register({ id: 'echo', inputSchema: z.object({ text: z.string() }).strict(),
    resultSchema: z.object({ value: z.string() }).strict(), handler: p => ({ value: p.text }) })
  assert.equal(catalog.get('echo').id, 'echo')
  assert.deepEqual(await operations.invoke('echo', { text: 'hello' }), { apiVersion: '2.0', value: 'hello' })
  await assert.rejects(operations.invoke('echo', { text: 4 }), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(operations.invoke('other'), { code: 'NOT_FOUND' })
  await dispose()
  assert.equal(changes, 2)
  await assert.rejects(operations.invoke('echo'), { code: 'NOT_FOUND' })
  unsubscribe()
})

test('missing known capability remains discoverable and reports COMPONENT_MISSING', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(OperationCatalog)
  await ctx.plugin(Operations)
  await ctx.plugin(CoreOperations)
  const catalog = ctx.get('ivoraige.operationCatalog')
  assert.ok(catalog.list().some(item => item.id === 'getSettings'))
  assert.ok(!catalog.list({ availableOnly: true }).some(item => item.id === 'getSettings'))
  await assert.rejects(ctx.get('ivoraige.operations').invoke('getSettings'), { code: 'COMPONENT_MISSING' })
})

test('parse-only composition reports real capabilities without Records or Tasks', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SettingsPages)
  await ctx.plugin(Outputs)
  await ctx.plugin(Parse)
  await ctx.plugin(TxtSource)
  await ctx.plugin(OperationCatalog)
  await ctx.plugin(Operations)
  await ctx.plugin(CoreOperations)
  const result = await ctx.get('ivoraige.operations').invoke('capabilities')
  assert.deepEqual(result.features, [])
  assert.ok(result.inputFormats.includes('txt'))
  assert.ok(!result.features.includes('documents'))
  assert.ok(!result.features.includes('tasks'))
})

test('settings-only app exposes settings operations without a task service', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-operation-settings-only-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const app = await createApp({ settingsDir: join(directory, 'settings'), mcp: false })
  t.after(() => app.dispose())
  assert.equal(app.tasks, undefined)
  const result = await app.operations.invoke('getSettings')
  assert.ok(result.settings.revisions)
  const capabilities = await app.operations.invoke('capabilities')
  assert.ok(capabilities.features.includes('settings'))
  assert.ok(!capabilities.features.includes('documents'))
})

test('catalog drains active handlers and keeps a timed-out close retryable', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(OperationCatalog, { drainTimeoutMs: 15 })
  const catalog = ctx.get('ivoraige.operationCatalog')
  let release, entered
  const running = new Promise(resolve => { entered = resolve })
  catalog.register({ id: 'held', inputSchema: z.object({}).strict(),
    resultSchema: z.object({ ok: z.boolean() }).strict(),
    handler: async () => { entered(); await new Promise(resolve => { release = resolve }); return { ok: true } } })
  const call = catalog.invoke('held')
  await running
  await assert.rejects(catalog.close(), { code: 'PRECONDITION_FAILED' })
  await assert.rejects(catalog.invoke('held'), { code: 'PRECONDITION_FAILED' })
  release()
  await assert.doesNotReject(call)
  await catalog.close()
  assert.equal(catalog.active.size, 0)
})

test('invalid results remain internal failures and cannot leak non-JSON values', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(OperationCatalog)
  const catalog = ctx.get('ivoraige.operationCatalog')
  const inputSchema = z.object({}).strict()
  const resultSchema = z.object({ value: z.string() }).strict()
  catalog.register({ id: 'badResult', inputSchema, resultSchema, handler: () => ({ value: 2 }) })
  catalog.register({ id: 'badData', inputSchema, resultSchema, handler: () => ({ value: () => 2 }) })
  await assert.rejects(catalog.invoke('badResult'), { code: 'INTERNAL' })
  await assert.rejects(catalog.invoke('badData'), { code: 'INTERNAL' })
  catalog.register({ id: 'accessor', inputSchema, resultSchema,
    handler: () => Object.defineProperty({}, 'value', { enumerable: true, get() { throw Error('getter ran') } }) })
  await assert.rejects(catalog.invoke('accessor'), error =>
    error.code === 'INTERNAL' && error.message !== 'getter ran')
})

test('close and owner disposal cannot start a handler after an awaited preflight', async t => {
  for (const stop of ['close', 'unregister']) {
    const ctx = new Context()
    t.after(() => ctx.fiber.dispose())
    await ctx.plugin(OperationCatalog)
    const catalog = ctx.get('ivoraige.operationCatalog')
    let entered, release
    const gate = new Promise(resolve => { release = resolve })
    const started = new Promise(resolve => { entered = resolve })
    let handled = false
    const dispose = catalog.register({ id: 'gated', inputSchema: z.object({}).strict(),
      resultSchema: z.object({ ok: z.boolean() }).strict(), preflight: async () => { entered(); await gate },
      handler: () => { handled = true; return { ok: true } } })
    const call = catalog.invoke('gated')
    await started
    const teardown = stop === 'close' ? catalog.close() : dispose()
    release()
    await assert.rejects(call, { code: 'PRECONDITION_FAILED' })
    await teardown
    assert.equal(handled, false)
  }
})

test('MCP tool discovery follows one catalog registration and disposer', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(OperationCatalog)
  await ctx.plugin(Operations)
  await ctx.plugin(McpRegistry)
  await ctx.plugin(OperationTools)
  const catalog = ctx.get('ivoraige.operationCatalog')
  const registry = ctx.get('ivoraige.mcp')
  const dispose = catalog.register({ id: 'echo', inputSchema: z.object({ text: z.string() }).strict(),
    resultSchema: z.object({ value: z.string() }).strict(), handler: p => ({ value: p.text }) })
  assert.equal(registry.tools.size, 1)
  assert.deepEqual(await registry.tools.get('ivoraige_op_echo').invoke({ text: 'hi' }, {}),
    { apiVersion: '2.0', value: 'hi' })
  await dispose()
  assert.equal(registry.tools.size, 0)
})

test('repeated owner disposal joins the same in-flight drain instead of returning early', async t => {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose())
  await ctx.plugin(OperationCatalog)
  const catalog = ctx.get('ivoraige.operationCatalog')
  let release, entered
  const pending = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  const dispose = catalog.register({ id: 'heldOwner', inputSchema: z.object({}).strict(), resultSchema: z.object({ done: z.boolean() }),
    handler: async () => { entered(); await pending; return { done: true } } })
  const call = catalog.invoke('heldOwner'); await started
  const first = dispose(), second = dispose()
  assert.equal(first, second)
  let drained = false
  second.then(() => { drained = true })
  await Promise.resolve()
  assert.equal(drained, false)
  release(); await call; await second
  assert.equal(drained, true)
})

test('core result contracts reject missing entity fields as INTERNAL without accepting an empty success', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-core-results-'))
  const app = await createApp({ store: join(dir, 'store.sqlite') })
  t.after(async () => { await app.dispose(); await rm(dir, { recursive: true, force: true }) })
  app.records.getDocument = () => undefined
  await assert.rejects(app.operations.invoke('getDocument', { docId: 'synthetic' }), { code: 'INTERNAL' })
})
