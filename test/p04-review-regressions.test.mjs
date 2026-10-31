import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { Context, JobsLocal, Storage, StorageDomain, StorageSqlite, z } from '../dist/dsh.mjs'
import { createApp } from '../src/app.mjs'
import { runCli } from '../src/cli.mjs'
import { serve } from '../src/http.mjs'
import { OperationCatalog } from '../src/operation-catalog.mjs'
import { Operations } from '../src/operations.mjs'
import { CoreOperations } from '../src/core-operations.mjs'
import { Records } from '../src/records.mjs'
import { Tasks } from '../src/tasks.mjs'
import { Outputs } from '../src/outputs.mjs'
import { Parse } from '../src/parse.mjs'
import { Importer } from '../src/import.mjs'
import { TxtSource } from '../src/adapters/txt-source.mjs'

async function cli(args, app) {
  let stdout = '', stderr = ''
  const code = await runCli(args, { ...(app ? { app } : {}),
    stdout: { write: text => { stdout += text } }, stderr: { write: text => { stderr += text } } })
  return { code, body: JSON.parse(stdout), stderr }
}

test('self-owned generic task calls reject before admission while aliases and persistent hosts keep working', { timeout: 15000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-p04-self-host-'))
  const store = join(dir, 'store.sqlite'), settingsDir = join(dir, 'settings')
  let requests = 0, app, entry
  const model = createServer(async (req, res) => {
    for await (const _ of req) {} // Local synthetic completions only.
    requests++
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Synthetic result' }, index: 0,
      finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n')
  })
  t.after(async () => {
    await entry?.close(); await app?.dispose()
    model.closeAllConnections(); await new Promise(resolve => model.close(resolve))
    await rm(dir, { recursive: true, force: true })
  })
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve))
  app = await createApp({ store, settingsDir })
  await app.operations.invoke('updateSettings', { provider: 'local-probe', model: 'mock',
    api: 'openai-completions', baseURL: `http://127.0.0.1:${model.address().port}/v1`,
    credentialRef: 'LOCAL_PROBE', contextWindow: 8192, maxTokens: 512, select: true })
  await app.operations.invoke('setCredential', { ref: 'LOCAL_PROBE', value: 'synthetic-only' })
  const documents = []
  for (const content of ['Rejected task source.', 'Alias task source.', 'Supplied host source.', 'Remote host source.'])
    documents.push((await app.records.importDocument({ format: 'txt', content }, { language: 'en' })).document)
  await app.dispose(); app = undefined
  const host = ['--store', store, '--settings-dir', settingsDir, '--json']
  for (const extra of [[], ['--no-wait']]) {
    const result = await cli([...host, ...extra, 'call', 'translate', '--set',
      JSON.stringify({ docId: documents[0].id, targetLang: 'zh' })])
    assert.equal(result.code, 2)
    assert.equal(result.body.error.code, 'INVALID_ARGUMENT')
    assert.match(result.stderr, /waiting CLI alias or --url/)
  }
  assert.equal(requests, 0)
  assert.equal((await cli([...host, 'call', 'listDocuments'])).body.items.length, 4)
  app = await createApp({ store, settingsDir })
  assert.deepEqual(app.records.listTasks(), [])
  await app.dispose(); app = undefined
  const alias = await cli([...host, 'translate', documents[1].id, '--target-lang', 'zh'])
  assert.equal(alias.code, 0, alias.stderr)
  app = await createApp({ store, settingsDir })
  assert.equal(app.records.getTask(alias.body.taskId).state, 'succeeded')
  const supplied = await cli(['--json', 'call', 'translate', '--set',
    JSON.stringify({ docId: documents[2].id, targetLang: 'zh' })], app)
  assert.equal(supplied.code, 0, supplied.stderr)
  assert.equal((await app.tasks.wait(supplied.body.taskId)).state, 'succeeded')
  entry = await serve(app, { port: 0, mcp: false })
  const remote = await cli(['--url', entry.url, '--json', '--no-wait', 'call', 'translate', '--set',
    JSON.stringify({ docId: documents[3].id, targetLang: 'zh' })])
  assert.equal(remote.code, 0, remote.stderr)
  assert.equal((await app.tasks.wait(remote.body.taskId)).state, 'succeeded')
  assert.equal(requests, 3)
})

