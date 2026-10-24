import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-select-'))
  const app = await createApp({ store: join(directory, 'records.sqlite') })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  return app
}

function adapter(id, { score = 1, inputKinds = ['bytes'], importMode, version = '1',
  match, parse, status } = {}) {
  return { id, version, bindingSchemaVersion: 1, formats: ['fixture'], inputKinds, importMode,
    ...(status ? { status } : {}),
    match: match ?? (() => score),
    parse: parse ?? (async file => ({ format: 'fixture', title: id,
      units: [{ order: 0, kind: 'body', sourceText: Buffer.isBuffer(file.content)
        ? file.content.toString('hex') : file.content, translatable: true }],
      chapters: [], resources: [], sourceBinding: { adapterId: id } })),
  }
}

const request = (content, extra = {}) => ({ language: 'en', contentBase64: Buffer.from(content).toString('base64'),
  ...extra })

test('an unavailable matcher cannot interfere with a usable source', async t => {
  const app = await fixture(t)
  app.parse.register(adapter('unavailable', { status: () => ({ state: 'unavailable' }),
    match: () => { throw new Error('unavailable matcher must not run when a usable source wins') } }))
  app.parse.register(adapter('usable-text', { inputKinds: ['text'] }))
  const result = await app.operations.invoke('importDocument', request('Usable text', { format: 'fixture' }))
  assert.equal(result.document.sourceAdapterId, 'usable-text')
})

test('no-format binary magic takes the same byte adapter through public import and direct Tasks', async t => {
  const app = await fixture(t)
  app.parse.register(adapter('magic', { match: file =>
    Buffer.isBuffer(file.content) && file.content[0] === 0xff ? 0.9 : 0 }))
  const bytes = Buffer.from([0xff, 0x42, 0x01])
  const directResult = await app.tasks.importDocument({ content: bytes },
    { language: 'en', sourceId: 'direct-magic' })
  assert.equal(directResult.document.sourceAdapterId, 'magic')
  const publicResult = await app.operations.invoke('importDocument', request(bytes, { sourceId: 'public-magic' }))
  assert.equal(publicResult.document.sourceAdapterId, 'magic')
  assert.equal(app.records.record(publicResult.document.id).units[0].sourceText, bytes.toString('hex'))
})

test('byte score beats a lower text score on a valid UTF-8 upload', async t => {
  const app = await fixture(t)
  app.parse.register(adapter('high-bytes', { score: 0.9 }))
  app.parse.register(adapter('low-text', { score: 0.1, inputKinds: ['text'] }))
  const result = await app.operations.invoke('importDocument', request('UTF8 source',
    { format: 'fixture', sourceId: 'score' }))
  assert.equal(result.document.sourceAdapterId, 'high-bytes')
  assert.equal(app.records.record(result.document.id).units[0].sourceText,
    Buffer.from('UTF8 source').toString('hex'))
})

test('explicit byte and text adapters each receive their declared input view', async t => {
  const app = await fixture(t)
  app.parse.register(adapter('explicit-bytes', { match: file => {
    assert.ok(Buffer.isBuffer(file.content)); return 1
  } }))
  app.parse.register(adapter('explicit-text', { inputKinds: ['text'], match: file => {
    assert.equal(typeof file.content, 'string'); return 1
  } }))
  for (const [adapterId, expected] of [['explicit-bytes', Buffer.from('Readable').toString('hex')],
    ['explicit-text', 'Readable']]) {
    const result = await app.operations.invoke('importDocument', request('Readable',
      { format: 'fixture', adapterId, sourceId: adapterId }))
    assert.equal(result.document.sourceAdapterId, adapterId)
    assert.equal(app.records.record(result.document.id).units[0].sourceText, expected)
  }
})

