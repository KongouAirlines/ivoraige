import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'

const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0x00])
const binaryInput = { format: 'pdf', contentBase64: bytes.toString('base64') }
const textInput = { format: 'pdf', contentBase64: Buffer.from('Readable PDF text.').toString('base64') }

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-pdf-route-'))
  const app = await createApp({ store: join(directory, 'records.sqlite') })
  const path = join(directory, 'source.pdf')
  await writeFile(path, bytes)
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  return { app, path }
}

function textPdf() {
  return {
    id: 'text-pdf', version: '1', bindingSchemaVersion: 1,
    formats: ['pdf'], inputKinds: ['text'],
    match: file => {
      assert.equal(typeof file.content, 'string', 'text-only matcher must not receive another input kind')
      return file.format === 'pdf' ? 1 : 0
    },
    parse: async file => ({ format: 'pdf', title: 'Readable PDF text',
      units: [{ order: 0, kind: 'body', sourceText: file.content, translatable: true }],
      chapters: [], resources: [], sourceBinding: { adapterId: 'text-pdf' } }),
  }
}

function unavailablePdf() {
  return {
    id: 'missing-pdf', version: '1', bindingSchemaVersion: 1,
    formats: ['pdf'], inputKinds: ['bytes', 'managed-resource'],
    status: () => ({ state: 'unavailable' }),
    match: file => file.format === 'pdf' || /\.pdf$/i.test(file.path ?? '') ? 1 : 0,
    parse: async () => { throw new Error('unavailable adapter must not parse') },
  }
}

async function expectDeferredMissing(app, input, sourceId) {
  const pending = await app.operations.invoke('importDocument', { ...input, language: 'en', sourceId })
  assert.ok(pending.taskId)
  assert.equal((await app.tasks.wait(pending.taskId)).state, 'failed')
}

test('a text-only PDF sibling does not suppress the absent PDF path or binary task', async t => {
  const { app, path } = await fixture(t)
  const inputs = [{ path }, binaryInput]
  for (const [index, input] of inputs.entries())
    await expectDeferredMissing(app, input, `absent:${index}`)
  app.parse.register(textPdf())
  for (const [index, input] of inputs.entries())
    await expectDeferredMissing(app, input, `sibling:${index}`)
})

test('unavailable byte/path PDF stays component-missing beside a text-only sibling', async t => {
  const { app, path } = await fixture(t)
  app.parse.register(unavailablePdf())
  app.parse.register(textPdf())
  for (const input of [{ path }, binaryInput])
    await assert.rejects(app.operations.invoke('importDocument', { ...input, language: 'en' }),
      { code: 'COMPONENT_MISSING' })
  const readable = await app.operations.invoke('importDocument', { ...textInput, language: 'en' })
  assert.equal(readable.document.sourceAdapterId, 'text-pdf')
})

test('explicit adapter selection retains input-kind and missing-component errors', async t => {
  const { app, path } = await fixture(t)
  app.parse.register(textPdf())
  app.parse.register(unavailablePdf())
  for (const input of [{ path }, binaryInput])
    await assert.rejects(app.operations.invoke('importDocument',
      { ...input, language: 'en', adapterId: 'text-pdf' }), { code: 'INVALID_ARGUMENT' })
  const readable = await app.operations.invoke('importDocument',
    { ...textInput, language: 'en', adapterId: 'text-pdf' })
  assert.equal(readable.document.sourceAdapterId, 'text-pdf')
  for (const adapterId of ['missing-pdf', 'not-installed'])
    await assert.rejects(app.operations.invoke('importDocument',
      { ...textInput, language: 'en', adapterId }), { code: 'COMPONENT_MISSING' })
})
