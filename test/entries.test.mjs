import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer, request } from 'node:http'
import { mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '../src/http.mjs'
import { McpRegistry } from '../src/mcp-registry.mjs'
import { KernelError } from '../src/errors.mjs'
import { runCli } from '../src/cli.mjs'
import { createApp } from '../src/app.mjs'

function fixture() {
  const calls = [], listeners = new Set()
  const app = { operations: {
    async invoke(name, params) {
      calls.push({ name, params })
      if (name === 'getDocument') throw new KernelError('NOT_FOUND', 'missing')
      if (name === 'listDocuments') return { apiVersion: '2.0', items: [{ id: 'doc_1' }] }
      if (name === 'getTask') return { apiVersion: '2.0', task: { id: params.taskId, state: 'succeeded',
        kind: 'translate', progress: { stage: 'done', done: 1, total: 1 }, artifacts: [], stats: {} } }
      return { apiVersion: '2.0', taskId: 'task_1' }
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async artifact() { throw new KernelError('NOT_FOUND', 'missing artifact') },
  } }
  return { app, calls, listeners }
}

test('HTTP routes invoke operations and enforce host, origin, and body limits', async t => {
  const f = fixture()
  const server = await serve(f.app, { port: 0 })
  t.after(() => server.close())
  const listing = await fetch(`${server.url}/api/documents?limit=2`)
  assert.equal(listing.status, 200)
  assert.deepEqual(await listing.json(), { apiVersion: '2.0', items: [{ id: 'doc_1' }] })
  assert.deepEqual(f.calls[0], { name: 'listDocuments', params: { limit: 2 } })
  const missing = await fetch(`${server.url}/api/documents/doc_1`)
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).error.code, 'NOT_FOUND')
  const invalidLimit = await fetch(`${server.url}/api/documents?limit=501`)
  assert.equal(invalidLimit.status, 400)
  const origin = await fetch(`${server.url}/api/documents`, { headers: { Origin: 'http://evil.example' } })
  assert.equal(origin.status, 403)
  const host = await new Promise((resolve, reject) => {
    const req = request(`${server.url}/api/documents`, { headers: { Host: 'evil.example' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject); req.end()
  })
  assert.equal(host, 403)
  const malformed = await fetch(`${server.url}/api/documents/import`, { method: 'POST', body: '{' })
  assert.equal(malformed.status, 400)
  const artifact = await fetch(`${server.url}/api/artifacts/not-found/download`)
  assert.equal(artifact.status, 404)
})

test('HTTP rejects non-loopback binding until token authentication is available', async () => {
  await assert.rejects(serve(fixture().app, { host: '0.0.0.0', port: 0 }),
    /Non-loopback listening requires DSH token authentication/)
})

test('SSE filters task events and removes disconnected subscribers', async t => {
  const f = fixture()
  const server = await serve(f.app, { port: 0 })
  t.after(() => server.close())
  const controller = new AbortController()
  const response = await fetch(`${server.url}/api/tasks/task_1/events`, { signal: controller.signal })
  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8')
  assert.equal(f.listeners.size, 1)
  const reader = response.body.getReader()
  await reader.read()
  for (const listener of f.listeners) {
    listener({ type: 'task.progress', data: { taskId: 'other', stage: 'x', done: 1, total: 2 } })
    listener({ type: 'task.progress', data: { taskId: 'task_1', stage: 'x', done: 1, total: 2 } })
  }
  const chunk = new TextDecoder().decode((await reader.read()).value)
  assert.match(chunk, /event: task.progress/)
  assert.match(chunk, /"taskId":"task_1"/)
  assert.doesNotMatch(chunk, /other/)
  controller.abort()
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(f.listeners.size, 0)
})

test('dotted real-style IDs route to units, tasks, SSE, and artifact lookup', async t => {
  const calls = [], listeners = new Set()
  let artifactId
  const app = { operations: {
    async invoke(name, params) { calls.push({ name, params }); return { apiVersion: '2.0' } },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    artifact(id) { artifactId = id; return { path: join(tmpdir(), 'missing-ivoraige-artifact') } },
  } }
  const server = await serve(app, { port: 0 })
  t.after(() => server.close())
  assert.equal((await fetch(`${server.url}/api/units/doc.0?targetLang=zh-CN`)).status, 200)
  assert.equal((await fetch(`${server.url}/api/tasks/doc.translate.1`)).status, 200)
  assert.deepEqual(calls.map(call => [call.name, call.params.unitId ?? call.params.taskId]),
    [['getUnit', 'doc.0'], ['getTask', 'doc.translate.1']])
  const controller = new AbortController()
  const eventResponse = await fetch(`${server.url}/api/tasks/doc.translate.1/events`, { signal: controller.signal })
  assert.equal(eventResponse.status, 200)
  controller.abort()
  const artifact = await fetch(`${server.url}/api/artifacts/doc.md.1/download`)
  assert.equal(artifact.status, 404)
  assert.equal((await artifact.json()).error.code, 'NOT_FOUND')
  assert.equal(artifactId, 'doc.md.1')
})

test('server close ends active SSE responses and releases listeners', async () => {
  const f = fixture()
  const server = await serve(f.app, { port: 0 })
  const response = await fetch(`${server.url}/api/events`)
  assert.equal(f.listeners.size, 1)
  await server.close()
  assert.equal(f.listeners.size, 0)
  await response.body.cancel()
})

test('CLI --json errors use the shared error envelope and exit code', async () => {
  let out = '', err = ''
  const code = await runCli(['--json', 'units'],
    { stdout: { write(chunk) { out += chunk } }, stderr: { write(chunk) { err += chunk } } })
  assert.equal(code, 2)
  assert.equal(JSON.parse(out).error.code, 'INVALID_ARGUMENT')
  assert.match(err, /Missing document ID/)
})

test('CLI --json-events forwards actual SSE task events as NDJSON', async t => {
  const listeners = new Set()
  const app = { operations: {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async invoke(name) {
      if (name === 'translate') {
        for (const listener of listeners) {
          listener({ type: 'task.queued', data: { taskId: 'task_1', kind: 'translate' } })
          listener({ type: 'unit.completed', data: { taskId: 'task_1', unitId: 'u1', targetLang: 'zh-CN', reused: false } })
          listener({ type: 'task.succeeded', data: { taskId: 'task_1', artifacts: [], stats: {} } })
        }
        return { apiVersion: '2.0', taskId: 'task_1' }
      }
      return { apiVersion: '2.0', task: { state: 'succeeded' } }
    },
  } }
  const server = await serve(app, { port: 0 })
  t.after(() => server.close())
  let out = '', err = ''
  const code = await runCli(['--url', server.url, '--json-events', 'translate', 'doc_1', '--target-lang', 'zh-CN'],
    { stdout: { write(chunk) { out += chunk } }, stderr: { write(chunk) { err += chunk } } })
  assert.equal(code, 0, err)
  const events = out.trim().split('\n').map(JSON.parse)
  assert.deepEqual(events.map(event => event.type), ['task.queued', 'unit.completed', 'task.succeeded'])
})

test('CLI returns exit code 5 when an observed task is canceled', async t => {
  const listeners = new Set()
  const app = { operations: {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async invoke(name) {
      if (name === 'translate') {
        for (const listener of listeners) listener({ type: 'task.canceled', data: { taskId: 'task_1' } })
        return { apiVersion: '2.0', taskId: 'task_1' }
      }
      return { apiVersion: '2.0', task: { state: 'canceled' } }
    },
  } }
  const server = await serve(app, { port: 0 })
  t.after(() => server.close())
  let out = '', err = ''
  const code = await runCli(['--url', server.url, '--json-events', 'translate', 'doc_1', '--target-lang', 'zh-CN'],
    { stdout: { write(chunk) { out += chunk } }, stderr: { write(chunk) { err += chunk } } })
  assert.equal(code, 5, err)
  assert.equal(JSON.parse(out.trim()).type, 'task.canceled')
})

test('CLI executes through a symlinked directory path', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-cli-alias-'))
  const alias = join(directory, 'checkout')
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  try { await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) {
    await rm(directory, { recursive: true, force: true })
    if (error.code === 'EPERM') { t.skip('Directory symlinks are blocked by this sandbox'); return }
    throw error
  }
  t.after(async () => { await unlink(alias); await rm(directory, { recursive: true, force: true }) })
  let child
  try {
    child = spawn(process.execPath, [join(alias, 'src', 'cli.mjs'), 'help'],
      { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    if (error.code === 'EPERM') { t.skip('Process spawning is blocked by this sandbox'); return }
    throw error
  }
  let out = '', err = ''
  child.stdout.on('data', chunk => { out += chunk })
  child.stderr.on('data', chunk => { err += chunk })
  const result = await new Promise((resolveResult, rejectResult) => {
    child.once('error', error => error.code === 'EPERM' ? resolveResult({ blocked: true }) : rejectResult(error))
    child.once('close', code => resolveResult({ code }))
  })
  if (result.blocked) { t.skip('Process spawning is blocked by this sandbox'); return }
  assert.equal(result.code, 0, err)
  assert.match(out, /Commands: import, documents/)
})

for (const [state, exitCode] of [['failed', 4], ['canceled', 5]]) {
  test(`CLI remote task waits for ${state} and returns exit ${exitCode}`, async t => {
    let polls = 0
    const app = { operations: {
      async invoke(name) {
        if (name === 'translate') return { apiVersion: '2.0', taskId: 'task_1' }
        if (name === 'getTask') return { apiVersion: '2.0', task: { id: 'task_1', state: ++polls === 1 ? 'running' : state } }
        throw new Error(`Unexpected operation ${name}`)
      },
      subscribe() { return () => {} },
    } }
    const server = await serve(app, { port: 0 })
    t.after(() => server.close())
    let out = '', err = ''
    const code = await runCli(['--url', server.url, '--json', 'translate', 'doc_1', '--target-lang', 'zh-CN'],
      { stdout: { write(chunk) { out += chunk } }, stderr: { write(chunk) { err += chunk } } })
    assert.equal(code, exitCode, err)
    assert.equal(polls, 2)
    assert.equal(JSON.parse(out).taskId, 'task_1')
  })
}

test('CLI remote --no-wait returns the task handle without polling', async t => {
  let polls = 0
  const app = { operations: {
    async invoke(name) {
      if (name === 'translate') return { apiVersion: '2.0', taskId: 'task_1' }
      if (name === 'getTask') { polls++; return { apiVersion: '2.0', task: { state: 'running' } } }
      throw new Error(`Unexpected operation ${name}`)
    },
    subscribe() { return () => {} },
  } }
  const server = await serve(app, { port: 0 })
  t.after(() => server.close())
  let out = '', err = ''
  const code = await runCli(['--url', server.url, '--no-wait', 'translate', 'doc_1', '--target-lang', 'zh-CN'],
    { stdout: { write(chunk) { out += chunk } }, stderr: { write(chunk) { err += chunk } } })
  assert.equal(code, 0, err)
  assert.equal(JSON.parse(out).taskId, 'task_1')
  assert.equal(polls, 0)
})

test('CLI rejects one output path for multiple formats before invocation', async () => {
  let out = '', err = ''
  const code = await runCli(['--url', 'http://127.0.0.1:1', '--json', 'export', 'doc_1', '--target-lang', 'zh',
    '--format', 'md,json', '--out', 'result.md'],
  { stdout: { write(chunk) { out += chunk } }, stderr: { write(chunk) { err += chunk } } })
  assert.equal(code, 2)
  assert.equal(JSON.parse(out).error.code, 'INVALID_ARGUMENT')
  assert.match(err, /exactly one/)
})

test('CLI reports malformed SSE without printing its payload and still uses task status', async t => {
  const secret = 'private-provider-token'
  const server = createServer((req, res) => {
    if (req.url === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(`event: task.progress\ndata: {${secret}\n\n`)
    } else if (req.url === '/api/documents/doc_1/translate') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ apiVersion: '2.0', taskId: 'task_1' }))
    } else if (req.url === '/api/tasks/task_1') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ apiVersion: '2.0', task: { id: 'task_1', state: 'failed' } }))
    } else { res.writeHead(404); res.end() }
  })
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  t.after(() => server.close())
  let out = '', err = ''
  const code = await runCli(['--url', `http://127.0.0.1:${server.address().port}`, '--json-events',
    'translate', 'doc_1', '--target-lang', 'zh'],
  { stdout: { write(chunk) { out += chunk } }, stderr: { write(chunk) { err += chunk } } })
  assert.equal(code, 4)
  assert.equal(out, '')
  assert.match(err, /Malformed task event/)
  assert.doesNotMatch(err, new RegExp(secret))
})