test('multi-kind adapter retains its higher-scoring text view for parsing', async t => {
  const app = await fixture(t)
  const calls = { bytes: 0, text: 0 }
  app.parse.register(adapter('dual-prefer-text', { inputKinds: ['bytes', 'text'], match: file => {
    if (Buffer.isBuffer(file.content)) { calls.bytes++; return 0.1 }
    assert.equal(typeof file.content, 'string')
    calls.text++
    return 0.9
  } }))
  const result = await app.operations.invoke('importDocument', request('Text wins',
    { format: 'fixture' }))
  assert.equal(result.document.sourceAdapterId, 'dual-prefer-text')
  assert.equal(app.records.record(result.document.id).units[0].sourceText, 'Text wins')
  assert.deepEqual(calls, { bytes: 1, text: 1 })
})

test('equal views of one multi-kind adapter do not conflict or parse twice', async t => {
  const app = await fixture(t)
  const calls = { bytes: 0, text: 0, parse: 0 }
  const dual = adapter('dual-tie', { inputKinds: ['bytes', 'text'], match: file => {
    if (Buffer.isBuffer(file.content)) calls.bytes++
    else { assert.equal(typeof file.content, 'string'); calls.text++ }
    return 0.9
  } })
  app.parse.register({ ...dual, parse: async file => {
    calls.parse++
    assert.ok(Buffer.isBuffer(file.content), 'equal views should retain lossless bytes')
    return dual.parse(file)
  } })
  const result = await app.operations.invoke('importDocument', request('Equal views',
    { format: 'fixture' }))
  assert.equal(result.document.sourceAdapterId, 'dual-tie')
  assert.deepEqual(calls, { bytes: 1, text: 1, parse: 1 })
})

test('equal byte and text scores conflict without writes or repeat matching', async t => {
  const app = await fixture(t)
  const calls = { bytes: 0, text: 0 }
  app.parse.register(adapter('tie-bytes', { match: file => {
    calls.bytes++; assert.ok(Buffer.isBuffer(file.content)); return 0.9
  } }))
  app.parse.register(adapter('tie-text', { inputKinds: ['text'], match: file => {
    calls.text++; assert.equal(typeof file.content, 'string'); return 0.9
  } }))
  const before = app.records.listTasks().length
  await assert.rejects(app.operations.invoke('importDocument', request('Tie', { format: 'fixture' })),
    { code: 'CONFLICT' })
  assert.deepEqual(calls, { bytes: 1, text: 1 })
  assert.equal(app.records.listDocuments().length, 0)
  assert.equal(app.records.listTasks().length, before)
})

test('unavailable byte adapter cannot steal a valid text import', async t => {
  const app = await fixture(t)
  app.parse.register(adapter('unavailable-bytes', { score: 1,
    status: () => ({ state: 'unavailable' }) }))
  app.parse.register(adapter('available-text', { score: 0.1, inputKinds: ['text'] }))
  const result = await app.operations.invoke('importDocument', request('Readable',
    { format: 'fixture' }))
  assert.equal(result.document.sourceAdapterId, 'available-text')
})

test('strict matchers see declared content kind and source metadata', async t => {
  const app = await fixture(t)
  app.parse.register(adapter('strict-bytes', { match: file => {
    assert.ok(Buffer.isBuffer(file.content))
    assert.equal(file.format, 'fixture')
    assert.equal(file.title, 'Shown title')
    return 0.9
  } }))
  app.parse.register(adapter('strict-text', { inputKinds: ['text'], match: file => {
    assert.equal(typeof file.content, 'string')
    assert.equal(file.format, 'fixture')
    assert.equal(file.title, 'Shown title')
    return 0.1
  } }))
  const result = await app.operations.invoke('importDocument', request('Metadata',
    { format: 'fixture', title: 'Shown title' }))
  assert.equal(result.document.sourceAdapterId, 'strict-bytes')
})

test('direct Tasks matcher retains a supplied source name and title', async t => {
  const app = await fixture(t)
  app.parse.register(adapter('strict-name', { match: file => {
    assert.ok(Buffer.isBuffer(file.content))
    assert.equal(file.format, 'fixture')
    assert.equal(file.title, 'Display title')
    assert.equal(file.name, 'source.fixture')
    return 1
  } }))
  const result = await app.tasks.importDocument({ format: 'fixture', title: 'Display title',
    name: 'source.fixture', content: Buffer.from('Named content') },
  { language: 'en', sourceId: 'named-source' })
  assert.equal(result.document.sourceAdapterId, 'strict-name')
})

