import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { PassThrough } from 'node:stream'
import { createMcpHttp, runMcpStdio } from '../src/mcp.mjs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { Service, z } from '../dist/dsh.mjs'
import { createApp } from '../src/app.mjs'
import { serve } from '../src/http.mjs'
import { KernelError } from '../src/errors.mjs'

const targetLang = 'zh'
const upload = (content, format = 'txt') => ({
  contentBase64: Buffer.from(content).toString('base64'), format, language: 'en', origin: 'mcp',
})
const client = options => new Client({ name: 'ivoraige-integration-test', version: '1.0.0' }, options)
const body = response => {
  assert.equal(response.content?.[0]?.type, 'text')
  const parsed = JSON.parse(response.content[0].text)
  assert.deepEqual(response.structuredContent, parsed)
  return parsed
}
async function call(connection, name, args = {}) {
  const response = await connection.callTool({ name: `ivoraige_${name}`, arguments: args })
  assert.equal(response.isError, undefined, JSON.stringify(body(response)))
  return body(response)
}
async function failure(connection, name, args, code) {
  const response = await connection.callTool({ name: `ivoraige_${name}`, arguments: args })
  assert.equal(response.isError, true)
  const error = body(response)
  assert.equal(error.apiVersion, '2.0')
  assert.equal(error.error.code, code)
  return error.error
}
async function done(connection, taskId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { task } = await call(connection, 'task_status', { taskId, waitSeconds: 1 })
    if (['succeeded', 'failed', 'canceled', 'paused'].includes(task.state)) return task
  }
  throw new Error(`Task ${taskId} did not finish`)
}
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-mcp-'))
  const store = join(directory, 'store.sqlite')
  const exportDir = join(directory, 'exports')
  let app = await createApp({ store, exportDir, ...options })
  let server = await serve(app, { port: 0 })
  const connections = []
  t.after(async () => {
    const errors = []
    const attempt = async action => { try { await action() } catch (error) { errors.push(error) } }
    await Promise.all(connections.map(connection => attempt(() => connection.close())))
    await attempt(() => server?.close())
    await attempt(() => app?.dispose())
    await attempt(() => rm(directory, { recursive: true, force: true }))
    if (errors.length) throw new AggregateError(errors, 'MCP fixture cleanup failed')
  })
  return {
    get app() { return app }, get server() { return server }, directory, store, exportDir,
    async connect(options) {
      const connection = client(options)
      await connection.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`)))
      connections.push(connection)
      return connection
    },
    async restart() {
      await Promise.all(connections.splice(0).map(connection => connection.close()))
      await server.close(); await app.dispose()
      app = await createApp({ store, exportDir, ...options })
      server = await serve(app, { port: 0 })
    },
  }
}

test('SDK HTTP clients share documents, frozen outputs, and durable tasks', async t => {
  const f = await fixture(t)
  const first = await f.connect()
  const second = await f.connect()
  const listing = await first.listTools()
  const names = listing.tools.map(tool => tool.name)
  const unitTemplate = (await first.listResourceTemplates()).resourceTemplates.find(item => item.name === 'Unit')
  assert.match(unitTemplate.description, /targetLang.*required/)
  for (const name of ['capabilities', 'import', 'units_list', 'unit_update', 'revision_accept',
    'export', 'task_status', 'snapshots_list', 'artifacts_list']) assert.ok(names.includes(`ivoraige_${name}`), name)
  assert.ok(!names.includes('ivoraige_settings_update'))
  assert.ok(!names.includes('ivoraige_credential_set'))
  assert.ok(!names.includes('ivoraige_component_install'))

  const capabilities = await call(first, 'capabilities')
  assert.ok(capabilities.inputFormats.includes('txt'))
  assert.ok(capabilities.outputFormats.includes('md'))
  const imported = await call(first, 'import', upload('A measured result.\n\nA second result.'))
  const docId = imported.document.id
  const documentResource = await first.readResource({ uri: `ivoraige://docs/${docId}` })
  assert.equal(JSON.parse(documentResource.contents[0].text.match(/```json\n([\s\S]*?)\n```/)[1]).document.id, docId)
  assert.equal((await call(second, 'documents_list')).items[0].id, docId)
  const units = (await call(second, 'units_list', { docId, targetLang })).items
  assert.equal(units.length, 2)
  const unitId = units[0].id
  await assert.rejects(first.readResource({ uri: `ivoraige://docs/${docId}/units/${unitId}` }),
    error => error.code === -32602 && /Resource not found/.test(error.message))
  await assert.rejects(first.readResource({ uri: `ivoraige://docs/${docId}/units/${unitId}?targetLang=` }),
    error => error.code === -32602 && /Resource not found/.test(error.message))
  await assert.rejects(first.readResource({ uri: `ivoraige://docs/${docId}/units/${unitId}?targetLang=auto` }),
    error => error.code === -32602 && error.data?.error?.code === 'INVALID_ARGUMENT')
  await assert.rejects(first.readResource({ uri: 'ivoraige://docs/missing-document' }),
    error => /not found/i.test(error.message))
  await assert.rejects(first.readResource({ uri: 'ivoraige://artifacts/missing-artifact' }),
    error => /not found/i.test(error.message))
  const malformed = await first.callTool({ name: 'ivoraige_unit_update', arguments: {
    unitId, targetLang, text: 'Missing required revision lock.',
  } }).catch(error => error)
  assert.ok(malformed instanceof Error || malformed.isError)
  assert.equal((await call(first, 'unit_get', { unitId, targetLang })).draftRevisionId, undefined)
  const edit = await call(first, 'unit_update', { unitId, targetLang, baseRevisionId: null, text: '第一版译文。' })
  await failure(second, 'unit_update', { unitId, targetLang, baseRevisionId: null, text: '过期的修改。' }, 'CONFLICT')
  await call(second, 'revision_accept', { revisionId: edit.revision.id, expectedAcceptedRevisionId: null })
  await failure(first, 'revision_accept', { revisionId: edit.revision.id, expectedAcceptedRevisionId: null }, 'CONFLICT')
  const secondEdit = await call(second, 'unit_update', { unitId: units[1].id, targetLang,
    baseRevisionId: null, text: '第二段译文。' })
  await call(second, 'revision_accept', { revisionId: secondEdit.revision.id, expectedAcceptedRevisionId: null })

  const exported = await call(first, 'export', { docId, targetLang,
    outputs: [{ format: 'md' }, { format: 'json' }] })
  const task = await done(second, exported.taskId)
  assert.equal(task.state, 'succeeded', JSON.stringify(task.error))
  assert.deepEqual(task.artifacts.map(item => item.format), ['md', 'json'])
  assert.ok(task.artifacts.every(item => item.snapshotId === exported.snapshotId))
  const artifacts = await Promise.all(task.artifacts.map(async item => {
    const response = await first.readResource({ uri: `ivoraige://artifacts/${item.id}` })
    return Buffer.from(response.contents[0].blob, 'base64').toString('utf8')
  }))
  assert.match(artifacts[0], /第一版译文/)
  assert.equal(JSON.parse(artifacts[1]).units[0].text, '第一版译文。')

  const newer = await call(second, 'unit_update', { unitId, targetLang,
    baseRevisionId: edit.revision.id, text: '修改后的译文。' })
  await call(second, 'revision_accept', { revisionId: newer.revision.id,
    expectedAcceptedRevisionId: edit.revision.id })
  await f.restart()
  const reopened = await f.connect()
  const replay = await call(reopened, 'export', { docId, targetLang,
    snapshotId: exported.snapshotId, outputs: [{ format: 'md' }, { format: 'json' }] })
  const replayTask = await done(reopened, replay.taskId)
  assert.equal(replayTask.state, 'succeeded', JSON.stringify(replayTask.error))
  assert.equal(replay.snapshotId, exported.snapshotId)
  const replayJson = await reopened.readResource({ uri: `ivoraige://artifacts/${replayTask.artifacts[1].id}` })
  assert.equal(JSON.parse(Buffer.from(replayJson.contents[0].blob, 'base64')).units[0].text, '第一版译文。')
  assert.equal((await call(reopened, 'task_status', { taskId: exported.taskId })).task.state, 'succeeded')
  const taskResource = await reopened.readResource({ uri: `ivoraige://tasks/${exported.taskId}` })
  assert.match(taskResource.contents[0].text, /"state": "succeeded"/)
  assert.ok((await call(reopened, 'snapshots_list', { docId })).items.some(item => item.id === exported.snapshotId))
  await failure(reopened, 'snapshot_delete', { docId, snapshotId: exported.snapshotId }, 'CONFLICT')
})

