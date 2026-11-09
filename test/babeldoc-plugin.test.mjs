import test from 'node:test'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../src/app.mjs'
import BabelDOCSource from '../plugins/babeldoc/index.mjs'
import { Pdf } from '../src/adapters/pdf.mjs'

const pdf = Buffer.from('%PDF-FAKE-ORIGINAL\nA synthetic fixture.\n')
// One fixture-owned hook: Windows cannot remove an open SQLite store. Always
// attempt every close before removing files, retaining the first cleanup error.
async function closeFixture(apps, remove) {
  let failure
  for (const app of [...apps].reverse()) {
    try { await app.dispose() } catch (error) { failure ??= error }
  }
  try { await remove() } catch (error) { failure ??= error }
  if (failure) throw failure
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-babeldoc-plugin-'))
  const apps = []
  t.after(() => closeFixture(apps, () => rm(dir, { recursive: true, force: true })))
  const engine = join(dir, 'engine.mjs')
  await writeFile(engine, (await readFile(new URL('./fixtures/pdf-engine.mjs', import.meta.url), 'utf8'))
    .replace("adapterId: 'babeldoc', captureConfig", "adapterId: 'babeldoc', engineVersion: '0.7.1+ivoraige.1', captureConfig"))
  const store = join(dir, 'db.sqlite')
  const config = { directory: join(dir, 'pdf'), command: process.execPath, args: [engine] }
  const open = async () => { const app = await createApp({ store }); apps.push(app); return app }
  return { dir, store, config, open }
}
async function importPdf(app) {
  const admitted = await app.operations.invoke('importDocument', { adapterId: 'babeldoc', format: 'pdf',
    contentBase64: pdf.toString('base64'), language: 'en', sourceId: 'babeldoc-independent' })
  const task = await app.tasks.wait(admitted.taskId)
  assert.equal(task.state, 'succeeded', JSON.stringify(task))
  return task.result.document
}

test('BabelDOC independent package imports, freezes, reopens and routes PDF/MD/JSON without models', async t => {
  const f = await fixture(t)
  let app = await f.open()
  await app.ctx.plugin(BabelDOCSource, f.config)
  const doc = await importPdf(app)
  assert.equal(doc.sourceAdapterId, 'babeldoc')
  const record = app.records.record(doc.id)
  assert.equal(record.sourceBinding.engineVersion, '0.7.1+ivoraige.1')
  for (const unit of app.records.listUnits(doc.id, { targetLang: 'zh' })) {
    const revision = await app.records.writeRevision(unit.id,
      { text: '中文 <b1> 结果。', targetLang: 'zh', baseRevisionId: null })
    await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  }
  const output = await app.exporter.exportDocument(doc.id, { targetLang: 'zh', outputs: ['pdf', 'md', 'json'].map(format => ({ format })) })
  assert.equal(output.artifacts.length, 3)
  assert.ok(output.artifacts.every(item => item.snapshotId === output.snapshotId))
  assert.equal(output.artifacts.find(item => item.format === 'pdf').adapterId, 'pdf')
  const frozenBytes = await readFile(output.artifacts.find(item => item.format === 'pdf').path)
  assert.equal(app.records.listTasks().filter(task => task.kind === 'translate').length, 0)
  await app.dispose()
  app = await f.open()
  await app.ctx.plugin(BabelDOCSource, f.config)
  const replay = await app.exporter.exportDocument(doc.id, { targetLang: 'zh', snapshotId: output.snapshotId, outputs: [{ format: 'pdf' }] })
  assert.deepEqual(await readFile(replay.artifacts[0].path), frozenBytes)
  const source = await app.exporter.exportDocument(doc.id, { contentMode: 'source', outputs: [{ format: 'pdf' }] })
  assert.deepEqual(await readFile(source.artifacts[0].path), pdf)
})

test('BabelDOC source absence and missing runtime leave stored records and TXT usable', async t => {
  const f = await fixture(t)
  let app = await f.open()
  await app.ctx.plugin(BabelDOCSource, f.config)
  const doc = await importPdf(app)
  await app.dispose()
  app = await f.open()
  assert.equal(app.records.getDocument(doc.id).sourceAdapterId, 'babeldoc')
  await assert.rejects(app.exporter.exportDocument(doc.id, { contentMode: 'source', outputs: [{ format: 'pdf' }] }), { code: 'INVALID_ARGUMENT' })
  await app.ctx.plugin(BabelDOCSource, { ...f.config, command: '/missing/babeldoc/python' })
  const admitted = await app.operations.invoke('importDocument', { adapterId: 'babeldoc', format: 'pdf',
    contentBase64: pdf.toString('base64'), language: 'en', sourceId: 'missing' })
  assert.equal((await app.tasks.wait(admitted.taskId)).state, 'failed')
  const source = await app.exporter.exportDocument(doc.id, { contentMode: 'source', outputs: [{ format: 'pdf' }] })
  assert.deepEqual(await readFile(source.artifacts[0].path), pdf)
  const txt = (await app.records.importDocument({ format: 'txt', content: 'Still usable.' }, { language: 'en', sourceId: 'text' })).document
  assert.ok((await app.exporter.exportDocument(txt.id, { contentMode: 'source', outputs: [{ format: 'json' }] })).artifacts.length)
})

