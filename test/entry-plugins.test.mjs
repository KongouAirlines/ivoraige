import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createApp } from '../src/app.mjs'
import { runCli } from '../src/cli.mjs'
import { serve } from '../src/http.mjs'
import { z } from '../dist/dsh.mjs'
import { KernelError } from '../src/errors.mjs'
import { createMcpServer } from '../src/mcp.mjs'
import { InMemoryTransport } from '@modelcontextprotocol/server'

const gate = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const output = () => { let text = ''; return { write(s) { text += s }, get text() { return text } } }
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-p04-entry-'))
  const app = await createApp({ store: join(dir, 'store.sqlite'), ...options })
  t.after(async () => { await app.dispose(); await rm(dir, { recursive: true, force: true }) })
  return { app, dir }
}
async function connection(t, url) {
  const client = new Client({ name: 'p04-entry-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url + '/mcp')))
  t.after(() => client.close())
  return client
}
async function cli(app, operation, input) {
  const stdout = output(), stderr = output()
  const code = await runCli(['--json', 'call', operation, '--set', JSON.stringify(input)], { app, stdout, stderr })
  return { code, body: JSON.parse(stdout.text) }
}

test('a contributed operation has one schema/result/error contract through CLI, HTTP and actual MCP', async t => {
  const { app } = await fixture(t)
  let calls = 0
  const unregister = app.operationCatalog.register({ id: 'probeEcho',
    inputSchema: z.object({ text: z.string(), cancel: z.boolean().optional() }).strict(),
    resultSchema: z.object({ echo: z.string() }).strict(), cancellable: 'request',
    handler: async p => { calls++; if (p.cancel) throw new KernelError('UPSTREAM_FAILURE', 'Request canceled', { canceled: true }); return { echo: p.text } } })
  t.after(unregister)
  const server = await serve(app, { port: 0 }); t.after(() => server.close())
  const client = await connection(t, server.url)
  const input = { text: 'one registered handler' }
  const a = await cli(app, 'probeEcho', input)
  const b = await (await fetch(server.url + '/api/operations/probeEcho', { method: 'POST', body: JSON.stringify(input) })).json()
  const c = (await client.callTool({ name: 'ivoraige_op_probeEcho', arguments: input })).structuredContent
  assert.equal(a.code, 0); assert.deepEqual(a.body, b); assert.deepEqual(b, c); assert.equal(calls, 3)
  for (const [value, code, exit] of [[{ text: 1 }, 'INVALID_ARGUMENT', 2], [{ text: 'cancel', cancel: true }, 'UPSTREAM_FAILURE', 5]]) {
    const a = await cli(app, 'probeEcho', value)
    const response = await fetch(server.url + '/api/operations/probeEcho', { method: 'POST', body: JSON.stringify(value) })
    const b = await response.json()
    const c = await client.callTool({ name: 'ivoraige_op_probeEcho', arguments: value })
    assert.equal(a.code, exit); assert.equal(a.body.error.code, code)
    assert.equal(b.error.code, code); assert.equal(c.structuredContent.error.code, code); assert.equal(c.isError, true)
    if (exit === 5) { assert.equal(a.body.error.details.canceled, true); assert.deepEqual(a.body, b); assert.deepEqual(b, c.structuredContent) }
  }
  await unregister()
  assert.equal((await client.listTools()).tools.some(x => x.name === 'ivoraige_op_probeEcho'), false)
  assert.equal((await cli(app, 'probeEcho', input)).body.error.code, 'NOT_FOUND')
  assert.equal((await (await fetch(server.url + '/api/operations/probeEcho', { method: 'POST', body: '{}' })).json()).error.code, 'NOT_FOUND')
})

test('events:false keeps legacy SSE and remote JSON task events while state streams are unavailable', async t => {
  const { app } = await fixture(t, { events: false })
  const server = await serve(app, { port: 0 }); t.after(() => server.close())
  const stream = await fetch(server.url + '/api/events')
  assert.equal(stream.status, 200)
  await stream.body.cancel()
  assert.equal((await fetch(server.url + '/api/events/state')).status, 503)
  const stdout = output(), stderr = output()
  const source = join((await import('node:os')).tmpdir(), `ivoraige-event-${Date.now()}.txt`)
  const { writeFile, rm } = await import('node:fs/promises')
  await writeFile(source, 'Legacy task event.')
  t.after(() => rm(source, { force: true }))
  const code = await runCli(['--url', server.url, '--json-events', 'import', source, '--source-lang', 'en'],
    { stdout, stderr })
  assert.equal(code, 0, stderr.text)
  assert.match(stdout.text, /"type":"task.succeeded"/)
})

test('remote CLI encodes opaque route IDs as one segment for task and component paths', async t => {
  const { app } = await fixture(t)
  const server = await serve(app, { port: 0 }); t.after(() => server.close())
  for (const opaque of ['a/b', 'a?b', 'a#b', 'a%b']) {
    const encoded = encodeURIComponent(opaque)
    for (const [args, path] of [
      [['task', opaque], `/api/tasks/${encoded}`],
      [['components', 'task', opaque], `/api/components/tasks/${encoded}`],
      [['documents', opaque], `/api/documents/${encoded}`],
      [['snapshots', opaque, 'target'], `/api/documents/${encoded}/snapshots/target`],
    ]) {
      const direct = await (await fetch(server.url + path)).json()
      const stdout = output(), stderr = output()
      await runCli(['--url', server.url, '--json', ...args], { stdout, stderr })
      assert.deepEqual(JSON.parse(stdout.text), direct, `${args.join(' ')} should match the exact HTTP route`)
    }
  }
})

test('HTTP disconnect cancels a request handler and application disposal stops entries before withdrawing dependencies', async t => {
  const { app } = await fixture(t)
  const entered = gate(), canceled = gate()
  app.operationCatalog.register({ id: 'probeWait', inputSchema: z.object({}).strict(), resultSchema: z.object({ ok: z.boolean() }),
    cancellable: 'request', handler: (_, { signal }) => new Promise((_, reject) => {
      const abort = () => { canceled.resolve(Boolean(app.ctx.get('ivoraige.records'))); reject(new KernelError('UPSTREAM_FAILURE', 'Canceled', { canceled: true })) }
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
      entered.resolve()
    }) })
  const server = await serve(app, { port: 0 })
  const controller = new AbortController()
  const request = fetch(server.url + '/api/operations/probeWait', { method: 'POST', body: '{}', signal: controller.signal })
  await entered.promise
  controller.abort()
  await assert.rejects(request, { name: 'AbortError' })
  assert.equal(await canceled.promise, true)
  await app.dispose()
  assert.equal(app.operationCatalog.active.size, 0)
  await assert.rejects(fetch(server.url + '/api/documents'))
})

test('entry switches leave kernel operations usable and bootstrap help does not need a host', async t => {
  const { app } = await fixture(t, { entries: { cli: false, http: false, mcp: false }, events: false })
  assert.equal((await app.operations.invoke('listDocuments')).items.length, 0)
  assert.equal(app.mcp, undefined); assert.equal(app.events, undefined)
  await assert.rejects(serve(app, { port: 0 }), { code: 'COMPONENT_MISSING' })
  const stdout = output(), stderr = output()
  assert.equal(await runCli(['--json', 'documents'], { app, stdout, stderr }), 3)
  assert.equal(JSON.parse(stdout.text).error.code, 'COMPONENT_MISSING')
  const help = output()
  assert.equal(await runCli(['help'], { stdout: help, stderr }), 0)
  assert.match(help.text, /Internal operations/)
})

test('state HTTP handshake keeps an active session through authoritative reads and closes all sessions with the entry', async t => {
  const { app } = await fixture(t)
  const server = await serve(app, { port: 0 })
  const response = await fetch(server.url + '/api/events/state')
  const reader = response.body.getReader()
  const first = new TextDecoder().decode((await reader.read()).value)
  const ready = JSON.parse(first.split('data: ')[1].trim())
  assert.match(first, /event: state.ready/)
  const session = app.events.getSession(ready.subscriptionId)
  const imported = await app.records.importDocument({ format: 'txt', content: 'State after ready.' }, { language: 'en' })
  const snapshot = await (await fetch(server.url + '/api/state?subscriptionId=' + ready.subscriptionId)).json()
  assert.equal(snapshot.generation, ready.generation)
  assert.ok(snapshot.stateRevision >= ready.barrierRevision)
  assert.ok(JSON.stringify(snapshot.state).includes(imported.document.id))
  assert.equal(JSON.stringify(snapshot.state).includes('State after ready.'), false)
  await server.close()
  assert.throws(() => app.events.getSession(ready.subscriptionId), { code: 'NOT_FOUND' })
  assert.equal(session.closed, true)
  await reader.cancel().catch(() => {})
})

test('an uncooperative MCP request reports incomplete shutdown and keeps storage available until retry', { timeout: 5000 }, async t => {
  const { app, dir } = await fixture(t)
  app.operationCatalog.drainTimeoutMs = 10
  const entered = gate(), release = gate()
  app.operationCatalog.register({ id: 'probeUncooperative', inputSchema: z.object({}).strict(), resultSchema: z.object({ ok: z.boolean() }),
    cancellable: 'request', handler: async () => { entered.resolve(); await release.promise; return { ok: true } } })
  const server = await serve(app, { port: 0 })
  const client = await connection(t, server.url)
  const pending = client.callTool({ name: 'ivoraige_op_probeUncooperative', arguments: {} }).catch(() => {})
  await entered.promise
  await assert.rejects(app.dispose(), /drain before the deadline/)
  assert.ok(app.ctx.get('ivoraige.records'))
  await assert.rejects(createApp({ store: join(dir, 'store.sqlite') }), { code: 'CONFLICT' })
  release.resolve(); await pending
  while (app.operationCatalog.active.size) await new Promise(resolve => setImmediate(resolve))
  await app.dispose()
})

test('a live MCP server keeps kernel argument errors after dynamic operation registration', async t => {
  const { app } = await fixture(t)
  const server = createMcpServer(app)
  const client = new Client({ name: 'p04-live-discovery-test', version: '1.0.0' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport); await client.connect(clientTransport)
  t.after(() => client.close())
  const unregister = app.operationCatalog.register({ id: 'probeDynamic', inputSchema: z.object({ text: z.string() }).strict(),
    resultSchema: z.object({ text: z.string() }).strict(), handler: p => p })
  t.after(unregister)
  assert.ok((await client.listTools()).tools.some(tool => tool.name === 'ivoraige_op_probeDynamic'))
  const error = await client.callTool({ name: 'ivoraige_op_probeDynamic', arguments: { text: 17 } })
  assert.equal(error.isError, true)
  assert.equal(error.structuredContent.apiVersion, '2.0')
  assert.equal(error.structuredContent.error.code, 'INVALID_ARGUMENT')
})

test('live MCP discovery keeps registered tools callable across required-service withdrawal and return', async t => {
  const { app } = await fixture(t)
  const server = createMcpServer(app)
  const client = new Client({ name: 'p04-service-availability-test', version: '1.0.0' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport); await client.connect(clientTransport)
  t.after(() => client.close())
  const tool = 'ivoraige_capabilities'
  assert.ok((await client.listTools()).tools.some(item => item.name === tool))
  assert.equal((await client.callTool({ name: tool, arguments: {} })).isError, undefined)
  const get = app.ctx.get.bind(app.ctx)
  app.ctx.get = name => name === 'ivoraige.parse' ? undefined : get(name)
  try {
    assert.ok((await client.listTools()).tools.some(item => item.name === tool))
    const missing = await client.callTool({ name: tool, arguments: {} })
    assert.equal(missing.isError, true)
    assert.equal(missing.structuredContent.error.code, 'COMPONENT_MISSING')
  } finally { app.ctx.get = get }
  assert.equal((await client.callTool({ name: tool, arguments: {} })).isError, undefined)
})
