import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-adapter-availability-'))
  const app = await createApp({ store: join(directory, 'records.sqlite'), exportDir: join(directory, 'out') })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  return app
}
const source = (id, extra = {}) => ({ id, version: '1', formats: ['fixture'], inputKinds: ['text'],
  match: () => 1,
  parse: async file => ({ format: 'fixture', title: id, chapters: [], resources: [],
    units: [{ order: 0, kind: 'body', sourceText: file.content, translatable: true }],
    sourceBinding: { adapterId: id } }), ...extra })
const output = (id, extra = {}) => ({ id, formats: [id], requiredViews: [],
  supports: () => true, rebuild: () => Buffer.from([0, 255]), ...extra })

test('unavailable sources never run their matcher, including when no usable source wins', async t => {
  const app = await fixture(t)
  let matched = 0, parsed = 0
  app.parse.register(source('missing', { status: () => ({ state: 'unavailable' }),
    match() { matched++; throw new Error('missing sidecar matcher') },
    parse() { parsed++; throw new Error('missing sidecar parser') } }))
  const contentBase64 = Buffer.from('source').toString('base64')
  for (const file of [{ format: 'fixture', contentBase64 }, { contentBase64 },
    { format: 'fixture', adapterId: 'missing', contentBase64 }])
    await assert.rejects(app.operations.invoke('importDocument', { ...file, language: 'en' }),
      { code: 'COMPONENT_MISSING' })
  assert.equal(app.records.listTasks().length, 0)
  assert.equal(app.records.listDocuments().length, 0)
  app.parse.register(source('working'))
  const imported = await app.operations.invoke('importDocument',
    { format: 'fixture', contentBase64, language: 'en' })
  assert.equal(imported.document.sourceAdapterId, 'working')
  assert.equal(matched, 0)
  assert.equal(parsed, 0)
  assert.equal(app.records.listTasks().length, 1)
  assert.equal(app.records.listDocuments().length, 1)
})

test('missing-source classification respects declared formats and input kinds without matching', async t => {
  const app = await fixture(t)
  let matched = 0
  app.parse.register(source('missing', { status: () => ({ state: 'unavailable' }),
    match() { matched++; throw new Error('must not run') } }))
  for (const file of [{ format: 'other', contentBase64: Buffer.from('source').toString('base64') },
    { format: 'fixture', contentBase64: Buffer.from([255]).toString('base64') }])
    await assert.rejects(app.operations.invoke('importDocument', { ...file, language: 'en' }),
      { code: 'INVALID_ARGUMENT' })
  assert.equal(matched, 0)
  assert.equal(app.records.listTasks().length, 0)
})

test('readable output requires an explicit projection and never falls back to opaque text', async t => {
  const app = await fixture(t)
  app.parse.register(source('opaque'))
  const { document } = await app.records.importDocument({ format: 'fixture', content: 'PRIVATE' }, { language: 'en' })
  for (const format of ['json', 'md'])
    await assert.rejects(app.exporter.exportDocument(document.id,
      { contentMode: 'source', outputs: [{ format }] }), { code: 'PRECONDITION_FAILED' })
  assert.equal(app.records.listArtifacts(document.id).length, 0)
  assert.equal(app.records.listSnapshots(document.id).length, 0)
  app.outputs.register(output('frozen-binary'))
  const binary = await app.exporter.exportDocument(document.id,
    { contentMode: 'source', outputs: [{ format: 'frozen-binary' }] })
  assert.deepEqual(await readFile(binary.artifacts[0].path), Buffer.from([0, 255]))
})

test('a declared projection returning no text fails instead of revealing the internal text', async t => {
  const app = await fixture(t)
  app.parse.register(source('broken-projection', { readableText: () => undefined }))
  const { document } = await app.records.importDocument({ format: 'fixture', content: 'PRIVATE' }, { language: 'en' })
  await assert.rejects(app.exporter.exportDocument(document.id,
    { contentMode: 'source', outputs: [{ format: 'json' }] }), { code: 'INTERNAL' })
  assert.equal(app.records.listArtifacts(document.id).length, 0)
})

