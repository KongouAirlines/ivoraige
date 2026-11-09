import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

const bundle = await readFile(new URL('../dist/web/app.js', import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setTimeout(resolve, 10))
async function until(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return
    await tick()
  }
  assert.fail('Workbench did not reach the expected state')
}

test('reselecting the current unit preserves the editor and unsaved edits; switching still confirms', async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'http://localhost/#/workbench/doc', runScripts: 'outside-only', pretendToBeVisual: true,
  })
  const { window } = dom
  window.structuredClone = structuredClone
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.EventSource = class { addEventListener() {} close() {} }
  let confirms = 0, allowSwitch = false, detailReads = 0
  window.confirm = () => { confirms++; return allowSwitch }
  const units = ['Alpha', 'Beta'].map((sourceText, order) => ({
    id: `u${order}`, order, sourceText, kind: 'paragraph', translatable: true,
  }))
  window.fetch = async url => {
    const path = String(url).replace(/^\/api/, '').split('?')[0]
    let data
    if (path === '/capabilities') data = { features: ['workbench', 'documents'], settingsPages: [], inputFormats: [], outputFormats: [] }
    else if (path === '/documents/doc') data = { document: {
      id: 'doc', format: 'md', language: 'en', title: 'Synthetic selection', unitCount: 2, availableOutputs: ['md'],
    } }
    else if (path === '/documents/doc/units') data = { items: units, nextCursor: null }
    else if (/^\/units\/u[01]$/.test(path)) {
      detailReads++
      const unit = units.find(item => path.endsWith(item.id))
      data = { unit, accepted: { id: `r${unit.order}`, text: `Translation ${unit.order}` } }
    } else data = { items: [], nextCursor: null }
    return { ok: true, status: 200, json: async () => data }
  }
  try {
    window.eval(bundle)
    const editor = () => window.document.querySelector('textarea[aria-label="译文编辑"]')
    const choose = index => window.document.querySelectorAll('.unit-item button')[index].click()
    await until(() => editor()?.value === 'Translation 0')
    const initialReads = detailReads
    choose(0)
    await tick()
    assert.equal(editor()?.value, 'Translation 0', 'same selection must not unmount the loaded editor')
    assert.equal(detailReads, initialReads)
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setValue.call(editor(), 'Unsaved synthetic edit')
    editor().dispatchEvent(new window.Event('input', { bubbles: true }))
    await until(() => window.document.body.textContent.includes('尚未保存'))
    choose(0)
    await tick()
    assert.equal(editor()?.value, 'Unsaved synthetic edit')
    assert.equal(confirms, 0, 'same selection is not a request to discard edits')
    choose(1)
    await tick()
    assert.equal(confirms, 1)
    assert.equal(editor()?.value, 'Unsaved synthetic edit')
    allowSwitch = true
    choose(1)
    await until(() => editor()?.value === 'Translation 1')
    assert.equal(confirms, 2)
    assert.equal(detailReads, initialReads + 1)
    choose(0)
    await until(() => editor()?.value === 'Translation 0')
  } finally { window.close() }
})
