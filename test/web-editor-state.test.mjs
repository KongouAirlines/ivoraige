import assert from 'node:assert/strict'
import { test } from 'node:test'
import { refreshDisposition, savedEditIsCurrent } from '../web/editor-state.mjs'

test('export and translation refresh history without replacing the dirty edit or its save base', () => {
  const view = JSON.stringify(['doc', 'zh', 'unit-1'])
  assert.deepEqual(refreshDisposition(3, 3, view, view, true), { apply: true, replaceEditor: false })
  assert.deepEqual(refreshDisposition(4, 4, view, view, false), { apply: true, replaceEditor: true })
})

test('late responses cannot update a switched unit or supersede a newer load', () => {
  const first = JSON.stringify(['doc', 'zh', 'unit-1'])
  const second = JSON.stringify(['doc', 'zh', 'unit-2'])
  assert.deepEqual(refreshDisposition(2, 3, first, first, false), { apply: false, replaceEditor: false })
  assert.deepEqual(refreshDisposition(3, 3, first, second, false), { apply: false, replaceEditor: false })
})

test('save acknowledgement clears dirty state only for the submitted edit and view', () => {
  const first = JSON.stringify(['doc', 'zh', 'unit-1'])
  const second = JSON.stringify(['doc', 'zh', 'unit-2'])
  assert.equal(savedEditIsCurrent(first, first, 5, 5), true)
  assert.equal(savedEditIsCurrent(first, first, 5, 6), false)
  assert.equal(savedEditIsCurrent(first, second, 5, 5), false)
})
