import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, startHost } from '../src/app.mjs'
import { attachHost } from '../src/host-bootstrap.mjs'

async function resident(t) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'iv-h-'))
  let app
  t.after(async () => { await app?.dispose(); await rm(root, { recursive: true, force: true }) })
  const options = { store: join(root, 'db'), registryRoot: join(root, 'r') }
  try { app = await startHost(options) }
  catch (error) {
    if (!process.env.CI && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('Local sandbox does not permit owner IPC listening'); return null
    }
    throw error
  }
  return { app, options }
}

test('repeated start attaches same owner; MCP bridge and client close preserve ownership', async t => {
  const f = await resident(t)
  if (!f) return
  const { app, options } = f
  const joined = await startHost(options)
  assert.equal(joined.reused, true)
  assert.equal(joined.generation, app.generation)
  assert.equal(joined.ctx, undefined)
  const registry = await joined.client.request('mcp.describe')
  assert.ok(registry.tools.length > 0)
  assert.ok(registry.tools.every(tool => tool.inputSchema.type === 'object'))
  assert.ok(registry.tools.every(tool => !/host.*(exit|drain)/i.test(tool.name)))
  const documents = await joined.operations.invoke('listDocuments', {})
  assert.deepEqual(documents, await app.operations.invoke('listDocuments', {}))
  await joined.dispose()
  assert.equal(app.host.closed, false)
  assert.equal(app.host.control.state().storeOwnership, 'held')
  await assert.rejects(createApp(options), { code: 'CONFLICT' })
  await assert.rejects(startHost({ ...options, exportDir: join(options.registryRoot, 'different') }),
    error => error.details?.reason === 'owner-config-mismatch')
  await app.dispose()
  const next = await createApp(options)
  assert.notEqual(next.generation, app.generation)
  assert.equal(next.dataDomainRef, app.dataDomainRef)
  await next.dispose()
})

test('protected exit is accepted before finalization and retires the same generation', async t => {
  const f = await resident(t)
  if (!f) return
  const { app, options } = f
  const joined = await attachHost(options)
  const accepted = await joined.client.request('exit', { budgetMs: 3000 })
  assert.equal(accepted.accepted, true)
  assert.equal(accepted.generation, app.generation)
  await app.host.whenClosed
  assert.equal(app.host.control.finalizationReceipt().operationId, accepted.operationId)
  assert.equal(app.host.control.state().storeOwnership, 'released')
  await assert.rejects(joined.client.request('state'), error => error.details?.reason === 'owner-unreachable')
})