test('MCP translation uses a local mock model and frozen replay never invokes it', async t => {
  const f = await fixture(t)
  let calls = 0
  class MockModel extends Service {
    constructor(ctx) { super(ctx, 'ivoraige.translationModel') }
    async translate() {
      calls++
      return { text: '模型译文。', modelId: 'local-test', promptVersion: 'test',
        tokens: { input: null, output: null } }
    }
  }
  await f.app.ctx.plugin(MockModel)
  const connection = await f.connect()
  const { document } = await call(connection, 'import', upload('Translate through MCP.'))
  const translated = await call(connection, 'translate', { docId: document.id, targetLang })
  assert.equal((await done(connection, translated.taskId)).state, 'succeeded')
  assert.equal(calls, 1)
  const output = await call(connection, 'export', { docId: document.id, targetLang,
    outputs: [{ format: 'json' }] })
  assert.equal((await done(connection, output.taskId)).state, 'succeeded')
  const replay = await call(connection, 'export', { docId: document.id, targetLang,
    snapshotId: output.snapshotId, outputs: [{ format: 'md' }] })
  assert.equal((await done(connection, replay.taskId)).state, 'succeeded')
  assert.equal(calls, 1)
})

test('a Cordis plugin adds and removes MCP tools and resources on a live connection', async t => {
  const f = await fixture(t)
  const changes = { tools: 0, resources: 0 }
  const connection = await f.connect({ versionNegotiation: { mode: 'auto' }, listChanged:
    Object.fromEntries(Object.keys(changes).map(kind => [kind, {
      autoRefresh: false, debounceMs: 0, onChanged: error => { assert.ifError(error); changes[kind]++ },
    }])) })
  assert.equal(connection.getServerCapabilities().tools.listChanged, true)
  const waitChanges = async count => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (changes.tools >= count && changes.resources >= count) return
      await new Promise(resolveWait => setTimeout(resolveWait, 20))
    }
    assert.fail(`Missing plugin notifications: ${JSON.stringify(changes)}`)
  }
  const plugin = await f.app.ctx.plugin({
    inject: ['ivoraige.mcp'],
    apply(ctx) {
      const registry = ctx.get('ivoraige.mcp')
      ctx.effect(() => registry.registerTool('test_echo', {
        description: 'Echo a local test value.', inputSchema: z.object({ value: z.string() }),
        invoke: ({ value }) => ({ apiVersion: '2.0', value }),
      }))
      ctx.effect(() => registry.registerResource('Test fixture', {
        template: 'ivoraige://test/{name}', metadata: { mimeType: 'text/plain' },
        read: async (uri, { name }) => ({ contents: [{ uri: uri.href, mimeType: 'text/plain', text: name }] }),
      }))
    },
  })
  try {
    await waitChanges(1)
    assert.ok((await connection.listTools()).tools.some(item => item.name === 'test_echo'))
    assert.equal(body(await connection.callTool({ name: 'test_echo', arguments: { value: 'plugin' } })).value, 'plugin')
    assert.equal((await connection.readResource({ uri: 'ivoraige://test/plugin' })).contents[0].text, 'plugin')
  } finally { await plugin.dispose() }
  await waitChanges(2)
  assert.ok(!(await connection.listTools()).tools.some(item => item.name === 'test_echo'))
  await assert.rejects(connection.readResource({ uri: 'ivoraige://test/plugin' }))
  const legacy = await f.connect()
  assert.equal(legacy.getServerCapabilities().tools.listChanged, false)
  assert.equal(legacy.getServerCapabilities().resources.listChanged, false)
  assert.equal(f.app.mcp.listeners.size, 1, 'requests must not accumulate registry subscriptions')
  await assert.rejects(serve(f.app, { port: Number(new URL(f.server.url).port) }), { code: 'EADDRINUSE' })
  assert.equal(f.app.mcp.listeners.size, 1, 'failed HTTP startup must release its subscription')
  t.after(() => assert.equal(f.app.mcp.listeners.size, 0, 'HTTP shutdown must release registry subscriptions'))
})

