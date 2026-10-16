import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertArtifactFormats, closeBestEffort, createRunDirectory, listAllUnits, writeAcceptanceReport } from '../scripts/smoke-mcp-pdf-helpers.mjs'

test('PDF smoke traverses all unit pages before acceptance and post-restart editing', async () => {
  const units = Array.from({ length: 101 }, (_, index) => ({ id: `unit-${index}`, translatable: index === 100 }))
  const calls = []
  const call = async (name, args) => {
    calls.push({ name, args })
    const start = args.cursor ? Number(args.cursor) : 0
    const items = units.slice(start, start + 100)
    return { items, ...(start + 100 < units.length ? { nextCursor: String(start + 100) } : {}) }
  }
  const listed = await listAllUnits(call, 'doc', 'zh')
  assert.equal(listed.length, 101)
  assert.equal(listed.find(item => item.translatable).id, 'unit-100')
  assert.ok(calls.every(({ name, args }) => name === 'units_list' && args.docId === 'doc' && args.targetLang === 'zh'))
  assert.deepEqual(calls.map(({ args }) => args.cursor), [undefined, '100'])
})

test('PDF smoke repeats use distinct directories and preserve previous evidence', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ivoraige-mcp-smoke-test-'))
  try {
    const first = await createRunDirectory(parent)
    const evidence = join(first, 'report.json')
    await writeFile(evidence, 'first run')
    const second = await createRunDirectory(parent)
    assert.notEqual(first, second)
    assert.equal(await readFile(evidence, 'utf8'), 'first run')
    assert.ok(first.startsWith(parent))
    assert.ok(second.startsWith(parent))
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('PDF smoke report write failure fails acceptance and preserves both errors', async () => {
  const primary = Error('PDF replay failed')
  const writeError = Error('report write failed')
  const write = async () => { throw writeError }
  const report = { passed: false, error: { name: primary.name, message: primary.message } }
  const failure = await writeAcceptanceReport(report, 'report.json', primary, write)
  assert.ok(failure instanceof AggregateError)
  assert.deepEqual(failure.errors, [primary, writeError])
  assert.equal(report.passed, false)
  assert.equal(report.error.message, primary.message)
  assert.equal(report.reportWriteError.message, writeError.message)

  const otherwisePassed = { passed: true }
  assert.equal(await writeAcceptanceReport(otherwisePassed, 'report.json', undefined, write), writeError)
  assert.equal(otherwisePassed.passed, false)
  assert.equal(otherwisePassed.error.message, writeError.message)
})

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