test('HTTP and CLI share the real store-backed operations contract', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-entry-'))
  const source = join(directory, 'source.txt')
  await writeFile(source, 'One paragraph.\n\nSecond paragraph.')
  const app = await createApp({ store: join(directory, 'store.sqlite') })
  const server = await serve(app, { port: 0 })
  t.after(async () => { await server.close(); await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  let out = '', err = ''
  const code = await runCli(['--url', server.url, '--json', 'import', source, '--source-lang', 'en'],
    { stdout: { write(chunk) { out += chunk } }, stderr: { write(chunk) { err += chunk } } })
  assert.equal(code, 0, err)
  const imported = JSON.parse(out)
  assert.equal(imported.apiVersion, '2.0')
  assert.ok(imported.document.id)
  const listed = await (await fetch(`${server.url}/api/documents`)).json()
  assert.ok(listed.items.some(doc => doc.id === imported.document.id))
})

test('CLI revisions, snapshots and artifacts honor limit and continuation cursors', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-paging-'))
  const app = await createApp({ store: join(directory, 'store.sqlite'), exportDir: join(directory, 'exports') })
  const server = await serve(app, { port: 0 })
  t.after(async () => { await server.close(); await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const { document } = await app.operations.invoke('importDocument', {
    contentBase64: Buffer.from('Paging sample.').toString('base64'), format: 'txt', language: 'en',
  })
  const [unit] = app.records.listUnits(document.id, { targetLang: 'zh' })
  let previous = null
  for (const text of ['初稿', '修订', '定稿']) {
    const revision = await app.records.writeRevision(unit.id, { targetLang: 'zh', text, baseRevisionId: previous })
    await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: previous })
    previous = revision.id
    const { taskId } = await app.operations.invoke('exportDocument', {
      docId: document.id, targetLang: 'zh', outputs: [{ format: 'json' }],
    })
    assert.equal((await app.tasks.wait(taskId)).state, 'succeeded')
  }
  for (const [command, id, operation, params] of [
    ['revisions', unit.id, 'listRevisions', { unitId: unit.id, targetLang: 'zh' }],
    ['snapshots', document.id, 'listSnapshots', { docId: document.id, targetLang: 'zh' }],
    ['artifacts', document.id, 'listArtifacts', { docId: document.id }],
  ]) {
    const expected = (await app.operations.invoke(operation, params)).items.map(item => item.id)
    const seen = []
    let cursor
    do {
      let out = '', err = ''
      const code = await runCli(['--url', server.url, '--json', command, id, '--target-lang', 'zh', '--limit', '1',
        ...(cursor ? ['--cursor', cursor] : [])],
      { stdout: { write(chunk) { out += chunk } }, stderr: { write(chunk) { err += chunk } } })
      assert.equal(code, 0, err)
      const page = JSON.parse(out)
      assert.equal(page.items.length, 1, command)
      seen.push(page.items[0].id)
      cursor = page.nextCursor
      assert.ok(seen.length <= expected.length, `${command} repeated a page`)
    } while (cursor)
    assert.deepEqual(seen, expected, command)
  }
})