test('aborting MCP task long-poll releases its subscriber but keeps the task', async t => {
  const f = await fixture(t)
  const connection = await f.connect()
  const { document } = await call(connection, 'import', upload('Pending export.'))
  const [unit] = (await call(connection, 'units_list', { docId: document.id, targetLang })).items
  const { revision } = await call(connection, 'unit_update', { unitId: unit.id, targetLang,
    baseRevisionId: null, text: '等待中的译文。' })
  await call(connection, 'revision_accept', { revisionId: revision.id,
    expectedAcceptedRevisionId: null })
  const schedule = f.app.tasks.schedule
  const subscribe = f.app.operations.subscribe
  let active = 0
  f.app.tasks.schedule = () => {}
  f.app.operations.subscribe = function (listener) {
    active++
    const unsubscribe = subscribe.call(this, listener)
    return () => { active--; unsubscribe() }
  }
  try {
    const { taskId } = await call(connection, 'export', { docId: document.id, targetLang,
      outputs: [{ format: 'json' }] })
    const controller = new AbortController()
    const waiting = fetch(`${f.server.url}/mcp`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'tools/call',
        params: { name: 'ivoraige_task_status', arguments: { taskId, waitSeconds: 10 } } }),
    }).catch(() => undefined)
    for (let attempt = 0; active === 0 && attempt < 50; attempt++)
      await new Promise(resolveWait => setTimeout(resolveWait, 10))
    assert.equal(active, 1)
    controller.abort()
    await waiting
    for (let attempt = 0; active !== 0 && attempt < 50; attempt++)
      await new Promise(resolveWait => setTimeout(resolveWait, 10))
    assert.equal(active, 0)
    assert.equal((await call(connection, 'task_status', { taskId })).task.state, 'queued')
    assert.equal((await call(connection, 'task_cancel', { taskId })).task.state, 'canceled')
  } finally {
    f.app.tasks.schedule = schedule
    f.app.operations.subscribe = subscribe
  }
})