test('built-in TXT and Markdown explicitly project their public source and accepted text', async t => {
  const app = await fixture(t)
  for (const [format, content] of [['txt', 'Source'], ['md', '# Source']]) {
    const { document } = await app.records.importDocument({ format, content }, { language: 'en', sourceId: format })
    assert.equal(typeof app.parse.adapters.get(document.sourceAdapterId).readableText, 'function')
    const unit = app.records.listUnits(document.id, { targetLang: 'zh' })[0]
    const revision = await app.records.writeRevision(unit.id,
      { targetLang: 'zh', text: 'Accepted', baseRevisionId: null })
    await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
    for (const mode of [{ contentMode: 'source' }, { targetLang: 'zh' }]) {
      const exported = await app.exporter.exportDocument(document.id, { ...mode, outputs: [{ format: 'json' }] })
      const data = JSON.parse(await readFile(exported.artifacts[0].path, 'utf8'))
      assert.equal(data.units[0].text, mode.contentMode === 'source' ? 'Source' : 'Accepted')
    }
  }
})

test('output enumeration and selection share availability and content-mode exceptions', async t => {
  const app = await fixture(t)
  const binding = { adapterId: 'txt' }
  for (const state of ['unavailable', 'disabled', 'failed']) {
    let supported = 0
    const id = `blocked-${state}`
    app.outputs.register(output(id, { status: () => ({ state }),
      supports() { supported++; throw new Error('blocked output must not inspect binding') } }))
    assert.ok(!app.outputs.availableFor(binding).includes(id))
    assert.ok(!app.outputs.listFormats().includes(id))
    assert.ok(!app.outputs.listAdapters().includes(id))
    assert.throws(() => app.outputs.get(id, { binding }), { code: 'PRECONDITION_FAILED' })
    assert.equal(supported, 0)
  }
  for (const state of ['unavailable', 'disabled', 'failed']) {
    const id = `source-${state}`
    app.outputs.register(output(id, { status: () => ({ state }),
      canRunUnavailable: mode => mode === 'source' }))
    for (const contentMode of [undefined, 'accepted-translation', 'source']) {
      const allowed = state === 'unavailable' && contentMode === 'source'
      assert.equal(app.outputs.availableFor(binding, { contentMode }).includes(id), allowed)
      assert.equal(app.outputs.listFormats({ contentMode }).includes(id), allowed)
      assert.equal(app.outputs.listAdapters({ contentMode }).includes(id), allowed)
      if (allowed) assert.equal(app.outputs.get(id, { binding, contentMode }).id, id)
      else assert.throws(() => app.outputs.get(id, { binding, contentMode }), { code: 'PRECONDITION_FAILED' })
    }
  }
})

test('output versions are validated before registration and cannot poison task or artifact metadata', async t => {
  const app = await fixture(t)
  const initial = app.outputs.adapters.size
  for (const version of [1, null, '', '  ', {}]) {
    assert.throws(() => app.outputs.register(output('invalid-version', { version })), { code: 'INVALID_ARGUMENT' })
    assert.equal(app.outputs.adapters.size, initial)
  }
  app.outputs.register(output('unversioned'))
  app.outputs.register(output('versioned', { version: '1' }))
  const { document } = await app.records.importDocument({ format: 'txt', content: 'Source' }, { language: 'en' })
  const admitted = await app.tasks.exportDocument(document.id,
    { contentMode: 'source', outputs: [{ format: 'unversioned' }, { format: 'versioned' }] })
  const task = await app.tasks.wait(admitted.taskId)
  assert.equal(task.state, 'succeeded')
  assert.deepEqual(app.records.listArtifacts(document.id).map(a => a.adapterVersion).sort(), ['1', 'unversioned'])
})
