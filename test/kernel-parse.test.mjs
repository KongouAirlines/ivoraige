import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'

test('TXT paragraphs produce ordered source IR with stable line locators', async t => {
  const app = await createApp()
  t.after(() => app.dispose())
  const parsed = await app.parse.parse({ format: 'txt', title: 'Example', content: '\uFEFFFirst line\r\nsecond line\r\n\r\n  Third paragraph  \r\n' })
  assert.equal(parsed.format, 'txt')
  assert.equal(parsed.title, 'Example')
  assert.deepEqual(parsed.availableOutputs, [])
  assert.deepEqual(parsed.sourceBinding, { adapterId: 'txt' })
  assert.deepEqual(parsed.units, [
    { order: 0, kind: 'body', sourceText: 'First line\nsecond line', locator: { paragraph: 1, lineStart: 1, lineEnd: 2 }, translatable: true },
    { order: 1, kind: 'body', sourceText: 'Third paragraph', locator: { paragraph: 2, lineStart: 4, lineEnd: 4 }, translatable: true },
  ])
})

test('TXT file path is read by its registered source adapter', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-parse-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'sample.TXT')
  await writeFile(path, 'Alpha\n\nBeta', 'utf8')
  const app = await createApp()
  t.after(() => app.dispose())
  const parsed = await app.parse.parse({ path })
  assert.equal(parsed.title, 'sample.TXT')
  assert.deepEqual(parsed.units.map(unit => unit.sourceText), ['Alpha', 'Beta'])
  assert.equal(await readFile(path, 'utf8'), 'Alpha\n\nBeta')
})

test('unknown formats and invalid TXT input fail with protocol error code', async t => {
  const app = await createApp()
  t.after(() => app.dispose())
  await assert.rejects(app.parse.parse({ format: 'pdf', content: 'text' }), error => {
    assert.equal(error.code, 'INVALID_ARGUMENT')
    assert.deepEqual(error.details.registeredAdapters, ['txt'])
    return true
  })
  await assert.rejects(app.parse.parse({ format: 'txt', content: '\n \n' }), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(app.parse.parse({ format: 'txt', path: 'x.txt', content: 'x' }), { code: 'INVALID_ARGUMENT' })
})

test('output availability follows installed adapters and source binding', async t => {
  const app = await createApp()
  t.after(() => app.dispose())
  const unregister = app.outputs.register({
    id: 'test-output',
    supports: binding => binding?.adapterId === 'txt',
    rebuild: async () => { throw new Error('not used') },
  })
  assert.deepEqual((await app.parse.parse({ format: 'txt', content: 'Text' })).availableOutputs, ['test-output'])
  assert.deepEqual(app.outputs.availableFor({ adapterId: 'other' }), [])
  unregister()
  assert.deepEqual((await app.parse.parse({ format: 'txt', content: 'Text' })).availableOutputs, [])
})

test('parse registry rejects malformed common IR from an adapter', async t => {
  const app = await createApp()
  t.after(() => app.dispose())
  const unregister = app.parse.register({
    id: 'broken',
    match: file => file.format === 'broken' ? 1 : 0,
    parse: async () => ({ format: 'broken', title: 'Bad', units: [{ sourceText: 'No locator or order' }] }),
  })
  await assert.rejects(app.parse.parse({ format: 'broken', content: 'x' }), { code: 'INTERNAL' })
  unregister()
  assert.deepEqual(app.parse.listAdapters(), ['txt'])
})

test('Cordis plugin lifecycle releases TXT and no legacy business services are loaded', async () => {
  const app = await createApp()
  assert.deepEqual(app.parse.listAdapters(), ['txt'])
  for (const service of ['ivoraige.records', 'ivoraige.translation', 'ivoraige.textTask', 'ivoraige.textExport', 'ivoraige.model']) {
    assert.equal(app.ctx.get(service), undefined)
  }
  await app.dispose()
  assert.equal(app.ctx.get('ivoraige.parse'), undefined)
  assert.deepEqual(app.parse.listAdapters(), [])
})