test('MCP reports absent PDF support and controls queued export lifecycle', async t => {
  const f = await fixture(t)
  const connection = await f.connect()
  assert.ok(!(await call(connection, 'capabilities')).inputFormats.includes('pdf'))
  const pendingPdf = await call(connection, 'import', upload('%PDF-1.4\n', 'pdf'))
  const failedPdf = await done(connection, pendingPdf.taskId)
  assert.equal(failedPdf.state, 'failed')
  assert.equal(failedPdf.error.message, 'Unsupported source format')

  const { document } = await call(connection, 'import', upload('Lifecycle source.'))
  const docId = document.id
  const [unit] = (await call(connection, 'units_list', { docId, targetLang })).items
  const { revision } = await call(connection, 'unit_update', { unitId: unit.id, targetLang,
    baseRevisionId: null, text: '任务译文。' })
  await call(connection, 'revision_accept', { revisionId: revision.id,
    expectedAcceptedRevisionId: null })

  const schedule = f.app.tasks.schedule
  f.app.tasks.schedule = () => {}
  try {
    const first = await call(connection, 'export', { docId, targetLang, outputs: [{ format: 'json' }] })
    assert.equal((await call(connection, 'task_status', { taskId: first.taskId })).task.state, 'queued')
    assert.equal((await call(connection, 'task_pause', { taskId: first.taskId })).task.state, 'paused')
    assert.equal((await call(connection, 'task_resume', { taskId: first.taskId })).task.state, 'queued')
    assert.equal((await call(connection, 'task_cancel', { taskId: first.taskId })).task.state, 'canceled')
    const second = await call(connection, 'export', { docId, targetLang, outputs: [{ format: 'md' }] })
    assert.equal((await call(connection, 'task_status', { taskId: first.taskId })).task.state, 'canceled')
    f.app.tasks.schedule = schedule
    schedule.call(f.app.tasks)
    assert.equal((await done(connection, second.taskId)).state, 'succeeded')
    await failure(connection, 'task_resume', { taskId: first.taskId }, 'PRECONDITION_FAILED')
  } finally { f.app.tasks.schedule = schedule }
})