test('real Records and Tasks without import dependencies advertise unavailable import and keep document reads usable', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-p04-requires-'))
  const ctx = new Context()
  t.after(async () => { await ctx.get('ivoraige.tasks')?.close(); await ctx.fiber.dispose(); await rm(dir, { recursive: true, force: true }) })
  await ctx.plugin(OperationCatalog)
  await ctx.plugin(JobsLocal, { maxConcurrentJobsPerOwner: 1 })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageSqlite, { path: join(dir, 'store.sqlite') })
  await ctx.plugin(StorageDomain, { backend: 'sqlite' })
  await ctx.plugin(Records, { storageVersion: 2 }); await ctx.get('ivoraige.records').ready
  await ctx.plugin(Tasks); await ctx.get('ivoraige.tasks').ready
  await ctx.plugin(Operations); await ctx.plugin(CoreOperations)
  const catalog = ctx.get('ivoraige.operationCatalog'), operations = ctx.get('ivoraige.operations')
  const input = { language: 'en', format: 'txt', contentBase64: Buffer.from('Synthetic input.').toString('base64') }
  const missing = async expected => {
    assert.ok(catalog.list().some(item => item.id === 'importDocument'))
    assert.equal(catalog.list({ availableOnly: true }).some(item => item.id === 'importDocument'), false)
    await assert.rejects(operations.invoke('importDocument', input), error => {
      assert.equal(error.code, 'COMPONENT_MISSING')
      assert.deepEqual(error.details.missing, expected)
      return true
    })
    assert.deepEqual((await operations.invoke('listDocuments')).items, [])
  }
  await missing(['ivoraige.parse', 'ivoraige.import'])
  await ctx.plugin(Outputs); await ctx.plugin(Parse); await ctx.plugin(TxtSource)
  await missing(['ivoraige.import'])
  await ctx.plugin(Importer)
  assert.ok(catalog.list({ availableOnly: true }).some(item => item.id === 'importDocument'))
  assert.ok((await operations.invoke('importDocument', input)).document.id)
})

test('a strict contributed payload cannot override the protocol version through CLI HTTP or actual MCP', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-p04-envelope-'))
  const app = await createApp({ store: join(dir, 'store.sqlite') })
  let entry, client
  t.after(async () => { await client?.close(); await entry?.close(); await app.dispose(); await rm(dir, { recursive: true, force: true }) })
  app.operationCatalog.register({ id: 'probeVersion', inputSchema: z.object({}).strict(),
    resultSchema: z.object({ apiVersion: z.literal('0.0'), value: z.string() }).strict(),
    handler: () => ({ apiVersion: '0.0', value: 'synthetic' }) })
  assert.equal((await app.operationCatalog.invoke('probeVersion')).apiVersion, '0.0')
  entry = await serve(app, { port: 0 })
  client = new Client({ name: 'p04-version-regression', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(entry.url + '/mcp')))
  const local = await cli(['--json', 'call', 'probeVersion'], app)
  assert.equal(local.code, 0)
  const http = await (await fetch(entry.url + '/api/operations/probeVersion', { method: 'POST', body: '{}' })).json()
  const mcp = (await client.callTool({ name: 'ivoraige_op_probeVersion', arguments: {} })).structuredContent
  for (const result of [local.body, http, mcp]) assert.deepEqual(result, { apiVersion: '2.0', value: 'synthetic' })
})

test('malformed URL path encoding is INVALID_ARGUMENT across generic aliases events and downloads', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-p04-url-'))
  const app = await createApp({ store: join(dir, 'store.sqlite') })
  const entry = await serve(app, { port: 0, mcp: false })
  t.after(async () => { await entry.close(); await app.dispose(); await rm(dir, { recursive: true, force: true }) })
  const logs = []
  t.mock.method(console, 'error', (...args) => logs.push(args))
  let calls = 0
  const invoke = app.operations.invoke.bind(app.operations)
  app.operations.invoke = (...args) => { calls++; return invoke(...args) }
  for (const bad of ['%', '%GG', '%E0%A4%A']) {
    for (const [method, path] of [['POST', '/api/operations/' + bad], ['GET', '/api/documents/' + bad],
      ['GET', '/api/tasks/' + bad], ['GET', '/api/tasks/' + bad + '/events'],
      ['GET', '/api/artifacts/' + bad + '/download'], ['GET', '/api/components/tasks/' + bad],
      ['GET', '/api/documents/synthetic/snapshots/' + bad]]) {
      const response = await fetch(entry.url + path, { method, ...(method === 'POST' ? { body: '{}' } : {}) })
      assert.equal(response.status, 400, path)
      assert.equal((await response.json()).error.code, 'INVALID_ARGUMENT', path)
    }
  }
  assert.equal(calls, 0)
  const encoded = await fetch(entry.url + '/api/operations/%6CistDocuments', { method: 'POST', body: '{}' })
  assert.equal(encoded.status, 200)
  assert.deepEqual((await encoded.json()).items, [])
  const literalPercent = await fetch(entry.url + '/api/documents/%25')
  assert.equal(literalPercent.status, 404)
  assert.equal((await literalPercent.json()).error.code, 'NOT_FOUND')
  assert.equal(logs.length, 0)
})
