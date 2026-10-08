import test from 'node:test'
import assert from 'node:assert/strict'
import { initialSettingsLocation, settingsLocation, settingsPageId, isSettingsPath,
  readSettingsHistory, settingsHistoryState, nextSettingsHistory, reverseSettingsTraversal, hashRoute } from '../web/settings-navigation.mjs'

test('hash routes reject malformed encoding without decoding model identifiers twice', () => {
  for (const hash of ['#/settings/%E0', '#/settings/%xx', '#other']) assert.equal(hashRoute(hash), '/')
  const route = hashRoute('#/settings/models?provider=a&model=literal%252Fvalue')
  assert.equal(new URLSearchParams(route.split('?')[1]).get('model'), 'literal%2Fvalue')
})

test('settings navigation preserves background through nested pages and direct entry has a fallback', () => {
  let state = initialSettingsLocation('/workbench/doc?unit=one')
  state = settingsLocation(state, '/settings/models')
  state = settingsLocation(state, '/settings/models?provider=openrouter&model=a%2Fb')
  state = settingsLocation(state, '/settings/pdf')
  assert.equal(state.background, '/workbench/doc?unit=one')
  assert.equal(settingsPageId(state.path), 'pdf')
  assert.equal(initialSettingsLocation('/settings/models').background, '/')
  assert.equal(isSettingsPath('/settings-elsewhere'), false)
  state = settingsLocation(state, '/documents')
  assert.equal(state.background, '/documents')
})

test('settings history tracks origin and reverses canceled traversal without rewriting entries', () => {
  const background = initialSettingsLocation('/workbench/doc?unit=one')
  const initial = { index: 4, origin: null, background: background.path }
  const opened = nextSettingsHistory(initial, background, '/settings/models')
  const models = settingsLocation(background, '/settings/models')
  const detail = nextSettingsHistory(opened, models, '/settings/models?provider=a&model=b')
  assert.deepEqual(opened, { index: 5, origin: 4, background: background.path })
  assert.deepEqual(detail, { index: 6, origin: 4, background: background.path })
  assert.equal(reverseSettingsTraversal(detail, opened), 1)
  assert.equal(reverseSettingsTraversal(detail, initial), 2)
  const preserved = settingsHistoryState({ unrelated: true }, detail)
  assert.equal(preserved.unrelated, true)
  assert.deepEqual(readSettingsHistory(preserved), detail)
  assert.equal(nextSettingsHistory(detail, settingsLocation(models, '/settings/pdf'), '/settings/models', true).index, 6)
  assert.equal(readSettingsHistory(null), null)
})
