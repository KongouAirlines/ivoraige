import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const bundle = await readFile(new URL('../dist/web/app.js', import.meta.url), 'utf8')
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('UI did not reach expected state')
}
test('Chinese PDF selection uploads its declared language and can be selected again in English', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true })
  t.after(() => dom.window.close())
  const { window } = dom, imports = []
  window.structuredClone = structuredClone
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.EventSource = class { addEventListener() {} close() {} }
  window.fetch = async (url, options = {}) => {
    const path = String(url).replace(/^\/api/, '')
    if (path === '/documents/import') {
      imports.push(JSON.parse(options.body))
      return { ok: false, status: 503, json: async () => ({ error: { message: 'Synthetic server stop after observing upload' } }) }
    }
    const data = path === '/capabilities' ? { features: ['documents', 'tasks'], settingsPages: [], inputFormats: ['pdf'], components: {} } : { items: [], nextCursor: null }
    return { ok: true, status: 200, json: async () => data }
  }
  window.eval(bundle)
  await until(() => window.document.querySelector('input[type=file]')?.accept.includes('.pdf'))
  const input = window.document.querySelector('input[type=file]'), language = window.document.querySelector('.upload-language select')
  const file = new window.File(['%PDF-synthetic'], 'synthetic.pdf', { type: 'application/pdf' })
  // Model the native picker: choosing the same non-cleared value produces no change event.
  let selected = ''
  Object.defineProperty(input, 'value', { configurable: true, get: () => selected, set: value => { selected = value } })
  function choose(candidate = file) {
    if (selected === candidate.name) return
    selected = candidate.name
    Object.defineProperty(input, 'files', { configurable: true, value: [candidate] })
    input.dispatchEvent(new window.Event('change', { bubbles: true }))
  }
  language.value = 'zh'; language.dispatchEvent(new window.Event('change', { bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 0))
  choose()
  await until(() => imports.length === 1)
  assert.equal(imports[0].language, 'zh')
  await until(() => window.document.body.textContent.includes('Synthetic server stop'))
  assert.equal(input.value, '', 'failed selection must release native picker value')
  language.value = 'en'; language.dispatchEvent(new window.Event('change', { bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 0))
  choose()
  await until(() => imports.length === 2)
  assert.equal(imports[1].language, 'en')
  assert.equal(imports[1].title, file.name)
  await until(() => window.document.body.textContent.includes('Synthetic server stop'))
  assert.equal(input.value, '')
  choose()
  await until(() => imports.length === 3)
  await until(() => input.value === '')
  choose(new window.File([new Uint8Array(8 * 1024 * 1024)], 'oversized.pdf', { type: 'application/pdf' }))
  await until(() => window.document.body.textContent.includes('超过当前接口的 7 MB'))
  assert.equal(imports.length, 3)
  assert.equal(input.value, '', 'early validation must release native picker value')
})