test('BabelDOC package has no private host imports and rejects store spoofing', async t => {
  const f = await fixture(t)
  const app = await f.open()
  await assert.rejects(async () => await app.ctx.plugin(BabelDOCSource, { ...f.config, storePath: join(f.dir, 'other.sqlite') }), { code: 'INVALID_ARGUMENT' })
  for (const name of ['index.mjs', 'pdf-text.mjs', 'errors.mjs']) {
    const source = await readFile(new URL(`../plugins/babeldoc/${name}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /from ['"]\.\.\//)
    assert.doesNotMatch(source, /import .*cordis|import .*dsh|translationModel/)
  }
})

test('BabelDOC old and new mounts conflict explicitly and release registrations on close', async t => {
  const f = await fixture(t)
  let app = await f.open()
  await app.ctx.plugin(BabelDOCSource, f.config)
  await assert.rejects(async () => await app.ctx.plugin(Pdf, { ...f.config, storePath: f.store }), /already registered|duplicate/i)
  await app.dispose()
  app = await f.open()
  await app.ctx.plugin(BabelDOCSource, f.config)
  await importPdf(app)
})

test('BabelDOC old runtime output is rejected rather than relabeled compatible', async t => {
  const f = await fixture(t)
  const engine = f.config.args[0]
  await writeFile(engine, (await readFile(engine, 'utf8')).replace('0.7.1+ivoraige.1', '0.6.4'))
  const app = await f.open()
  await app.ctx.plugin(BabelDOCSource, f.config)
  const admitted = await app.operations.invoke('importDocument', { adapterId: 'babeldoc', format: 'pdf',
    contentBase64: pdf.toString('base64'), language: 'en', sourceId: 'old' })
  assert.equal((await app.tasks.wait(admitted.taskId)).state, 'failed')
  assert.equal(app.records.listDocuments().length, 0)
})

test('BabelDOC frozen output rejects old/cross-engine bindings without requesting a model or sidecar', async t => {
  const f = await fixture(t)
  const registrations = new Map(), disposers = []
  let requests = 0, closed = 0
  const services = {
    'ivoraige.storePath': f.store,
    'ivoraige.sidecarFactory': { create: () => ({ request: () => { requests++; throw Error('unexpected request') }, close: () => { closed++ } }) },
    'ivoraige.parse': { register: value => { registrations.set('source', value); return () => {} } },
    'ivoraige.outputs': { register: value => { registrations.set('output', value); return () => {} } },
  }
  BabelDOCSource({ get: name => { assert.ok(name in services, `Unexpected host capability: ${name}`); return services[name] },
    effect: fn => disposers.push(fn()) }, f.config)
  const output = registrations.get('output')
  assert.equal(output.supports({ adapterId: 'mineru' }, 'source'), false)
  const frozen = { document: { language: 'en' }, snapshot: { targetLang: 'zh' }, units: [],
    sourceBinding: { adapterId: 'babeldoc', captureConfig: {}, engineVersion: '0.6.4' } }
  await assert.rejects(output.rebuild(frozen), /requires 0.7.1/)
  await assert.rejects(output.rebuild({ ...frozen, snapshot: { contentMode: 'source' },
    sourceBinding: { adapterId: 'mineru' } }), /another engine/)
  assert.equal(requests, 0)
  for (const dispose of disposers.reverse()) if (dispose) await dispose()
  assert.equal(closed, 1)
})

test('BabelDOC independent mount cleans up missing-assets, crash and timeout failures', async t => {
  for (const [mode, code] of [['missing-assets', 'COMPONENT_MISSING'], ['crash-always', 'UPSTREAM_FAILURE'], ['hang', 'UPSTREAM_FAILURE']]) {
    await t.test(mode, async t => {
      const f = await fixture(t)
      const app = await f.open()
      const engine = fileURLToPath(new URL('./fixtures/pdf-sidecar.mjs', import.meta.url))
      await app.ctx.plugin(BabelDOCSource, { ...f.config, args: [engine, mode], timeoutMs: mode === 'hang' ? 1000 : 10000 })
      const source = app.ctx.get('ivoraige.parse').adapters.get('babeldoc')
      await assert.rejects(source.parse({ content: pdf, language: 'en' }), { code })
      assert.deepEqual(await readdir(join(f.config.directory, 'work')), [])
      assert.equal(app.records.listDocuments().length, 0)
      const txt = (await app.records.importDocument({ format: 'txt', content: 'Faults stay local.' },
        { sourceId: `failure-${mode}`, language: 'en' })).document
      assert.ok((await app.exporter.exportDocument(txt.id, { contentMode: 'source', outputs: [{ format: 'md' }] })).artifacts.length)
      await app.dispose()
    })
  }
})

test('BabelDOC independent capture cancels and closes without leaving documents or working files', async t => {
  const f = await fixture(t)
  const entered = join(f.dir, 'parse-entered')
  let app = await f.open()
  await app.ctx.plugin(BabelDOCSource, { ...f.config, args: [...f.config.args, 'hang-parse', entered], timeoutMs: 10000 })
  const admitted = await app.operations.invoke('importDocument', { adapterId: 'babeldoc', format: 'pdf',
    contentBase64: pdf.toString('base64'), language: 'en', sourceId: 'cancel' })
  const deadline = Date.now() + 5000
  while ((await readFile(entered, 'utf8').catch(() => '')) !== 'entered') {
    assert.ok(Date.now() < deadline, 'Capture did not start')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  await app.tasks.cancel(admitted.taskId)
  assert.equal((await app.tasks.wait(admitted.taskId)).state, 'canceled')
  assert.deepEqual(await readdir(join(f.config.directory, 'work')), [])
  assert.equal(app.records.listDocuments().length, 0)
  await app.dispose()
  app = await f.open()
  await app.ctx.plugin(BabelDOCSource, f.config)
  await importPdf(app)
})

test('legacy-first BabelDOC mount rejects the independent package without replacing the source', async t => {
  const f = await fixture(t)
  let app = await f.open()
  await app.ctx.plugin(Pdf, { ...f.config, storePath: f.store })
  const original = app.ctx.get('ivoraige.parse').adapters.get('babeldoc')
  await assert.rejects(async () => await app.ctx.plugin(BabelDOCSource, f.config), /already registered/)
  assert.equal(app.ctx.get('ivoraige.parse').adapters.get('babeldoc'), original)
  await importPdf(app)
  await app.dispose()
  app = await f.open()
  await app.ctx.plugin(BabelDOCSource, f.config)
  await importPdf(app)
})

test('BabelDOC fixture closes all hosts before removal when a test assertion fails early', async () => {
  const order = []
  const apps = [1, 2].map(id => ({ dispose: async () => { order.push(`close-${id}`) } }))
  const assertion = new Error('early test assertion')
  await assert.rejects(async () => {
    try { throw assertion }
    finally {
      await closeFixture(apps, async () => {
        assert.deepEqual(order, ['close-2', 'close-1'])
        order.push('remove')
      })
    }
  }, error => error === assertion)
  assert.deepEqual(order, ['close-2', 'close-1', 'remove'])
})

test('BabelDOC fixture continues cleanup after close errors and preserves the first error', async () => {
  const order = [], first = new Error('first close failure')
  const apps = [
    { dispose: async () => { order.push('close-1'); throw new Error('later close failure') } },
    { dispose: async () => { order.push('close-2'); throw first } },
  ]
  await assert.rejects(closeFixture(apps, async () => {
    order.push('remove')
    throw new Error('later removal failure')
  }), error => error === first)
  assert.deepEqual(order, ['close-2', 'close-1', 'remove'])
})


async function filesystemFaults(overrides, operation) {
  const originals = Object.fromEntries(Object.keys(overrides).map(name => [name, fs[name]]))
  Object.assign(fs, overrides)
  syncBuiltinESMExports()
  try { return await operation() }
  finally { Object.assign(fs, originals); syncBuiltinESMExports() }
}

for (const scenario of ['parse', 'import', 'rebuild', 'publish-new', 'publish-repair', 'cleanup-only']) {
  test(`BabelDOC ${scenario} retains primary failures when filesystem cleanup fails`, async t => {
    const f = await fixture(t), app = await f.open()
    const primary = Object.assign(new Error('primary operation failure'), { code: 'CONFLICT', details: { canceled: true } })
    const busy = Object.assign(new Error('simulated locked file'), { code: 'EBUSY' })
    const denied = Object.assign(new Error('simulated cleanup EPERM'), { code: 'EPERM' })
    const originalRm = fs.rm, originalCopy = fs.copyFile, originalRename = fs.rename
    const config = scenario === 'parse' ? { ...f.config, args: [...f.config.args, 'fail-parse'] } : f.config
    await app.ctx.plugin(BabelDOCSource, config)
    const source = app.ctx.get('ivoraige.parse').adapters.get('babeldoc')
    const output = app.ctx.get('ivoraige.outputs').adapters.get('pdf')
    const input = { content: pdf, language: 'en' }
    let binding
    if (scenario === 'rebuild' || scenario === 'publish-repair') {
      binding = (await source.parse(input)).sourceBinding
      if (scenario === 'publish-repair') await writeFile(binding.sourcePath, 'damaged saved source')
    }
    let cleanupCalls = 0
    const faults = { rm: async (path, ...args) => {
      if (String(path).startsWith(f.config.directory)) { cleanupCalls++; throw denied }
      return originalRm(path, ...args)
    } }
    if (scenario === 'publish-new') faults.copyFile = async (from, to, ...args) => {
      await originalCopy(from, to, ...args)
      if (String(to).includes('sources')) await writeFile(to, 'damaged during publication')
    }
    if (scenario === 'publish-repair') faults.rename = async (from, to, ...args) => {
      if (String(from).endsWith('.repair')) throw busy
      return originalRename(from, to, ...args)
    }
    if (scenario === 'rebuild') {
      // A valid source reaches the real rebuild path; writing its snapshot then
      // encounters the locked-file primary error before finally removes work.
      const originalWrite = fs.writeFile
      faults.writeFile = async (path, ...args) => {
        if (String(path).endsWith('snapshot.json')) throw busy
        return originalWrite(path, ...args)
      }
    }
    await filesystemFaults(faults, async () => {
      const operation = scenario === 'import'
        ? source.import(input, async () => { throw primary }, () => false)
        : scenario === 'rebuild'
          ? output.rebuild({ sourceBinding: binding, snapshot: { targetLang: 'zh' }, document: { language: 'en' }, units: [] })
          : source.parse(input)
      await assert.rejects(operation, error => {
        if (scenario === 'import') {
          assert.equal(error, primary)
          assert.equal(error.details.canceled, true)
        } else if (scenario === 'rebuild' || scenario === 'publish-repair') assert.equal(error, busy)
        else if (scenario === 'parse') {
          assert.equal(error.code, 'UPSTREAM_FAILURE')
          assert.match(error.message, /fixture parse failure/)
        } else if (scenario === 'publish-new') assert.equal(error.code, 'PRECONDITION_FAILED')
        else assert.equal(error, denied, 'Cleanup-only failure must not be hidden')
        if (scenario !== 'cleanup-only') {
          assert.ok(error.cleanupErrors.includes(denied))
          assert.equal(Object.keys(error).includes('cleanupErrors'), false)
        }
        return true
      })
    })
    assert.ok(cleanupCalls >= 1)
  })
}

test('BabelDOC keeps the pinned exact source-language binding contract', async t => {
  const f = await fixture(t), app = await f.open()
  await app.ctx.plugin(BabelDOCSource, f.config)
  const output = app.ctx.get('ivoraige.outputs').adapters.get('pdf')
  for (const language of ['en', 'zh', 'zh-CN', 'zh-Hans']) {
    const captureConfig = language === 'en' ? {} : { sourceLanguage: language }
    const request = { provenance: { language }, targetLang: language === 'en' ? 'zh' : 'en', binding: { captureConfig } }
    assert.doesNotThrow(() => output.validateExport(request))
    const changed = { sourceLanguage: language === 'en' ? 'en' : language === 'zh' ? 'zh-CN' : 'zh' }
    assert.throws(() => output.validateExport({ ...request, binding: { captureConfig: changed } }), /source language differs/)
  }
})


test('BabelDOC canonicalizes ancestor aliases but rejects a symlink managed root', async t => {
  const f = await fixture(t), app = await f.open()
  const alias = join(f.dir, 'alias')
  await symlink(f.dir, alias, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(async () => await app.ctx.plugin(BabelDOCSource,
    { ...f.config, directory: alias }), /directory must not be a symlink/)
  await app.ctx.plugin(BabelDOCSource, { ...f.config, directory: join(alias, 'pdf'), storePath: join(alias, 'db.sqlite') })
  const doc = await importPdf(app)
  const binding = app.records.record(doc.id).sourceBinding
  assert.equal(binding.sourcePath, await realpath(binding.sourcePath))
  const source = await app.exporter.exportDocument(doc.id, { contentMode: 'source', outputs: [{ format: 'pdf' }] })
  assert.deepEqual(await readFile(source.artifacts[0].path), pdf)
})
