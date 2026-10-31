import test from 'node:test'
import assert from 'node:assert/strict'
import { ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'
import { serve } from '../src/http.mjs'
import { runCli } from '../src/cli.mjs'

const turn = () => new Promise(resolve => setImmediate(resolve))

test('serve observes a programmatic abort after listening and releases its owned host', { timeout: 10000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-cli-abort-'))
  const store = join(dir, 'store.sqlite')
  const controller = new AbortController()
  const listeners = ['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name))
  let ready, stderr = '', finished = false
  const started = new Promise(resolve => { ready = resolve })
  const running = runCli(['serve', '--store', store, '--port', '0', '--no-mcp'], {
    signal: controller.signal, stdout: { write: text => ready(text.trim()) },
    stderr: { write: text => { stderr += text } },
  }).finally(() => { finished = true })
  t.after(async () => {
    controller.abort()
    if (!finished) process.emit('SIGINT') // Also releases the unfixed baseline for this regression.
    await running
    await rm(dir, { recursive: true, force: true })
  })
  const url = await started
  assert.equal((await fetch(url + '/api/documents')).status, 200)
  controller.abort()
  let timer
  try {
    assert.equal(await Promise.race([running, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('serve did not stop after abort')), 1500)
    })]), 0, stderr)
  } finally { clearTimeout(timer) }
  assert.deepEqual(['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name)), listeners)
  await assert.rejects(fetch(url + '/api/documents'))
  const reopened = await createApp({ store })
  await reopened.dispose()
})

test('state SSE pauses on backpressure, resumes retained notices, and preserves bounded overflow and cleanup',
  { timeout: 10000 }, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'ivoraige-sse-pressure-'))
    const app = await createApp({ store: join(dir, 'store.sqlite') })
    const server = await serve(app, { port: 0, mcp: false })
    const controller = new AbortController()
    let response, blockNext = true
    const frames = []
    const write = ServerResponse.prototype.write
    t.mock.method(ServerResponse.prototype, 'write', function(chunk, ...args) {
      const result = write.call(this, chunk, ...args)
      if (this.req.url !== '/api/events/state') return result
      response = this
      frames.push(String(chunk))
      if (blockNext) { blockNext = false; return false }
      return result
    })
    t.after(async () => {
      controller.abort()
      await server.close()
      await app.dispose()
      await rm(dir, { recursive: true, force: true })
    })
    const stream = await fetch(server.url + '/api/events/state', { signal: controller.signal })
    assert.equal(stream.status, 200)
    await stream.body.getReader().read()
    const session = [...app.events.sessions.values()][0]
    app.events.publish('task.changed')
    await turn()
    assert.equal(response.destroyed, false)
    assert.equal(frames.length, 1, 'no write before drain')
    blockNext = true
    response.emit('drain')
    assert.equal(frames.length, 2)
    assert.match(frames[1], /event: state.invalidated/)
    app.events.publish('task.changed')
    await turn()
    assert.equal(frames.length, 2)
    response.emit('drain')
    assert.equal(frames.length, 3, 'each retained notice is sent once')
    blockNext = true
    app.events.publish('task.changed')
    await turn()
    assert.equal(frames.length, 4)
    for (let i = 0; i < 130; i++) app.events.publish('task.changed')
    await turn()
    assert.equal(frames.length, 4)
    assert.equal(session.drain().length, 1)
    response.emit('drain')
    assert.equal(frames.length, 5)
    assert.match(frames[4], /event: resync-required/)
    assert.match(frames[4], /buffer-overflow/)
    response.emit('drain')
    assert.equal(frames.length, 5)
    await server.close()
    assert.equal(app.events.sessions.size, 0)
    assert.equal(response.listenerCount('drain'), 0)
  })

test('a real oversized state notice survives native HTTP backpressure without duplication',
  { timeout: 10000 }, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'ivoraige-sse-large-'))
    const app = await createApp({ store: join(dir, 'store.sqlite') })
    const server = await serve(app, { port: 0, mcp: false })
    const controller = new AbortController()
    const results = []
    const write = ServerResponse.prototype.write
    t.mock.method(ServerResponse.prototype, 'write', function(chunk, ...args) {
      const result = write.call(this, chunk, ...args)
      if (this.req.url === '/api/events/state') results.push(result)
      return result
    })
    t.after(async () => {
      controller.abort()
      await server.close()
      await app.dispose()
      await rm(dir, { recursive: true, force: true })
    })
    const response = await fetch(server.url + '/api/events/state', { signal: controller.signal })
    const reader = response.body.getReader(), decoder = new TextDecoder()
    let pending = ''
    async function frame() {
      while (!pending.includes('\n\n')) {
        const { value, done } = await reader.read()
        assert.equal(done, false)
        pending += decoder.decode(value, { stream: true })
      }
      const end = pending.indexOf('\n\n'), result = pending.slice(0, end)
      pending = pending.slice(end + 2)
      return JSON.parse(result.split('\n').find(line => line.startsWith('data: ')).slice(6))
    }
    await frame()
    const data = { detail: 'x'.repeat(256 * 1024) }
    const first = app.events.publish('task.changed', { data })
    const notice = await frame()
    assert.equal(notice.stateRevision, first.stateRevision)
    assert.deepEqual(notice.event.data, data)
    assert.ok(results.includes(false), 'native write must exercise high-water mark')
    const second = app.events.publish('task.changed')
    assert.equal((await frame()).stateRevision, second.stateRevision, 'accepted large frame is not resent')
    assert.equal(results.length, 3)
  })
