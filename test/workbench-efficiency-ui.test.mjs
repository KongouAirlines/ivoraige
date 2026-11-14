import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import {
  computeWordDiff,
  extractPdfPlaceholders,
  filterWorkbenchUnits,
  insertAtSelection,
  validatePdfPlaceholders,
} from '../web/workbench-helpers.mjs'

const bundle = await readFile(new URL('../dist/web/app.js', import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setTimeout(resolve, 10))

async function until(check, message = 'Workbench did not reach expected state') {
  for (let attempt = 0; attempt < 120; attempt++) {
    const value = check()
    if (value) return value
    await tick()
  }
  assert.fail(message)
}

test('workbench-helpers: extractPdfPlaceholders and validatePdfPlaceholders detect missing, extra, and reordered tags', () => {
  assert.deepEqual(extractPdfPlaceholders('Plain text without tags'), [])
  assert.deepEqual(
    extractPdfPlaceholders('Read <b1>important</b1> formula <f1> carefully.'),
    ['<b1>', '</b1>', '<f1>']
  )

  const valid = validatePdfPlaceholders(
    'Read <b1>important</b1> formula <f1>.',
    '请仔细阅读 <b1>重要</b1> 公式 <f1>。'
  )
  assert.equal(valid.valid, true)
  assert.match(valid.message, /占位符完整 \(3\/3\)/)

  const missing = validatePdfPlaceholders(
    'Read <b1>important</b1> formula <f1>.',
    '请仔细阅读 <b1>重要 公式。'
  )
  assert.equal(missing.valid, false)
  assert.deepEqual(missing.missing, ['</b1>', '<f1>'])
  assert.match(missing.message, /缺少 <\/b1> <f1>/)

  const reordered = validatePdfPlaceholders(
    'Read <b1>important</b1>.',
    '请阅读 </b1>重要<b1>。'
  )
  assert.equal(reordered.valid, false)
  assert.equal(reordered.orderMismatch, true)
  assert.match(reordered.message, /顺序不符/)
})

test('workbench-helpers: insertAtSelection, filterWorkbenchUnits, and computeWordDiff work accurately', () => {
  const inserted = insertAtSelection('你好世界', 2, 2, '<b1>')
  assert.equal(inserted.text, '你好<b1>世界')
  assert.equal(inserted.cursor, 6)

  const units = [
    { id: 'u1', order: 0, sourceText: 'Introduction to Quantum Mechanics', kind: 'heading', translatable: true, locator: { page: 1 } },
    { id: 'u2', order: 1, sourceText: 'Second paragraph on wavefunctions', kind: 'paragraph', translatable: true, draftRevisionId: 'r2', locator: { page: 2 } },
    { id: 'u3', order: 2, sourceText: 'Conclusion and outlook', kind: 'paragraph', translatable: true, acceptedRevisionId: 'r3', locator: { page: 2 } },
  ]
  assert.deepEqual(
    filterWorkbenchUnits(units, { query: 'p:2' }).map(u => u.id),
    ['u2', 'u3']
  )
  assert.deepEqual(
    filterWorkbenchUnits(units, { query: '#2' }).map(u => u.id),
    ['u2']
  )
  assert.deepEqual(
    filterWorkbenchUnits(units, { query: 'quantum' }).map(u => u.id),
    ['u1']
  )

  const diff = computeWordDiff('初版译文测试', '修订版译文测试通过')
  assert.ok(diff.some(part => part.type === 'del' && part.text.includes('初')))
  assert.ok(diff.some(part => part.type === 'add' && part.text.includes('修订')))
  assert.ok(diff.some(part => part.type === 'same' && part.text.includes('版译文测试')))
})

test('Workbench supports PDF placeholder chips, one-step Save & Accept, keyboard navigation, search, batch accept, and diff view', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/#/workbench/doc',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  const { window } = dom
  window.structuredClone = structuredClone
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.EventSource = class { addEventListener() {} close() {} }
  window.confirm = () => true
  window.requestAnimationFrame = fn => setTimeout(fn, 0)

  const calls = []
  const units = [
    {
      id: 'u0',
      order: 0,
      sourceText: 'Observe <b1>bold</b1> and <f1> here.',
      kind: 'paragraph',
      translatable: true,
      locator: { page: 1 },
    },
    {
      id: 'u1',
      order: 1,
      sourceText: 'Second unit on page two.',
      kind: 'paragraph',
      translatable: true,
      draftRevisionId: 'rev-u1-draft',
      locator: { page: 2 },
    },
  ]
  const unitDetails = {
    u0: {
      unit: units[0],
      draft: null,
      accepted: null,
      revisions: [],
    },
    u1: {
      unit: units[1],
      draft: { id: 'rev-u1-draft', text: '第二段模型草稿。', origin: 'machine', status: 'draft', createdAt: '2026-11-14T00:00:00.000Z' },
      accepted: null,
      revisions: [
        { id: 'rev-u1-old', text: '第二段初版草稿。', origin: 'machine', status: 'superseded', createdAt: '2026-11-13T00:00:00.000Z' },
        { id: 'rev-u1-draft', text: '第二段模型草稿。', origin: 'machine', status: 'draft', createdAt: '2026-11-14T00:00:00.000Z' },
      ],
    },
  }

  window.fetch = async (url, options = {}) => {
    const rawPath = String(url).replace(/^\/api/, '')
    const path = rawPath.split('?')[0]
    const method = options.method ?? 'GET'
    const body = options.body ? JSON.parse(options.body) : undefined
    calls.push({ path, method, body })

    let data
    if (path === '/capabilities') {
      data = { features: ['workbench', 'documents'], settingsPages: [], inputFormats: ['pdf'], outputFormats: ['pdf', 'md'] }
    } else if (path === '/documents/doc') {
      data = {
        document: {
          id: 'doc',
          format: 'pdf',
          language: 'en',
          title: 'PDF Efficiency Doc',
          unitCount: 2,
          availableOutputs: ['pdf', 'md'],
        },
      }
    } else if (path === '/documents/doc/units') {
      data = { items: structuredClone(units), nextCursor: null }
    } else if (path === '/units/u0' && method === 'GET') {
      data = { unit: unitDetails.u0.unit, draft: unitDetails.u0.draft, accepted: unitDetails.u0.accepted }
    } else if (path === '/units/u1' && method === 'GET') {
      data = { unit: unitDetails.u1.unit, draft: unitDetails.u1.draft, accepted: unitDetails.u1.accepted }
    } else if (path === '/units/u0/revisions') {
      data = { items: unitDetails.u0.revisions, nextCursor: null }
    } else if (path === '/units/u1/revisions') {
      data = { items: unitDetails.u1.revisions, nextCursor: null }
    } else if (path === '/units/u0' && method === 'PATCH') {
      const rev = {
        id: 'rev-u0-1',
        text: body.text,
        origin: 'human',
        status: 'draft',
        createdAt: '2026-11-14T01:00:00.000Z',
      }
      unitDetails.u0.draft = rev
      unitDetails.u0.revisions.push(rev)
      units[0].draftRevisionId = rev.id
      data = { revision: rev }
    } else if (path === '/revisions/rev-u0-1/accept' && method === 'POST') {
      unitDetails.u0.accepted = { ...unitDetails.u0.draft, status: 'accepted' }
      unitDetails.u0.draft = null
      units[0].acceptedRevisionId = 'rev-u0-1'
      data = { acceptedRevisionId: 'rev-u0-1' }
    } else if (path === '/revisions/rev-u1-draft/accept' && method === 'POST') {
      unitDetails.u1.accepted = { ...unitDetails.u1.draft, status: 'accepted' }
      unitDetails.u1.draft = null
      units[1].acceptedRevisionId = 'rev-u1-draft'
      data = { acceptedRevisionId: 'rev-u1-draft' }
    } else {
      data = { items: [], nextCursor: null }
    }
    return { ok: true, status: 200, json: async () => data }
  }

  try {
    window.eval(bundle)
    const editor = () => window.document.querySelector('textarea[aria-label="译文编辑"]')
    await until(() => editor(), 'Workbench editor did not mount')

    // 1. Placeholder toolbar renders for u0 and blocks Save & Accept when tags are missing
    const toolbar = await until(
      () => window.document.querySelector('.placeholder-toolbar'),
      'PDF placeholder toolbar did not mount'
    )
    assert.match(toolbar.textContent, /缺少 <b1> <\/b1> <f1>/)

    const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setValue.call(editor(), '观察粗体与公式')
    editor().dispatchEvent(new window.Event('input', { bubbles: true }))

    const saveAndAcceptBtn = await until(
      () => [...window.document.querySelectorAll('.editor-actions button')].find(b => b.textContent === '保存并接受'),
      'Save & Accept button did not render when dirty'
    )
    assert.equal(saveAndAcceptBtn.disabled, true, 'Save & Accept must be disabled while PDF placeholders are missing')

    // Click "一键补齐缺失标记" to insert all missing placeholders
    const fillBtn = [...toolbar.querySelectorAll('button')].find(b => b.textContent.includes('一键补齐缺失标记'))
    assert.ok(fillBtn, 'expected missing placeholder quick-fill button')
    fillBtn.click()
    await until(() => editor()?.value.includes('<b1></b1><f1>'), 'Quick-fill did not insert missing placeholders')
    assert.match(toolbar.textContent, /✓ 占位符完整 \(3\/3\)/)
    assert.equal(saveAndAcceptBtn.disabled, false)

    // 2. Click "保存并接受" -> saves u0, accepts rev-u0-1, and automatically advances to u1!
    saveAndAcceptBtn.click()
    await until(
      () => editor()?.value === '第二段模型草稿。',
      'Save & Accept did not advance to the next unit u1'
    )
    assert.ok(calls.some(c => c.path === '/units/u0' && c.method === 'PATCH'))
    assert.ok(calls.some(c => c.path === '/revisions/rev-u0-1/accept' && c.method === 'POST'))

    // 3. Revision diff toggle in u1
    const diffBtn = await until(
      () => [...window.document.querySelectorAll('.history button')].find(b => b.textContent === '对比差异'),
      'Diff toggle button did not render'
    )
    diffBtn.click()
    await until(() => window.document.querySelector('.diff-view'), 'Diff view did not render')

    // 4. Unit search & Select-All & Batch Accept
    const searchInput = window.document.querySelector('input[aria-label="搜索段落"]')
    assert.ok(searchInput, 'expected unit search input')
    const setInputValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setInputValue.call(searchInput, 'p:2')
    searchInput.dispatchEvent(new window.Event('input', { bubbles: true }))
    await until(
      () => window.document.querySelectorAll('.unit-item').length === 1,
      'Page search p:2 did not filter unit list to 1 item'
    )

    const selectAllBtn = [...window.document.querySelectorAll('.workbench-toolbar button')].find(b => b.textContent === '全选')
    assert.ok(selectAllBtn, 'expected Select All button')
    selectAllBtn.click()

    const batchAcceptBtn = await until(
      () => [...window.document.querySelectorAll('.workbench-toolbar button')].find(b => b.textContent.includes('接受所选草稿')),
      'Batch accept button did not appear after selecting draft unit'
    )
    batchAcceptBtn.click()
    await until(
      () => calls.some(c => c.path === '/revisions/rev-u1-draft/accept' && c.method === 'POST'),
      'Batch accept did not accept rev-u1-draft'
    )
  } finally {
    window.close()
  }
})
