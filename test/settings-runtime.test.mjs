import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSettingsRuntime } from '../dist/settings-runtime-test.mjs'

const Model = () => null
const Pdf = () => null
const descriptors = {
  models: { id: 'models', label: '模型', order: 20 },
  pdf: { id: 'pdf', label: 'PDF', order: 10 },
}

test('DSH settings sections follow Cordis plugin mount and disposal', async () => {
  const runtime = createSettingsRuntime({ models: Model, pdf: Pdf })
  const seen = []
  const unsubscribe = runtime.subscribe(() => seen.push(runtime.getSnapshot().map(page => page.id)))
  assert.deepEqual(runtime.getSnapshot(), [])
  await runtime.sync([descriptors.models])
  assert.deepEqual(runtime.getSnapshot().map(page => page.id), ['models'])
  assert.equal(runtime.getSnapshot()[0].component, Model)
  await runtime.sync([descriptors.models, descriptors.pdf])
  assert.deepEqual(runtime.getSnapshot().map(page => page.id), ['pdf', 'models'])
  await runtime.sync([descriptors.pdf])
  assert.deepEqual(runtime.getSnapshot().map(page => page.id), ['pdf'])
  assert.equal(runtime.getSnapshot()[0].component, Pdf)
  await runtime.sync([])
  assert.deepEqual(runtime.getSnapshot(), [])
  assert.deepEqual(seen, [['models'], ['pdf', 'models'], ['pdf'], []])
  unsubscribe()
  await runtime.dispose()
})

test('rapid host updates publish only the final assembly', async () => {
  const runtime = createSettingsRuntime({ models: Model, pdf: Pdf })
  const seen = []
  runtime.subscribe(() => seen.push(runtime.getSnapshot().map(page => page.id)))
  const first = runtime.sync([descriptors.models])
  const second = runtime.sync([descriptors.pdf])
  await Promise.all([first, second])
  assert.deepEqual(runtime.getSnapshot().map(page => page.id), ['pdf'])
  assert.deepEqual(seen, [['pdf']])
  await runtime.dispose()
  assert.deepEqual(runtime.getSnapshot(), [])
})

test('superseding a removal with the same final set publishes the disposed page', async () => {
  const runtime = createSettingsRuntime({ models: Model, pdf: Pdf })
  await runtime.sync([descriptors.models, descriptors.pdf])
  const first = runtime.sync([descriptors.pdf])
  // Let the first reconciliation enter Cordis fiber disposal before a newer
  // capability result supersedes it with the same desired page set.
  await Promise.resolve()
  const latest = runtime.sync([descriptors.pdf])
  await Promise.all([first, latest])
  assert.deepEqual(runtime.getSnapshot().map(page => page.id), ['pdf'])
  await runtime.dispose()
})

test('unbundled pages are excluded and invalid descriptors keep current pages', async () => {
  const runtime = createSettingsRuntime({ models: Model })
  await runtime.sync([descriptors.models])
  const stable = runtime.getSnapshot()
  await runtime.sync([descriptors.models, descriptors.pdf])
  assert.equal(runtime.getSnapshot(), stable)
  await assert.rejects(runtime.sync([descriptors.models, descriptors.models]), /Duplicate/)
  assert.deepEqual(runtime.getSnapshot().map(page => page.id), ['models'])
  await runtime.dispose()
})
