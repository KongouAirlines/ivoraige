import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

const bundle = await readFile(new URL('../dist/web/app.js', import.meta.url), 'utf8')

const capabilities = {
  features: ['settings', 'workbench', 'documents', 'tasks'],
  settingsPages: [{ id: 'models', label: '模型', order: 10 }, { id: 'pdf', label: 'PDF', order: 20 }],
  inputFormats: ['txt', 'md'], components: {},
}
const modelSettings = { selected: null, savedModels: [], routes: {}, credentials: {},
  revisions: { routes: 1, selected: 1 } }

function fixture({ hash = '#/workbench/doc', modelReadFails = 0, deferModelSave = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `http://localhost/${hash}`, runScripts: 'outside-only', pretendToBeVisual: true,
  })
  const { window } = dom
  const calls = []
  let failures = modelReadFails
  let settings = structuredClone(modelSettings)
  let releaseSave
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.confirm = () => true
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  window.EventSource = class { addEventListener() {} close() {} }
  window.fetch = async (url, options = {}) => {
    const path = String(url).replace(/^\/api/, '')
    calls.push({ path, method: options.method ?? 'GET', body: options.body })
    if (path === '/settings/modelconfig' && failures-- > 0) {
      return { ok: false, status: 503, json: async () => ({ error: { message: 'temporary read failure' } }) }
    }
    if (path === '/settings/modelconfig' && options.method === 'PATCH' && deferModelSave) {
      await new Promise(resolve => { releaseSave = resolve })
    }
    let data
    if (path === '/capabilities') data = capabilities
    else if (path === '/tasks' || path.startsWith('/tasks?')) data = { items: [], nextCursor: null }
    else if (path === '/settings/modelconfig') {
      if (options.method === 'PATCH') {
        const body = JSON.parse(options.body)
        settings = { ...settings,
          routes: { ...settings.routes, [body.provider]: { apiKeyEnv: body.credentialRef } },
          savedModels: [{ provider: body.provider, model: body.model, timeoutMs: body.timeoutMs }],
        }
      }
      data = { settings }
    }
    else if (path === '/documents/doc') data = { document: {
      id: 'doc', title: 'Test document', language: 'en', format: 'txt', unitCount: 1,
      availableOutputs: ['md'],
    } }
    else if (path.startsWith('/documents/doc/units')) data = { items: [{
      id: 'unit-1', order: 0, kind: 'paragraph', translatable: true, sourceText: 'Source text',
    }], nextCursor: null }
    else if (path.startsWith('/units/unit-1/revisions')) data = { items: [], nextCursor: null }
    else if (path.startsWith('/units/unit-1')) data = {
      unit: { id: 'unit-1', order: 0, kind: 'paragraph', translatable: true, sourceText: 'Source text' },
      draft: null, accepted: null,
    }
    else if (path.startsWith('/documents/doc/artifacts') || path.startsWith('/documents/doc/snapshots')) {
      data = { items: [], nextCursor: null }
    } else if (path.startsWith('/documents?')) data = { items: [], nextCursor: null }
    else if (options.method && options.method !== 'GET') data = {}
    else throw new Error(`Unexpected request ${path}`)
    return { ok: true, status: 200, json: async () => data }
  }
  window.eval(bundle)
  return { window, calls, releaseSave: () => releaseSave?.(), close: () => window.close() }
}

