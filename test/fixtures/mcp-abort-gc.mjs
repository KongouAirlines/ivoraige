import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createApp } from '../../src/app.mjs'
import { createMcpHttp } from '../../src/mcp.mjs'
import { serve } from '../../src/http.mjs'

assert.equal(typeof global.gc, 'function', 'fixture requires --expose-gc')
const mode = process.argv[2]
const directory = await mkdtemp(join(tmpdir(), 'ivoraige-mcp-abort-gc-'))
const app = await createApp({ store: join(directory, 'records.sqlite') })
const client = new Client({ name: 'mcp-gc-regression', version: '1' })
let endpoint, server, native, releaseSchedule
const controllers = []
try {
  if (mode === 'standalone') {
    endpoint = createMcpHttp(app)
    native = createServer((req, res) => { void endpoint.handle(req, res).catch(() => res.destroy()) })
    await new Promise(resolve => native.listen(0, '127.0.0.1', resolve))
    server = { url: `http://127.0.0.1:${native.address().port}` }
  } else server = await serve(app, { port: 0 })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`)))
  const tasks = []
  const schedule = app.tasks.schedule
  releaseSchedule = () => { app.tasks.schedule = schedule; schedule.call(app.tasks) }
  app.tasks.schedule = () => {}
  for (let index = 0; index < 2; index++) {
    const { document } = await app.records.importDocument({ format: 'txt', content: `Source ${index}.` },
      { sourceId: `gc-${index}`, language: 'en' })
    const admitted = await app.operations.invoke('exportDocument',
      { docId: document.id, contentMode: 'source', outputs: [{ format: 'json' }] })
    tasks.push(admitted.taskId)
  }
  let active = 0, signalSubscribed
  const subscribed = new Promise(resolve => { signalSubscribed = resolve })
  const subscribe = app.operations.subscribe
  app.operations.subscribe = function (listener) {
    const remove = subscribe.call(this, listener)
    if (++active === 2) signalSubscribed()
    return () => { active--; remove() }
  }
  const signals = new Map()
  const wait = app.operations.waitTask
  app.operations.waitTask = function (id, seconds, signal) {
    if (seconds) signals.set(id, signal)
    return wait.call(this, id, seconds, signal)
  }
  const requests = tasks.map((taskId, index) => {
    const controller = new AbortController()
    controllers.push(controller)
    return fetch(`${server.url}/mcp`, { method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 42 + index, method: 'tools/call',
        params: { name: 'ivoraige_task_status', arguments: { taskId, waitSeconds: 10 } } }),
    }).catch(error => {
      if (error.name !== 'AbortError') throw error
    })
  })
  await subscribed
  // Reading a complete POST normally closes IncomingMessage before this point.
  // That is not a disconnected response and must not abort either invocation.
  assert.equal(active, 2)
  assert.equal(signals.get(tasks[0]).aborted, false)
  assert.equal(signals.get(tasks[1]).aborted, false)
  // Request.clone in the legacy SDK path has a weak controller on Node26.12.1.
  // Collect it while the actual HTTP request and tool subscription stay live.
  for (let sweep = 0; sweep < 8; sweep++) { await new Promise(setImmediate); global.gc() }
  controllers[0].abort()
  await requests[0]
  for (let attempt = 0; active !== 1 && attempt < 50; attempt++)
    await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(active, 1, 'aborted request must release exactly its own subscriber')
  assert.equal(signals.get(tasks[0]).aborted, true)
  assert.equal(signals.get(tasks[1]).aborted, false, 'another request must keep its own lifetime')
  for (const taskId of tasks) assert.equal(app.records.getTask(taskId).state, 'queued')
  releaseSchedule()
  await Promise.all(tasks.map(id => app.tasks.wait(id)))
  const response = await requests[1]
  assert.equal(response.status, 200)
  const text = await response.text()
  const message = text.split(/\r?\n/).filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6))).find(message => message.id === 43)
  assert.equal(message.result.structuredContent.task.state, 'succeeded')
  assert.equal(active, 0, 'normal terminal response must release the remaining subscriber')
  for (const taskId of tasks) assert.equal(app.records.getTask(taskId).state, 'succeeded')
  console.log(JSON.stringify({ mode, gcSweeps: 8, activeAfterOneAbort: 1,
    secondRequestNotCanceled: true, queuedTasksPreserved: true, terminal: 'succeeded', activeAtEnd: active }))
} finally {
  for (const controller of controllers) controller.abort()
  // Cleanup must also drain the unfixed baseline when the regression fails.
  await app.operationCatalog.close()
  releaseSchedule?.()
  await client.close()
  if (native) {
    const closed = new Promise(resolve => native.close(resolve))
    native.closeAllConnections()
    await endpoint.close()
    await closed
  } else await server?.close()
  await app.dispose()
  await rm(directory, { recursive: true, force: true })
}