function holdJob(app, t) {
  let release
  const done = new Promise(resolve => { release = resolve })
  t.after(() => release({ status: 'completed' }))
  app.ctx.get('jobs').start({ kind: 'selection-held', label: 'Held quota',
    run: () => ({ done, cancel: () => release({ status: 'killed' }) }) })
  return () => release({ status: 'completed' })
}

test('queued import retains its admitted source metadata', async t => {
  const app = await fixture(t)
  const release = holdJob(app, t)
  app.parse.register(adapter('metadata-pinned', { importMode: 'queued' }))
  const metadata = { language: 'en', sourceId: 'admitted-source', origin: 'manual' }
  const pending = await app.tasks.importDocument({ format: 'fixture', content: Buffer.from('Pinned') },
    metadata, { wait: false })
  metadata.language = 'de'
  metadata.sourceId = 'changed-source'
  metadata.origin = 'zotero'
  release()
  const task = await app.tasks.wait(pending.taskId)
  assert.equal(task.state, 'succeeded')
  const document = app.records.getDocument(task.docId)
  assert.equal(document.language, 'en')
  assert.equal(document.sourceId, 'admitted-source')
  assert.equal(document.origin, 'manual')
})

test('queued byte import pins selected adapter, mode, and owned bytes at admission', async t => {
  const app = await fixture(t)
  let release
  const gate = new Promise(resolve => { release = resolve })
  t.after(() => release())
  const selected = adapter('queued-bytes', { score: 0.6, importMode: 'queued' })
  app.parse.register({ ...selected, import: async (file, accept) => {
    await gate
    return accept(await selected.parse(file))
  } })
  const original = Buffer.from('Original bytes')
  const pending = await app.tasks.importDocument({ format: 'fixture', content: original },
    { language: 'en', sourceId: 'queued-original' }, { wait: false })
  assert.equal((await app.tasks.get(pending.taskId)).adapterId, 'queued-bytes')
  original.fill(0x58)
  app.parse.register(adapter('later-higher', { score: 0.95 }))
  release()
  const completed = await app.tasks.wait(pending.taskId)
  assert.equal(completed.state, 'succeeded')
  assert.equal(completed.result.document.sourceAdapterId, 'queued-bytes')
  assert.equal(app.records.record(completed.result.document.id).units[0].sourceText,
    Buffer.from('Original bytes').toString('hex'))
})

test('queued import fails closed when its selected adapter version is replaced', async t => {
  const app = await fixture(t)
  const release = holdJob(app, t)
  const remove = app.parse.register(adapter('pinned-bytes', { score: 0.6, importMode: 'queued' }))
  const pending = await app.tasks.importDocument({ format: 'fixture', content: Buffer.from('Pinned') },
    { language: 'en', sourceId: 'queued-replaced' }, { wait: false })
  remove()
  app.parse.register(adapter('pinned-bytes', { score: 0.95, importMode: 'queued', version: '2' }))
  app.parse.register(adapter('other-bytes', { score: 1 }))
  release()
  const failed = await app.tasks.wait(pending.taskId)
  assert.equal(failed.state, 'failed')
  assert.equal(app.records.listDocuments().length, 0)
})

test('selected synchronous byte adapter stays synchronous beside a lower queued text adapter', async t => {
  const app = await fixture(t)
  app.parse.register(adapter('sync-bytes', { score: 0.9 }))
  app.parse.register(adapter('queued-text', { score: 0.1, inputKinds: ['text'], importMode: 'queued' }))
  const result = await app.operations.invoke('importDocument', request('Sync input',
    { format: 'fixture' }))
  assert.equal(result.document.sourceAdapterId, 'sync-bytes')
  assert.equal((await app.tasks.get(result.taskId)).state, 'succeeded')
})
