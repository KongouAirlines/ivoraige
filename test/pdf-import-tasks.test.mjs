import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, writeFile, readdir, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service } from '../dist/dsh.mjs'
import { createApp } from '../src/app.mjs'

const engine = fileURLToPath(new URL('./fixtures/pdf-engine.mjs', import.meta.url))
const pdfBytes = '%PDF-FAKE-IMPORT-TASK\n'
const managedSources = async directory => readdir(join(directory, 'pdf', 'sources')).catch(error => {
  if (error.code === 'ENOENT') return []
  throw error
})
const importWork = async directory => readdir(join(directory, 'pdf', 'work')).catch(error => {
  if (error.code === 'ENOENT') return []
  throw error
})
const bounded = async promise => {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('PDF import timed out')), 4000)
  })]) } finally { clearTimeout(timer) }
}
async function marker(path) {
  const deadline = Date.now() + 2000
  while (true) {
    try {
      const content = await readFile(path, 'utf8')
      if (content === 'entered') return content
      if (Date.now() > deadline) throw new Error('Capture marker was not completed')
    } catch (error) {
      if (Date.now() > deadline) throw error
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function fixture(t, mode = 'normal', relativeStore = false) {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-pdf-import-'))
  const absoluteStore = join(directory, 'records.sqlite')
  const store = relativeStore ? relative(process.cwd(), absoluteStore) : absoluteStore
  const source = join(directory, 'source.pdf')
  const entered = join(directory, 'parse-entered')
  const pdf = { command: process.execPath, args: [engine, mode, entered], timeoutMs: 2000 }
  await writeFile(source, pdfBytes)
  let app = await createApp({ store, pdf })
  t.after(async () => {
    await app.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  return { directory, source, entered, get app() { return app },
    async restart() { await app.dispose(); app = await createApp({ store, pdf }); return app } }
}

const submit = (f, sourceId) => f.app.tasks.importDocument({ format: 'pdf', path: f.source },
  { sourceId, language: 'en' }, { wait: false })

test('an import is visible while capture runs; cancel leaves no document', async t => {
  const f = await fixture(t, 'hang-parse')
  const starts = []
  const unsubscribe = f.app.tasks.subscribe(event => {
    if (event.type === 'task.started' && event.data.kind === 'import') starts.push(event.data.taskId)
  })
  t.after(unsubscribe)
  const { taskId } = await submit(f, 'pdf:active-cancel')
  assert.ok(['queued', 'running'].includes((await f.app.tasks.get(taskId)).state))
  assert.equal(await marker(f.entered), 'entered')
  assert.equal((await f.app.tasks.get(taskId)).state, 'running')
  assert.deepEqual(starts, [taskId])
  assert.deepEqual(f.app.records.listDocuments(), [])
  const canceled = await bounded(f.app.tasks.cancel(taskId))
  assert.equal(canceled.state, 'canceled')
  assert.deepEqual(f.app.records.listDocuments(), [])
  assert.equal((await f.app.tasks.get(taskId)).state, 'canceled')
  assert.deepEqual(await managedSources(f.directory), [])
  assert.deepEqual(await importWork(f.directory), [])
})

test('a second import can queue behind active capture and be canceled', async t => {
  const f = await fixture(t, 'hang-parse')
  const first = await submit(f, 'pdf:queue-first')
  await marker(f.entered)
  const second = await submit(f, 'pdf:queue-second')
  assert.ok(['queued', 'running'].includes((await f.app.tasks.get(second.taskId)).state))
  const secondCanceled = await bounded(f.app.tasks.cancel(second.taskId))
  assert.equal(secondCanceled.state, 'canceled')
  const firstCanceled = await bounded(f.app.tasks.cancel(first.taskId))
  assert.equal(firstCanceled.state, 'canceled')
  assert.deepEqual(f.app.records.listDocuments(), [])
})

test('PDF import queues behind a running translation and can be canceled', async t => {
  const f = await fixture(t)
  let entered
  const started = new Promise(resolve => { entered = resolve })
  class HangingModel extends Service {
    constructor(ctx) { super(ctx, 'ivoraige.translationModel') }
    translate({ signal }) {
      entered()
      return new Promise((_, reject) => signal.addEventListener('abort',
        () => reject(new Error('canceled by test')), { once: true }))
    }
  }
  await f.app.ctx.plugin(HangingModel)
  const { document } = await f.app.records.importDocument({ format: 'txt', content: 'A sentence.' },
    { sourceId: 'text:blocker', language: 'en' })
  const blocker = await f.app.tasks.submit(document.id, { targetLang: 'zh-CN' })
  await bounded(started)
  const imported = await submit(f, 'pdf:behind-translation')
  assert.equal((await f.app.tasks.get(imported.taskId)).state, 'queued')
  const canceled = await bounded(f.app.tasks.cancel(imported.taskId))
  assert.equal(canceled.state, 'canceled')
  assert.deepEqual(f.app.records.listDocuments().map(item => item.format), ['txt'])
  await bounded(f.app.tasks.cancel(blocker.taskId))
})

test('failed capture is durable and stays failed after restart', async t => {
  const f = await fixture(t, 'fail-parse')
  const { taskId } = await submit(f, 'pdf:parse-failure')
  const failed = await bounded(f.app.tasks.wait(taskId))
  assert.equal(failed.state, 'failed')
  assert.deepEqual(f.app.records.listDocuments(), [])
  await f.restart()
  assert.equal((await f.app.tasks.get(taskId)).state, 'failed')
  assert.deepEqual(f.app.records.listDocuments(), [])
  assert.deepEqual(await managedSources(f.directory), [])
  assert.deepEqual(await importWork(f.directory), [])
})

test('failed persistence removes a new source and keeps an existing shared source', async t => {
  const f = await fixture(t)
  const file = { format: 'pdf', path: f.source }
  const options = { language: 'en' }
  await assert.rejects(f.app.records.importDocument(file, { ...options, sourceId: 'pdf:first-failure' },
    { taskId: 'missing-task' }))
  assert.deepEqual(await managedSources(f.directory), [])
  assert.deepEqual(await importWork(f.directory), [])

  const { document } = await f.app.records.importDocument(file, { ...options, sourceId: 'pdf:shared-success' })
  const source = (await managedSources(f.directory))[0]
  assert.ok(source)
  await assert.rejects(f.app.records.importDocument(file, { ...options, sourceId: 'pdf:second-failure' },
    { taskId: 'missing-task' }))
  assert.deepEqual(await managedSources(f.directory), [source])
  assert.deepEqual(f.app.records.listDocuments().map(item => item.id), [document.id])
})

test('a callback failure after record commit keeps its managed source', async t => {
  const f = await fixture(t)
  const records = f.app.records
  const original = records.insertDocument.bind(records)
  records.insertDocument = async (...args) => {
    await original(...args)
    throw new Error('simulated post-commit failure')
  }
  t.after(() => { records.insertDocument = original })
  await assert.rejects(records.importDocument({ format: 'pdf', path: f.source },
    { sourceId: 'pdf:committed-then-threw', language: 'en' }), /simulated post-commit failure/)
  assert.equal(records.listDocuments().length, 1)
  assert.equal((await managedSources(f.directory)).length, 1)
  assert.deepEqual(await importWork(f.directory), [])
})

test('concurrent imports of the same source retain the successful document source', async t => {
  const f = await fixture(t)
  const file = { format: 'pdf', path: f.source }
  const [failed, succeeded] = await Promise.allSettled([
    f.app.records.importDocument(file, { sourceId: 'pdf:failed', language: 'en' }, { taskId: 'missing-task' }),
    f.app.records.importDocument(file, { sourceId: 'pdf:success', language: 'en' }),
  ])
  assert.equal(failed.status, 'rejected')
  assert.equal(succeeded.status, 'fulfilled')
  assert.equal((await managedSources(f.directory)).length, 1)
  assert.deepEqual(f.app.records.listDocuments().map(item => item.id), [succeeded.value.document.id])
})

test('failed import cannot remove another database source in the same directory', async t => {
  const f = await fixture(t)
  const config = { store: join(f.directory, 'other.sqlite'),
    pdf: { command: process.execPath, args: [engine], timeoutMs: 2000 } }
  let other = await createApp(config)
  t.after(() => other.dispose())
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  const original = f.app.records.insertDocument
  f.app.records.insertDocument = async () => {
    entered.resolve()
    await release.promise
    throw new Error('controlled persistence failure')
  }
  const file = { format: 'pdf', path: f.source }
  const failing = assert.rejects(f.app.records.importDocument(file,
    { sourceId: 'pdf:failure-owner', language: 'en' }), /controlled persistence failure/)
  let document, binding
  try {
    // The first runtime has published its source but cannot commit yet.
    await bounded(entered.promise)
    ;({ document } = await bounded(other.records.importDocument(file,
      { sourceId: 'pdf:other-owner', language: 'en' })))
    const snapshot = await other.records.createSnapshot(document.id,
      { targetLang: 'zh-CN', onMissingAccepted: 'skip' })
    binding = other.records.resolveSnapshot(document.id, snapshot.id).sourceBinding
    assert.equal(await readFile(binding.sourcePath, 'utf8'), pdfBytes)
  } finally {
    release.resolve()
    await failing
    f.app.records.insertDocument = original
  }
  assert.deepEqual(f.app.records.listDocuments(), [])
  assert.equal(await readFile(binding.sourcePath, 'utf8'), pdfBytes)
  assert.equal((await managedSources(f.directory)).length, 1)
  assert.deepEqual(await importWork(f.directory), [])
  await other.dispose()
  other = await createApp(config)
  const exported = await other.tasks.exportDocument(document.id,
    { targetLang: 'zh-CN', onMissingAccepted: 'skip', outputs: [{ format: 'pdf' }] })
  const task = await other.tasks.wait(exported.taskId)
  assert.equal(task.state, 'succeeded', task.error?.message)
})

test('store-owned sources remain stable across restart and same-store reimport', async t => {
  const f = await fixture(t, 'normal', true)
  const file = { format: 'pdf', path: f.source }
  const options = { sourceId: 'pdf:stable-owner', language: 'en' }
  const first = await f.app.records.importDocument(file, options)
  const sources = await managedSources(f.directory)
  await f.restart()
  const again = await f.app.records.importDocument(file, options)
  assert.equal(again.deduplicated, true)
  assert.equal(again.document.id, first.document.id)
  assert.deepEqual(await managedSources(f.directory), sources)
})

test('legacy shared-source snapshots survive new import cleanup and restart', async t => {
  const f = await fixture(t)
  const adapter = f.app.parse.adapters.get('babeldoc')
  const { parse, import: importSource } = adapter
  let legacyPath
  // Create a record with the pre-fix digest-only binding via the normal records
  // persistence path, including its fingerprint and frozen binding digests.
  adapter.import = undefined
  adapter.parse = async file => {
    const parsed = await parse(file)
    legacyPath = join(dirname(parsed.sourceBinding.sourcePath), `${parsed.sourceBinding.sourceDigest}.pdf`)
    await rename(parsed.sourceBinding.sourcePath, legacyPath)
    return { ...parsed, sourceBinding: { ...parsed.sourceBinding, sourcePath: legacyPath } }
  }
  let document
  try {
    ;({ document } = await f.app.records.importDocument({ format: 'pdf', path: f.source },
      { sourceId: 'pdf:legacy', language: 'en' }))
  } finally { adapter.parse = parse; adapter.import = importSource }
  const snapshot = await f.app.records.createSnapshot(document.id,
    { targetLang: 'zh-CN', onMissingAccepted: 'skip' })
  await assert.rejects(f.app.records.importDocument({ format: 'pdf', path: f.source },
    { sourceId: 'pdf:new-failure', language: 'en' }, { taskId: 'missing-task' }))
  assert.deepEqual(await managedSources(f.directory), [legacyPath.split(/[\\/]/).at(-1)])
  await f.restart()
  const binding = f.app.records.resolveSnapshot(document.id, snapshot.id).sourceBinding
  assert.equal(binding.sourcePath, legacyPath)
  assert.equal(await readFile(legacyPath, 'utf8'), pdfBytes)
  const exported = await f.app.tasks.exportDocument(document.id,
    { targetLang: 'zh-CN', snapshotId: snapshot.id, outputs: [{ format: 'pdf' }] })
  const task = await f.app.tasks.wait(exported.taskId)
  assert.equal(task.state, 'succeeded', task.error?.message)
})

test('startup marks an interrupted running import failed without resuming it', async t => {
  const f = await fixture(t)
  const created = await f.app.records.createImportTask('Interrupted source')
  await f.app.records.updateTask(created.id, current => ({ ...current, state: 'running' }))
  assert.equal((await f.app.tasks.get(created.id)).state, 'running')
  await f.restart()
  const recovered = await f.app.tasks.get(created.id)
  assert.equal(recovered.state, 'failed')
  assert.match(recovered.error.message, /submit the source again/)
  assert.deepEqual(f.app.records.listDocuments(), [])
})

test('startup completes an interrupted import whose prepared document committed', async t => {
  const f = await fixture(t)
  const task = await f.app.records.createImportTask('Prepared PDF')
  await f.app.records.updateTask(task.id, current => ({ ...current, state: 'running' }))
  const imported = await f.app.records.importDocument({ format: 'pdf', path: f.source },
    { sourceId: 'pdf:committed-before-task', language: 'en' }, { taskId: task.id })
  const unfinished = await f.app.tasks.get(task.id)
  assert.equal(unfinished.state, 'running')
  assert.equal(unfinished.preparedDocId, imported.document.id)
  await f.restart()
  const recovered = await f.app.tasks.get(task.id)
  assert.equal(recovered.state, 'succeeded')
  assert.equal(recovered.docId, imported.document.id)
  assert.equal(recovered.cursor, 1)
  assert.deepEqual(recovered.progress, { stage: 'complete', done: 1, total: 1 })
  assert.equal(recovered.result.document.id, imported.document.id)
  assert.equal(recovered.result.recovered, true)
  assert.deepEqual(f.app.records.listDocuments().map(item => item.id), [imported.document.id])
})

test('startup fails an interrupted import whose prepared document did not commit', async t => {
  const f = await fixture(t)
  const task = await f.app.records.createImportTask('Uncommitted PDF')
  await f.app.records.updateTask(task.id, current => ({ ...current,
    state: 'running', preparedDocId: 'f'.repeat(32),
  }))
  await f.restart()
  const recovered = await f.app.tasks.get(task.id)
  assert.equal(recovered.state, 'failed')
  assert.equal(recovered.preparedDocId, 'f'.repeat(32))
  assert.match(recovered.error.message, /submit the source again/)
  assert.deepEqual(f.app.records.listDocuments(), [])
})

test('app shutdown aborts active capture and returns in bounded time', async t => {
  const f = await fixture(t, 'hang-parse')
  const { taskId } = await submit(f, 'pdf:shutdown')
  await marker(f.entered)
  await bounded(f.app.dispose())
  await f.restart()
  assert.equal((await f.app.tasks.get(taskId)).state, 'canceled')
  assert.deepEqual(f.app.records.listDocuments(), [])
})

test('a relative store still records an absolute managed source path', async t => {
  const f = await fixture(t, 'normal', true)
  const { taskId } = await submit(f, 'pdf:relative-store')
  const completed = await bounded(f.app.tasks.wait(taskId))
  assert.equal(completed.state, 'succeeded', completed.error?.message)
  const binding = f.app.records.resolveSnapshot(completed.docId,
    (await f.app.records.createSnapshot(completed.docId, { targetLang: 'zh-CN', onMissingAccepted: 'skip' })).id)
    .sourceBinding
  assert.equal(isAbsolute(binding.sourcePath), true)
  // macOS resolves /var temporary directories through /private/var.
  assert.equal(dirname(binding.sourcePath), join(await realpath(f.directory), 'pdf', 'sources'))
  await f.restart()
  assert.equal((await f.app.tasks.get(taskId)).state, 'succeeded')
})