async function until(check, message) {
  for (let i = 0; i < 100; i++) {
    const value = check()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(message)
}
function click(window, node) {
  assert.ok(node, 'expected clickable element')
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
}
function key(window, value, modifier = 'ctrlKey') {
  const event = new window.KeyboardEvent('keydown', { key: value, [modifier]: true, bubbles: true, cancelable: true })
  window.dispatchEvent(event)
  return event
}
function setInput(window, node, value) {
  const prototype = node instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set
  setter.call(node, value)
  node.dispatchEvent(new window.Event('input', { bubbles: true }))
}
function writes(calls) { return calls.filter(call => call.method !== 'GET') }

test('settings overlay preserves Workbench draft and suspends its shortcuts', async () => {
  const app = fixture()
  const { window, calls } = app
  try {
    const editor = await until(() => window.document.querySelector('textarea[aria-label="译文编辑"]'), 'Workbench editor did not load')
    setInput(window, editor, 'Unsaved translation')
    await until(() => window.document.body.textContent.includes('尚未保存'), 'draft was not marked dirty')
    click(window, window.document.querySelector('a[title="设置"]'))
    await until(() => window.document.querySelector('dialog[open] .settings-navigation button'), 'settings did not open')
    assert.equal(window.document.querySelector('textarea[aria-label="译文编辑"]'), editor)
    assert.equal(editor.value, 'Unsaved translation')
    for (const modifier of ['ctrlKey', 'metaKey']) {
      assert.equal(key(window, 'Enter', modifier).defaultPrevented, false)
      assert.equal(key(window, 'r', modifier).defaultPrevented, false)
    }
    assert.deepEqual(writes(calls), [])
    click(window, window.document.querySelector('button[aria-label="关闭设置"]'))
    await until(() => !window.document.querySelector('dialog[open]'), 'settings did not close')
    assert.equal(key(window, 'Enter').defaultPrevented, true)
    await until(() => writes(calls).some(call => call.path === '/units/unit-1' && call.method === 'PATCH'), 'save shortcut did not resume')
    assert.equal(key(window, 'r').defaultPrevented, true)
    await until(() => writes(calls).some(call => call.path === '/documents/doc/translate'), 'Workbench shortcut did not resume')
  } finally { app.close() }
})

test('nested settings Back cancellation preserves history and Forward returns to detail', async () => {
  const app = fixture()
  const { window } = app
  try {
    await until(() => window.document.querySelector('textarea[aria-label="译文编辑"]'), 'Workbench did not load')
    click(window, window.document.querySelector('a[title="设置"]'))
    await until(() => window.location.hash === '#/settings/models', 'models route did not open')
    const add = await until(() => [...window.document.querySelectorAll('dialog button')].find(button => button.textContent === '添加模型'), 'model list did not load')
    click(window, add)
    await until(() => window.location.hash.includes('new=1'), 'model detail route did not open')
    const provider = await until(() => window.document.querySelector('dialog input[placeholder="例如 deepseek"]'), 'model form did not mount')
    setInput(window, provider, 'pending-provider')
    setInput(window, window.document.querySelector('dialog input[placeholder="服务实际支持的模型 ID"]'), 'pending-model')
    await until(() => [...window.document.querySelectorAll('dialog button')].some(button => button.textContent === '仅保存' && !button.disabled), 'dirty model form did not commit')
    const detailHash = window.location.hash
    const historyLength = window.history.length
    window.history.back()
    const cancel = await until(() => [...window.document.querySelectorAll('.settings-confirm button')].find(button => button.textContent === '继续编辑'), 'dirty navigation did not prompt')
    click(window, cancel)
    await until(() => window.location.hash === detailHash && !window.document.querySelector('.settings-confirm'), 'canceled Back did not restore detail')
    assert.equal(window.history.length, historyLength)
    assert.equal(provider.value, 'pending-provider')
    window.history.back()
    const discard = await until(() => [...window.document.querySelectorAll('.settings-confirm button')].find(button => button.textContent === '放弃修改'), 'second Back did not prompt')
    click(window, discard)
    await until(() => window.location.hash === '#/settings/models' && !window.document.querySelector('.settings-confirm'), 'approved Back did not reach model list')
    window.history.forward()
    await until(() => window.location.hash === detailHash, 'Forward did not return to detail')
    assert.equal(window.history.length, historyLength)
  } finally { app.close() }
})

test('ordinary hash links establish the background and close skips settings pages', async () => {
  const app = fixture()
  const { window } = app
  try {
    await until(() => window.document.querySelector('textarea[aria-label="译文编辑"]'), 'Workbench did not load')
    click(window, window.document.querySelector('a[href="#/documents"]'))
    await until(() => window.location.hash === '#/documents', 'ordinary document link did not navigate')
    click(window, window.document.querySelector('a[title="设置"]'))
    await until(() => window.location.hash === '#/settings/models', 'settings did not open from documents')
    const pdf = await until(() => [...window.document.querySelectorAll('.settings-navigation button')].find(button => button.textContent === 'PDF'), 'PDF page did not register')
    click(window, pdf)
    await until(() => window.location.hash === '#/settings/pdf', 'nested PDF route did not open')
    click(window, window.document.querySelector('button[aria-label="关闭设置"]'))
    await until(() => window.location.hash === '#/documents' && !window.document.querySelector('dialog[open]'), 'close did not return to document history entry')
    assert.ok(window.document.querySelector('.page-head h1')?.textContent.includes('文档'))
  } finally { app.close() }
})

test('a pending model save blocks Back without a discard prompt', async () => {
  const app = fixture({ deferModelSave: true })
  const { window, calls } = app
  try {
    click(window, await until(() => window.document.querySelector('a[title="设置"]'), 'settings launcher missing'))
    const add = await until(() => [...window.document.querySelectorAll('dialog button')].find(button => button.textContent === '添加模型'), 'model list missing')
    click(window, add)
    const provider = await until(() => window.document.querySelector('dialog input[placeholder="例如 deepseek"]'), 'model form missing')
    setInput(window, provider, 'provider')
    setInput(window, window.document.querySelector('dialog input[placeholder="服务实际支持的模型 ID"]'), 'model')
    const save = await until(() => [...window.document.querySelectorAll('dialog button')].find(button => button.textContent === '仅保存' && !button.disabled), 'save did not enable')
    const detailHash = window.location.hash
    click(window, save)
    await until(() => calls.some(call => call.path === '/settings/modelconfig' && call.method === 'PATCH'), 'save request did not start')
    window.history.back()
    await until(() => window.location.hash === detailHash, 'busy Back was not reversed')
    assert.equal(window.document.querySelector('.settings-confirm'), null)
    assert.equal(calls.filter(call => call.path === '/settings/modelconfig' && call.method === 'PATCH').length, 1)
    app.releaseSave()
    await until(() => window.location.hash.includes('provider=provider'), 'save did not settle before teardown')
  } finally { app.releaseSave(); app.close() }
})

test('malformed direct settings hash falls back without mounting a settings dialog', async () => {
  const app = fixture({ hash: '#/settings/%E0%A4%A' })
  try {
    await until(() => app.window.document.querySelector('.app-shell'), 'app did not render')
    assert.equal(app.window.document.querySelector('dialog'), null)
  } finally { app.close() }
})

test('model load failure exposes a retry that reads successfully', async () => {
  const app = fixture({ hash: '#/settings/models', modelReadFails: 1 })
  const { window, calls } = app
  try {
    const retry = await until(() => [...window.document.querySelectorAll('dialog button')].find(button => button.textContent === '重试'), 'model retry missing')
    assert.match(window.document.querySelector('dialog').textContent, /temporary read failure/)
    click(window, retry)
    await until(() => window.document.querySelector('dialog .settings-heading h2')?.textContent === '已保存的模型', 'model settings did not recover')
    assert.equal(calls.filter(call => call.path === '/settings/modelconfig').length, 2)
  } finally { app.close() }
})

for (const identity of ['new', 'changed']) {
  for (const action of ['仅保存', '保存并用于翻译']) {
    test(`model save retains unsubmitted credential: ${identity}, ${action}`, async () => {
      const app = fixture({ hash: identity === 'new' ? '#/settings/models?new=1' : '#/settings/models?provider=original&model=original' })
      const { window, calls } = app
      const button = text => [...window.document.querySelectorAll('dialog button')].find(node => node.textContent === text)
      try {
        const provider = await until(() => window.document.querySelector('input[placeholder="例如 deepseek"]'), 'model form missing')
        setInput(window, provider, 'target-provider')
        setInput(window, window.document.querySelector('input[placeholder="服务实际支持的模型 ID"]'), 'target-model')
        click(window, button('凭据'))
        const secret = await until(() => window.document.querySelector('input[type="password"]'), 'credential tab missing')
        setInput(window, window.document.querySelector('.credential-form input:not([type="password"])'), 'TEST_KEY_REF')
        setInput(window, secret, 'test-only-unsaved-secret')
        click(window, await until(() => button(action)?.disabled === false && button(action), 'save not enabled'))
        await until(() => window.location.hash.includes('provider=target-provider') && window.document.querySelector('[role="status"]'), 'saved detail missing')
        assert.equal(window.document.querySelector('input[type="password"]').value, 'test-only-unsaved-secret')
        assert.equal(window.document.querySelector('.credential-form input:not([type="password"])').value, 'TEST_KEY_REF')
        assert.match(window.document.body.textContent, /API Key 尚未保存/)
        assert.equal(writes(calls).length, 1)
        assert.equal(writes(calls)[0].method, 'PATCH')
        assert.ok(!writes(calls)[0].body.includes('test-only-unsaved-secret'))
        click(window, window.document.querySelector('button[aria-label="关闭设置"]'))
        click(window, await until(() => button('继续编辑'), 'unsubmitted credential must guard closing'))
        await until(() => !window.document.querySelector('.settings-confirm'), 'close cancel did not settle')
        assert.equal(window.document.querySelector('input[type="password"]').value, 'test-only-unsaved-secret')
        click(window, button('保存凭据'))
        await until(() => window.document.querySelector('input[type="password"]').value === '', 'successful credential save must clear input')
        const credentialWrites = calls.filter(call => call.path === '/settings/credentials' && call.method === 'PUT')
        assert.equal(credentialWrites.length, 1)
        assert.deepEqual(JSON.parse(credentialWrites[0].body), { ref: 'TEST_KEY_REF', value: 'test-only-unsaved-secret' })
      } finally { app.close() }
    })
  }
}
