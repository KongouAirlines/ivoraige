import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

const bundle = await readFile(new URL('../dist/web/app.js', import.meta.url), 'utf8')

function fixture(hash = '#/settings/pdf', { localFailsOnce = false, catalogFailsSecond = false,
  credentialInitiallyConfigured = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `http://localhost/${hash}`, runScripts: 'outside-only', pretendToBeVisual: true,
  })
  const { window } = dom
  const calls = []
  let credentialConfigured = credentialInitiallyConfigured, installed = false, restartRequired = false
  let localRequests = 0, catalogRequests = 0
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  window.EventSource = class { addEventListener() {} close() {} }
  window.fetch = async (url, options = {}) => {
    const path = String(url).replace(/^\/api/, '')
    const method = options.method ?? 'GET'
    const body = options.body && JSON.parse(options.body)
    calls.push({ path, method, body })
    let data
    if (path === '/capabilities') data = { features: ['settings', 'documents', 'tasks', 'component-installation'],
      settingsPages: [{ id: 'pdf', label: 'PDF', order: 20 }], inputFormats: ['txt', 'md'], outputFormats: ['md', 'json'], components: {} }
    else if (path.startsWith('/documents') || path.startsWith('/tasks?') || path === '/tasks') data = { items: [], nextCursor: null }
    else if (path === '/components' && method === 'GET') data = {
      repository: 'KongouAirlines/private-components', releaseTag: 'v0.1.0', credentialConfigured,
      installed: installed ? { id: 'babeldoc', version: 'v0.1.0' } : null, restartRequired, task: null,
    }
    else if (path === '/components/credential') {
      credentialConfigured = method === 'POST'
      data = { credentialConfigured }
    }
    else if (path === '/components/catalog') {
      catalogRequests++
      if (catalogFailsSecond && catalogRequests === 2) return { ok: false, status: 429,
        json: async () => ({ error: { code: 'UPSTREAM_FAILURE', message: 'GitHub rate limit reached; retry later' } }) }
      data = { catalog: { releaseTag: 'v0.1.0',
        components: [{ id: 'babeldoc', version: 'v0.1.0', platform: 'win32', arch: 'x64', size: 134217728 }] } }
    }
    else if (path === '/components/install') data = { taskId: 'install.1' }
    else if (path === '/components/local') data = { taskId: `local.${++localRequests}` }
    else if (path === '/components/tasks/install.1') {
      installed = true; restartRequired = true
      data = { task: { taskId: 'install.1', state: 'completed', progress: 'Installed' } }
    } else if (path.startsWith('/components/tasks/local.')) {
      const failed = localFailsOnce && path.endsWith('local.1')
      if (!failed) { installed = true; restartRequired = true }
      data = { task: { taskId: path.split('/').at(-1), state: failed ? 'failed' : 'completed',
        progress: failed ? 'Verification failed' : 'Installed', error: failed ? 'Archive checksum mismatch' : null } }
    } else throw new Error(`Unexpected request ${method} ${path}`)
    return { ok: true, status: 200, json: async () => data }
  }
  window.eval(bundle)
  return { window, calls, close: () => window.close() }
}
async function until(check, message) {
  for (let i = 0; i < 100; i++) {
    const value = check()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(message)
}
function click(window, element) {
  assert.ok(element)
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
}
function setInput(window, element, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(element, value)
  element.dispatchEvent(new window.Event('input', { bubbles: true }))
}
const button = (window, label) => [...window.document.querySelectorAll('dialog button')]
  .find(element => element.textContent.trim() === label)

test('PDF installer saves private token, installs through task polling, and asks for manual restart', async () => {
  const app = fixture()
  const { window, calls } = app
  try {
    const token = await until(() => window.document.querySelector('dialog input[type="password"]'), 'PDF settings did not mount')
    assert.ok(window.document.querySelector('dialog').textContent.includes('未安装'))
    assert.match(window.document.querySelector('dialog a[href="./pdf-guide.html"]').href, /\/pdf-guide\.html$/)
    setInput(window, token, 'private-test-token')
    click(window, button(window, '保存令牌'))
    await until(() => calls.some(call => call.path === '/components/credential'), 'credential was not submitted')
    assert.equal(calls.find(call => call.path === '/components/credential').body.token, 'private-test-token')
    await until(() => !token.value && !button(window, '检查可用版本').disabled, 'credential was not cleared')
    click(window, button(window, '检查可用版本'))
    await until(() => !button(window, '安装 BabelDOC').disabled, 'catalog did not enable install')
    assert.match(window.document.querySelector('dialog').textContent, /win32\/x64 · 总大小 128\.00 MiB/)
    assert.ok(window.document.querySelector('dialog input[placeholder="填写运行服务的电脑上的完整路径"]'))
    click(window, button(window, '安装 BabelDOC'))
    await until(() => window.document.body.textContent.includes('请保存当前工作后手动重启服务'), 'manual restart notice missing')
    assert.equal(calls.find(call => call.path === '/components/install').body.id, 'babeldoc')
    assert.ok(calls.some(call => call.path === '/components/tasks/install.1'))
    assert.equal(window.location.hash, '#/settings/pdf')
  } finally { app.close() }
})

test('PDF installer can inspect and install a public release without saving a token', async () => {
  const app = fixture()
  const { window, calls } = app
  try {
    const token = await until(() => window.document.querySelector('dialog input[type="password"]'), 'PDF settings did not mount')
    assert.match(token.closest('label').textContent, /可选/)
    assert.match(window.document.querySelector('dialog').textContent, /匿名访问公开发布源/)
    const catalogButton = button(window, '检查可用版本')
    await until(() => !catalogButton.disabled, 'anonymous catalog action was disabled')
    click(window, catalogButton)
    await until(() => !button(window, '安装 BabelDOC').disabled, 'anonymous installation was disabled')
    click(window, button(window, '安装 BabelDOC'))
    await until(() => window.document.body.textContent.includes('请保存当前工作后手动重启服务'),
      'anonymous installation did not complete')
    assert.equal(calls.filter(call => call.path === '/components/credential').length, 0)
    assert.ok(calls.some(call => call.path === '/components/catalog'))
    assert.ok(calls.some(call => call.path === '/components/install'))
  } finally { app.close() }
})

test('explicitly clearing a saved token enables anonymous setup and preserves an unsaved replacement', async () => {
  const app = fixture('#/settings/pdf', { credentialInitiallyConfigured: true })
  const { window, calls } = app
  try {
    const token = await until(() => window.document.querySelector('dialog input[type="password"]'), 'PDF token field missing')
    const clearButton = await until(() => button(window, '移除已保存令牌'), 'clear action missing')
    setInput(window, token, 'unsaved-replacement')
    click(window, clearButton)
    await until(() => calls.some(call => call.path === '/components/credential' && call.method === 'DELETE'),
      'saved token was not removed')
    await until(() => window.document.querySelector('dialog').textContent.includes('匿名访问公开发布源'),
      'anonymous state was not shown')
    assert.equal(token.value, 'unsaved-replacement')
    assert.equal(calls.filter(call => call.path === '/components/credential' && call.method === 'POST').length, 0)
    click(window, window.document.querySelector('button[aria-label="关闭设置"]'))
    const continueEditing = await until(() => [...window.document.querySelectorAll('.settings-confirm button')]
      .find(element => element.textContent === '继续编辑'), 'unsaved replacement was not guarded')
    click(window, continueEditing)
    await until(() => !window.document.querySelector('.settings-confirm'), 'discard decision did not settle')
    assert.equal(token.value, 'unsaved-replacement')
    click(window, button(window, '保存令牌'))
    await until(() => calls.some(call => call.path === '/components/credential' && call.method === 'POST'),
      'replacement token was not submitted')
    assert.equal(calls.find(call => call.path === '/components/credential' && call.method === 'POST').body.token,
      'unsaved-replacement')
  } finally { app.close() }
})

test('failed catalog refresh clears the old install choice and shows retry guidance', async () => {
  const app = fixture('#/settings/pdf', { catalogFailsSecond: true })
  const { window, calls } = app
  try {
    const catalogButton = await until(() => button(window, '检查可用版本'), 'catalog button missing')
    await until(() => !catalogButton.disabled, 'catalog button unavailable')
    click(window, catalogButton)
    await until(() => !button(window, '安装 BabelDOC').disabled, 'first catalog did not load')
    click(window, catalogButton)
    await until(() => window.document.querySelector('dialog').textContent.includes('GitHub rate limit reached'),
      'rate limit guidance missing')
    assert.equal(button(window, '安装 BabelDOC').disabled, true)
    assert.equal(calls.filter(call => call.path === '/components/install').length, 0)
  } finally { app.close() }
})

test('first empty workspace offers optional PDF setup once and can dismiss it', async () => {
  const app = fixture('#/')
  const { window } = app
  try {
    const prompt = await until(() => [...window.document.querySelectorAll('.quiet-panel')]
      .find(element => element.textContent.includes('PDF 组件按需安装')), 'PDF onboarding not shown')
    assert.equal(prompt.querySelector('a[href="#/settings/pdf"]')?.textContent, '安装 PDF')
    click(window, [...prompt.querySelectorAll('button')].find(element => element.textContent === '稍后设置'))
    await until(() => !window.document.body.textContent.includes('PDF 组件按需安装'), 'PDF onboarding was not dismissed')
    assert.equal(window.localStorage.getItem('ivoraige.0.1.0.pdf-onboarding-dismissed'), '1')
  } finally { app.close() }
})

test('unsaved PDF token blocks closing settings until the user decides', async () => {
  const app = fixture()
  const { window, calls } = app
  try {
    const token = await until(() => window.document.querySelector('dialog input[type="password"]'), 'PDF token field missing')
    setInput(window, token, 'not-yet-saved')
    click(window, window.document.querySelector('button[aria-label="关闭设置"]'))
    const continueEditing = await until(() => [...window.document.querySelectorAll('.settings-confirm button')]
      .find(element => element.textContent === '继续编辑'), 'unsaved token did not trigger discard guard')
    click(window, continueEditing)
    await until(() => !window.document.querySelector('.settings-confirm'), 'discard decision did not settle')
    assert.equal(token.value, 'not-yet-saved')
    assert.equal(calls.filter(call => call.path === '/components/credential').length, 0)
    await new Promise(resolve => setTimeout(resolve, 20))
  } finally { app.close() }
})

test('failed local install keeps manifest path for retry and clears it only on success', async () => {
  const app = fixture('#/settings/pdf', { localFailsOnce: true })
  const { window, calls } = app
  try {
    const path = await until(() => window.document.querySelector('dialog input[placeholder="填写运行服务的电脑上的完整路径"]'),
      'local manifest field missing')
    setInput(window, path, '/srv/pdf/components-manifest.json')
    click(window, button(window, '从本地包安装'))
    await until(() => window.document.querySelector('dialog').textContent.includes('Archive checksum mismatch'),
      'failed install was not shown')
    assert.equal(path.value, '/srv/pdf/components-manifest.json')
    await until(() => !button(window, '从本地包安装').disabled, 'retry did not become available')
    click(window, button(window, '从本地包安装'))
    await until(() => calls.filter(call => call.path === '/components/local').length === 2, 'retry was not submitted')
    assert.deepEqual(calls.filter(call => call.path === '/components/local').map(call => call.body.path),
      ['/srv/pdf/components-manifest.json', '/srv/pdf/components-manifest.json'])
    await until(() => !path.value, 'successful install did not clear manifest path')
  } finally { app.close() }
})