test('non-MCP --stdio is rejected with the ordinary JSON error contract', async () => {
  let out = '', err = ''
  const code = await runCli(['documents', 'missing', '--json', '--stdio'], {
    stdout: { write: chunk => { out += chunk } }, stderr: { write: chunk => { err += chunk } },
  })
  assert.equal(code, 2)
  assert.equal(JSON.parse(out).error.code, 'INVALID_ARGUMENT')
  assert.match(err, /only supported by mcp/)
})

test('CLI releases SSE, HTTP port and SQLite even when MCP endpoint close fails', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-mcp-close-failure-'))
  const store = join(directory, 'store.sqlite')
  const subscribe = McpRegistry.prototype.subscribe
  const failure = new Error('Injected MCP endpoint close failure')
  t.mock.method(McpRegistry.prototype, 'subscribe', function (listener) {
    const unsubscribe = subscribe.call(this, listener)
    return () => { unsubscribe(); throw failure }
  })
  let started
  const ready = new Promise(resolveReady => { started = resolveReady })
  const previousTerm = new Set(process.listeners('SIGTERM'))
  const running = runCli(['serve', '--store', store, '--port', '0'], {
    stdout: { write: text => started(text.trim()) }, stderr: { write() {} },
  })
  const rejected = assert.rejects(running, error => error === failure)
  let response
  try {
    const url = await ready
    response = await fetch(`${url}/api/events`)
    const body = response.text()
    process.emit('SIGINT')
    await rejected
    await body
    await assert.rejects(fetch(`${url}/api/documents`))
    const probe = createServer()
    await new Promise((resolveListen, rejectListen) => {
      probe.once('error', rejectListen)
      probe.listen(Number(new URL(url).port), '127.0.0.1', resolveListen)
    })
    await new Promise(resolveClose => probe.close(resolveClose))
    const reopened = await createApp({ store })
    await reopened.dispose()
  } finally {
    for (const listener of process.listeners('SIGTERM')) if (!previousTerm.has(listener)) process.off('SIGTERM', listener)
    await rm(directory, { recursive: true, force: true })
  }
})
