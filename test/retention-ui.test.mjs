import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'

const bundle = await readFile(new URL('../dist/web/app.js', import.meta.url), 'utf8')

function fixture() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'http://localhost/#/tasks', runScripts: 'outside-only', pretendToBeVisual: true,
  })
  const { window } = dom
  const calls = []
  const streams = []
  const ready = { subscriptionId: 'q02-ui-session', generation: 'q02-host', scope: {}, barrierRevision: 0 }
  let stateRevision = 0
  const task = { id: 'export.synthetic', kind: 'export', docId: 'doc', state: 'failed',
    createdAt: '2026-10-23T00:00:00.000Z', progress: { stage: 'export', done: 0, total: 1 },
    error: { stage: 'export', message: 'synthetic failure' } }
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.structuredClone = structuredClone
  window.EventSource = class {
    constructor(url) { this.url = url; this.listeners = new Map(); streams.push(this) }
    addEventListener(type, listener) { this.listeners.set(type, listener) }
    emit(type, data) { this.listeners.get(type)?.({ data: JSON.stringify(data) }) }
    close() { this.closed = true }
  }
  window.fetch = async (url, options = {}) => {
    const path = String(url).replace(/^\/api/, '')
    calls.push({ path, method: options.method ?? 'GET' })
    let data
    if (path.startsWith('/state?')) {
      assert.equal(path, '/state?subscriptionId=q02-ui-session')
      data = { ...ready, stateRevision, state: { tasks: [structuredClone(task)] } }
    } else if (path === '/capabilities') data = { features: ['tasks'], settingsPages: [] }
    else if (path.startsWith('/tasks?')) data = { items: [structuredClone(task)], nextCursor: null }
    else if (path === '/tasks/export.synthetic/abandon' && options.method === 'POST') {
      task.state = 'abandoned'
      data = { task: structuredClone(task) }
    } else throw new Error(`Unexpected request ${path}`)
    return { ok: true, status: 200, json: async () => data }
  }
  window.eval(bundle)
  return { window, calls, streams, ready, task,
    invalidate() {
      stateRevision++
      streams[0].emit('state.invalidated', { ...ready, type: 'state.invalidated', stateRevision })
    },
    close: () => window.close() }
}

async function until(check, message) {
  for (let i = 0; i < 100; i++) {
    const value = check()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(message)
}

test('failed task can be abandoned and renders its terminal label without a resume action', async () => {
  const app = fixture()
  try {
    const { window, calls } = app
    const button = await until(() => [...window.document.querySelectorAll('.task-card button')]
      .find(node => node.textContent === '放弃任务'), 'failed task abandonment action did not render')
    assert.ok([...window.document.querySelectorAll('.task-card button')]
      .some(node => node.textContent === '恢复'))
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, button: 0 }))
    await until(() => window.document.querySelector('.task-card .status-abandoned'),
      'abandoned task did not render')
    assert.equal(window.document.querySelector('.status-abandoned').textContent, '已放弃')
    assert.match(window.document.querySelector('.task-card').textContent, /synthetic failure/)
    assert.equal([...window.document.querySelectorAll('.task-card button')]
      .some(node => node.textContent === '恢复'), false)
    assert.equal(calls.filter(call => call.method === 'POST').length, 1)
    assert.equal(calls.find(call => call.method === 'POST').path, '/tasks/export.synthetic/abandon')
  } finally { app.close() }
})

test('state invalidation refreshes an abandoned task changed outside the UI', async () => {
  const app = fixture()
  try {
    const { window, task, streams, calls } = app
    await until(() => window.document.querySelector('.task-card .status-failed'), 'failed task did not render')
    const stream = await until(() => streams[0], 'state stream did not mount')
    assert.equal(stream.url, '/api/events/state')
    stream.emit('state.ready', app.ready)
    await until(() => window.document.querySelector('.connection.online'), 'ready snapshot did not synchronize')
    const reads = calls.filter(call => call.path.startsWith('/state?')).length
    task.state = 'abandoned'
    app.invalidate()
    await until(() => window.document.querySelector('.task-card .status-abandoned'),
      'abandon event did not refresh the task')
    assert.ok(calls.filter(call => call.path.startsWith('/state?')).length > reads,
      'invalidation must read the authoritative snapshot')
    assert.match(window.document.querySelector('.task-card').textContent, /synthetic failure/)
    assert.equal([...window.document.querySelectorAll('.task-card button')]
      .some(node => node.textContent === '恢复'), false)
    assert.equal(window.document.querySelector('.status-abandoned').textContent, '已放弃')
  } finally { app.close() }
})
