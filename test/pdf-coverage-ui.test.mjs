import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { mockOwnerSession } from './fixtures/browser-owner.mjs'

const bundle = await readFile(new URL('../dist/web/app.js', import.meta.url), 'utf8')

async function coverageText(sourceCoverage) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/#/workbench/doc', runScripts: 'outside-only', pretendToBeVisual: true,
  })
  const { window } = dom
  window.structuredClone = structuredClone
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.EventSource = class { addEventListener() {} close() {} }
  window.fetch = async url => {
    const path = String(url).replace(/^\/api/, '')
    let data
    if (path === '/capabilities') data = { features: ['workbench', 'documents'], settingsPages: [], inputFormats: [], outputFormats: [] }
    else if (path === '/documents/doc') data = { document: { id: 'doc', format: 'pdf',
      language: 'en', title: 'Invented document', unitCount: 3, availableOutputs: ['json'], sourceCoverage } }
    else if (path.startsWith('/documents/doc/units') || path.startsWith('/documents/doc/artifacts') ||
      path.startsWith('/documents/doc/snapshots') || path.startsWith('/tasks')) {
      data = { items: [], nextCursor: null }
    } else throw new Error(`Unexpected request ${path}`)
    return { ok: true, status: 200, json: async () => data }
  }
  mockOwnerSession(window)
  window.eval(bundle)
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const text = window.document.querySelector('.pdf-coverage')?.textContent
      if (text) return text
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.fail(`PDF coverage did not render: ${window.document.body.textContent.slice(0, 500)}`)
  } finally { window.close() }
}

test('PDF coverage labels callbacks and overlapping retained groups without claiming translation', async () => {
  const text = await coverageText({ called: 2, uncalled: [{ key: 'audit' }],
    summary: { unitCount: 3, callbackCount: 2, uncalledCount: 1,
      auditOnlyLineCount: 1, emptyUnitCount: 0 } })
  assert.match(text, /捕获单位 3 · 翻译回调 2 · 未进入回调但保留 1 · 其中行审计补录 1 · 空文本单位 0/)
  assert.match(text, /任务成功不等于全文已译/)
  assert.doesNotMatch(text, /可译段落|保留原文/)
})

test('older PDF coverage shows known legacy counts and unknown new counts', async () => {
  const text = await coverageText({ called: 1, uncalled: [{ key: 'retained' }] })
  assert.match(text, /捕获单位 — · 翻译回调 1 · 未进入回调但保留 1 · 其中行审计补录 — · 空文本单位 —/)
})
