import test from 'node:test'
import assert from 'node:assert/strict'
import { assertArtifactFormats, closeBestEffort } from '../scripts/smoke-mcp-pdf-helpers.mjs'

test('PDF smoke requires each requested artifact exactly once', () => {
  const artifacts = formats => formats.map(format => ({ format }))
  assert.doesNotThrow(() => assertArtifactFormats(artifacts(['json', 'pdf', 'md'])))
  assert.throws(() => assertArtifactFormats(artifacts(['pdf', 'md'])), /Expected exactly one artifact/)
  assert.throws(() => assertArtifactFormats(artifacts(['pdf', 'md', 'md', 'json'])), /Expected exactly one artifact/)
  assert.throws(() => assertArtifactFormats(artifacts(['pdf', 'md', 'txt'])), /Expected exactly one artifact/)
})

test('PDF smoke cleanup attempts every resource and reports all failures', async () => {
  const attempted = []
  const errors = await closeBestEffort([
    ['client', async () => { attempted.push('client'); throw Error('client close failed') }],
    ['server', async () => { attempted.push('server') }],
    ['app', async () => { attempted.push('app'); throw Error('app dispose failed') }],
  ])
  assert.deepEqual(attempted, ['client', 'server', 'app'])
  assert.deepEqual(errors.map(item => item.name), ['client', 'app'])
  assert.deepEqual(errors.map(item => item.error.message), ['client close failed', 'app dispose failed'])
})
