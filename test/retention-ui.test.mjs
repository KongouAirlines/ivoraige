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
  const listeners = new Map()
  const task = { id: 'export.synthetic', kind: 'export', docId: 'doc', state: 'failed',
    createdAt: '2026-10-23T00:00:00.000Z', progress: { stage: 'export', done: 0, total: 1 },
    error: { stage: 'export', message: 'synthetic failure' } }
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.EventSource = class {
    addEventListener(type, listener) { listeners.set(type, listener) }
    close() {}
  }
  window.fetch = async (url, options = {}) => {
    const path = String(url).replace(/^\/api/, '')
    calls.push({ path, method: options.method ?? 'GET' })
    let data
    if (path === '/capabilities') data = { features: ['tasks'], settingsPages: [] }
    else if (path.startsWith('/tasks?')) data = { items: [structuredClone(task)], nextCursor: null }
    else if (path === '/tasks/export.synthetic/abandon' && options.method === 'POST') {
      task.state = 'abandoned'
      data = { task: structuredClone(task) }
    } else throw new Error(`Unexpected request ${path}`)
    return { ok: true, status: 200, json: async () => data }
  }
  window.eval(bundle)
  return { window, calls, listeners, task, close: () => window.close() }
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

test('task.abandoned event refreshes a task that changed outside the UI', async () => {
  const app = fixture()
  try {
    const { window, task, listeners } = app
    await until(() => window.document.querySelector('.task-card .status-failed'), 'failed task did not render')
    task.state = 'abandoned'
    listeners.get('task.abandoned')()
    await until(() => window.document.querySelector('.task-card .status-abandoned'),
      'abandon event did not refresh the task')
    assert.equal(window.document.querySelector('.status-abandoned').textContent, '已放弃')
  } finally { app.close() }
})