test('HTTP MCP obeys Host and Origin gates and can be disabled', async t => {
  const f = await fixture(t)
  for (const headers of [{ Host: 'evil.example' }, { Origin: 'http://evil.example' }]) {
    const response = await new Promise((resolveResponse, rejectResponse) => {
      const pending = request(`${f.server.url}/mcp`, { method: 'POST',
        headers: { 'content-type': 'application/json', ...headers } }, incoming => {
        const chunks = []
        incoming.on('data', chunk => chunks.push(chunk))
        incoming.on('end', () => resolveResponse({ status: incoming.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
      })
      pending.on('error', rejectResponse)
      pending.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))
    })
    assert.equal(response.status, 403)
    assert.equal(response.body.error.code, 'FORBIDDEN_HOST')
  }
  const disabled = await serve(f.app, { port: 0, mcp: false })
  try {
    const response = await fetch(`${disabled.url}/mcp`, { method: 'POST' })
    assert.equal(response.status, 404)
  } finally { await disabled.close() }
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-without-mcp-'))
  const app = await createApp({ store: join(directory, 'store.sqlite'), mcp: false })
  try {
    assert.equal(app.mcp, undefined)
    assert.throws(() => createMcpHttp(app), error => error instanceof KernelError && error.code === 'COMPONENT_MISSING')
    assert.ok((await app.operations.invoke('capabilities')).inputFormats.includes('txt'))
    const listener = await serve(app, { port: 0, mcp: false })
    try { assert.equal((await fetch(`${listener.url}/mcp`, { method: 'POST' })).status, 404) }
    finally { await listener.close() }
  } finally { await app.dispose(); await rm(directory, { recursive: true, force: true }) }
})

test('spawned CLI stdio speaks MCP and releases its SQLite store on EOF', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-mcp-stdio-'))
  const store = join(directory, 'store.sqlite')
  const script = resolve(fileURLToPath(new URL('../src/cli.mjs', import.meta.url)))
  const connection = client()
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [script, 'mcp', '--stdio', '--store', store], stderr: 'pipe' })
  t.after(async () => { await connection.close(); await rm(directory, { recursive: true, force: true }) })
  await connection.connect(transport)
  assert.ok((await connection.listTools()).tools.some(tool => tool.name === 'ivoraige_import'))
  const imported = await call(connection, 'import', upload('Stdio source.'))
  const docId = imported.document.id
  assert.equal((await call(connection, 'documents_list')).items[0].id, docId)
  const [unit] = (await call(connection, 'units_list', { docId, targetLang })).items
  const revision = await call(connection, 'unit_update', { unitId: unit.id, targetLang,
    baseRevisionId: null, text: '标准输入译文。' })
  await call(connection, 'revision_accept', { revisionId: revision.revision.id,
    expectedAcceptedRevisionId: null })
  const exported = await call(connection, 'export', { docId, targetLang, outputs: [{ format: 'json' }] })
  assert.equal((await done(connection, exported.taskId)).state, 'succeeded')
  await connection.close()
  // The CLI closes the kernel when MCP stdin reaches EOF; a new owner must acquire the same store.
  let reopened
  for (let attempt = 0; attempt < 20; attempt++) {
    try { reopened = await createApp({ store }); break }
    catch (error) {
      if (error.code !== 'CONFLICT' || attempt === 19) throw error
      await new Promise(resolveWait => setTimeout(resolveWait, 100))
    }
  }
  try { assert.equal(reopened.records.getDocument(docId).id, docId) }
  finally { await reopened.dispose() }
})


