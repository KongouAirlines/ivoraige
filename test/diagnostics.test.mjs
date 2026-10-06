import test from 'node:test'
import assert from 'node:assert/strict'
import { errorEnvelope } from '../src/protocol.mjs'
import { KernelError } from '../src/errors.mjs'

test('internal diagnostics correlate a cause stack while keeping secrets out of logs and responses', t => {
  const logs = []
  t.mock.method(console, 'error', text => logs.push(text))
  process.env.IVORAIGE_TEST_SECRET = 'private-diagnostic-test-key'
  t.after(() => { delete process.env.IVORAIGE_TEST_SECRET })
  const cause = new Error(`Connection refused; Bearer ${process.env.IVORAIGE_TEST_SECRET}`)
  const error = new KernelError('INTERNAL', 'Task interrupted', { canceled: true }, { cause })
  const result = errorEnvelope(error)
  assert.equal(result.exitCode, 5)
  assert.equal(result.body.error.details.canceled, true)
  assert.ok(logs[0].includes(result.body.error.details.traceId))
  assert.match(logs[0], /Connection refused/)
  assert.match(logs[0], /Caused by:/)
  assert.doesNotMatch(logs[0], /private-diagnostic-test-key/)
  assert.doesNotMatch(JSON.stringify(result.body), /Connection refused|Task interrupted|private-diagnostic/)
})
