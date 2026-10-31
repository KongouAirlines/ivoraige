import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { createApp } from '../src/app.mjs'
import { createMcpServer, createMcpHttp } from '../src/mcp.mjs'

const gate = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

for (const factory of [createMcpServer, createMcpHttp]) {
  test(`${factory.name} rejects a closing entry before subscribing`, async t => {
    const app = await createApp()
    const entry = app.ctx.get('ivoraige.mcpEntry')
    const closing = gate()
    entry.own(() => closing.promise)
    const closed = entry.close()
    t.after(async () => { closing.resolve(); await closed; await app.dispose() })
    const subscribe = t.mock.method(app.mcp, 'subscribe')
    const listeners = app.mcp.listeners.size
    assert.throws(() => factory(app), { code: 'COMPONENT_MISSING' })
    assert.equal(subscribe.mock.callCount(), 0)
    assert.equal(app.mcp.listeners.size, listeners)
    assert.equal(entry.handles.size, 1)
  })
}

test('MCP entry drains every handle before reporting the first close failure', async t => {
  const app = await createApp()
  const entry = app.ctx.get('ivoraige.mcpEntry')
  const closing = gate()
  t.after(async () => { closing.resolve(); await app.dispose() })
  const failure = new Error('first close failed')
  let slowFinished = false, settled = false
  entry.own(() => { throw failure })
  entry.own(async () => { await closing.promise; slowFinished = true })
  entry.own(async () => { throw new Error('second close failed') })
  const closed = entry.close().then(() => { settled = true }, error => { settled = true; return error })
  await setImmediate()
  assert.equal(settled, false)
  assert.equal(slowFinished, false)
  closing.resolve()
  assert.equal(await closed, failure)
  assert.equal(slowFinished, true)
  assert.equal(entry.handles.size, 0)
  await entry.close()
})

test('app disposal keeps dependencies until the remaining MCP handle has closed', async t => {
  const app = await createApp()
  const entry = app.ctx.get('ivoraige.mcpEntry')
  const closing = gate()
  t.after(async () => { closing.resolve(); await app.dispose().catch(() => {}) })
  const failure = new Error('MCP close failed')
  entry.own(async () => { throw failure })
  entry.own(() => closing.promise)
  const catalogClose = t.mock.method(app.operationCatalog, 'close')
  const disposed = app.dispose().catch(error => error)
  await setImmediate()
  assert.equal(catalogClose.mock.callCount(), 0)
  closing.resolve()
  assert.equal(await disposed, failure)
  assert.ok(catalogClose.mock.callCount() > 0)
  assert.equal(entry.handles.size, 0)
})