test('discovery listener failure does not break registration or disposal', async t => {
  const f = await fixture(t)
  const warnings = []
  t.mock.method(console, 'warn', (...args) => warnings.push(args))
  const changes = []
  const unsubFail = f.app.mcp.subscribe(() => { throw new Error('Disconnected subscriber') })
  const unsubOk = f.app.mcp.subscribe(kind => changes.push(kind))
  try {
    const dispose = f.app.mcp.registerTool('test_listener', { description: 'test' })
    assert.ok(f.app.mcp.tools.has('test_listener'))
    dispose()
    assert.equal(f.app.mcp.tools.has('test_listener'), false)
    assert.deepEqual(changes, ['tools', 'tools'])
    assert.equal(warnings.length, 2)
  } finally { unsubFail(); unsubOk() }
})

test('stdio reports a recoverable stream error and keeps serving until EOF', async t => {
  const f = await fixture(t)
  const stdin = new PassThrough(), stdout = new PassThrough()
  const errors = []
  t.mock.method(console, 'error', (...args) => errors.push(args))
  let output = ''
  stdout.on('data', chunk => { output += chunk.toString() })
  const running = runMcpStdio(f.app, { stdin, stdout })
  try {
    stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' },
    } }) + '\n')
    for (let i = 0; i < 100 && !output.includes('"id":1'); i++) await new Promise(r => setTimeout(r, 10))
    assert.ok(output.split('\n').filter(Boolean).map(line => JSON.parse(line)).some(message => message.id === 1 && message.result))
    stdin.emit('error', new Error('Recoverable input error'))
    stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n')
    for (let i = 0; i < 100 && !output.includes('"id":2'); i++) await new Promise(r => setTimeout(r, 10))
    assert.ok(errors.length > 0)
    assert.ok(output.split('\n').filter(Boolean).map(line => JSON.parse(line)).some(message => message.id === 2 && message.result.tools.length))
  } finally { stdin.end(); await running; stdout.destroy() }
})


test('fixture releases server, store and directory after client cleanup fails', async () => {
  let cleanup
  const f = await fixture({ after: callback => { cleanup = callback } })
  const connection = await f.connect()
  const close = connection.close.bind(connection)
  connection.close = async () => { await close(); throw new Error('Injected close failure') }
  await assert.rejects(cleanup, /MCP fixture cleanup failed/)
  await assert.rejects(stat(f.directory), { code: 'ENOENT' })
  await assert.rejects(fetch(f.server.url))
})


test('stdio stops when the SDK closes a broken output transport', async t => {
  const f = await fixture(t)
  const stdin = new PassThrough(), stdout = new PassThrough()
  t.mock.method(console, 'error', () => {})
  const running = runMcpStdio(f.app, { stdin, stdout })
  let timeout
  try {
    stdout.emit('error', new Error('Broken output'))
    await Promise.race([running, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('stdio did not stop after transport close')), 1000)
    })])
  } finally { clearTimeout(timeout); stdin.end(); await running; stdout.destroy() }
})
