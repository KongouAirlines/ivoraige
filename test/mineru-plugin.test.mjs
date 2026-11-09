import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createApp } from '../src/app.mjs'
import { AppBoot } from '../dist/dsh.mjs'
import { MinerUSource, projectStructured, verifyMineruBundle } from '../plugins/mineru/index.mjs'

const pdf = Buffer.from('%PDF-1.4\n%%EOF\n')

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-mineru-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function fakeRunner(dir, { nested = false } = {}) {
  const path = join(dir, 'fake-runner.mjs')
  await writeFile(path, `import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
for await (const line of createInterface({input:process.stdin})) {
const request = JSON.parse(line);
const send = result => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
if (request.method === 'handshake') {send({protocolVersion:1,capabilities:{parse:['pdf'],rebuild:['pdf']}});continue;}
if (request.method === 'configure') {send({});continue;}
if (request.method === 'shutdown') {send(null);break;}
if (request.method === 'rebuild') {
 const output=Buffer.from('%PDF-1.4\\n'+request.params.replacements.map(row=>row.text).join('|')+'\\n%%EOF\\n');
 await writeFile(request.params.outputPath,output,{flag:'wx'});
 send({sha256:createHash('sha256').update(output).digest('hex'),size:output.length});
 continue;
}
const output = request.params.options.outputDir;
await mkdir(join(output, 'images'), {recursive:true});
await writeFile(join(output, 'images', 'page_0_image_1.png'), Buffer.from([1,2,3]));
const blocks = [{type:'doc_title',index:0,content:[{type:'text',content:'A'}]},{type:'image',index:1,content:[]},{type:'text',index:2,content:[{type:'text',content:'B'}]}${nested ? ",{type:'chart',index:3,content:[{type:'chart_caption',index:4,content:[{type:'text',content:'Chart caption'}]},{type:'chart_body',index:5,content:'<table><tr><td>A</td></tr></table>'},{type:'chart_footnote',index:6,content:[{type:'text',content:'Chart source'}]}]}" : ''}].map((block,i)=>({...block,bbox:[1,2,3+i,4+i]}));
const pages = [{page_idx:0,blocks}];
await writeFile(join(output, 'middle_json.json'), JSON.stringify({schema:'docvortex.middle',schema_version:'2.0',pages,metadata:{producer:{name:'mineru',version:'4.0.10'}}}));
const views = blocks.map((block,i)=>({type:block.type,bbox:block.bbox,content:i===0?'A':i===1?{image_path:'images/page_0_image_1.png'}:i===2?'B':'Table body',...(i===3?{captions:[{content:'Chart caption'}],footnotes:[{content:'Chart source'}]}:{})}));
await writeFile(join(output, 'structured_content.json'), JSON.stringify({pages:[{page_idx:0,blocks:views}]}));
await writeFile(join(output, 'markdown.md'), '# A\\n\\nB\\n');
send({doc:{engineVersion:'4.0.10',schema:'docvortex.middle',schemaVersion:'2.0'}});
}
`)
  return path
}

test('MinerU source imports complete saved bundle and exports source MD/JSON without translation', async t => {
  const dir = await fixture(t)
  const runner = await fakeRunner(dir)
  const app = await createApp({ store: join(dir, 'db.sqlite') })
  await app.ctx.plugin(MinerUSource, { directory: join(dir, 'mineru-data'), storePath: join(dir, 'db.sqlite'),
    command: process.execPath, runner })
  t.after(() => app.dispose())
  const admitted = await app.operations.invoke('importDocument', { format: 'pdf', adapterId: 'mineru',
    contentBase64: pdf.toString('base64'), language: 'en', sourceId: 'synthetic' })
  const completed = await app.tasks.wait(admitted.taskId)
  assert.equal(completed.state, 'succeeded', JSON.stringify(completed))
  const document = app.records.listDocuments()[0]
  assert.equal(document.sourceAdapterId, 'mineru')
  assert.equal(document.translatableCount, 2)
  assert.equal(app.records.listUnits(document.id, { targetLang: 'zh' }).length, 3)
  const record = app.records.record(document.id)
  assert.equal(record.sourceIR.resources.length, 1)
  assert.equal(record.sourceBinding.engineVersion, '4.0.10')
  assert.equal(await verifyMineruBundle(record.sourceBinding,
    { directory: join(dir, 'mineru-data'), storePath: join(dir, 'db.sqlite') }), true)
  assert.deepEqual(await readFile(record.sourceBinding.sourcePath), pdf)
  const middle = JSON.parse(await readFile(join(record.sourceBinding.bundlePath, 'middle_json.json')))
  assert.equal(middle.schema, 'docvortex.middle')
  assert.deepEqual(await readFile(join(record.sourceBinding.bundlePath, 'images', 'page_0_image_1.png')),
    Buffer.from([1, 2, 3]))
  const exported = await app.exporter.exportDocument(document.id, { contentMode: 'source',
    outputs: [{ format: 'md' }, { format: 'json' }] })
  const output = JSON.parse(await readFile(exported.artifacts.find(a => a.format === 'json').path))
  assert.equal(output.contentMode, 'source')
  assert.equal(output.units.length, 3)
  assert.equal(app.records.listSnapshots(document.id).length, 1)
  assert.equal(app.records.listTasks().filter(task => task.kind === 'translate').length, 0)
  await app.dispose()
  const reopened = await createApp({ store: join(dir, 'db.sqlite') })
  await reopened.ctx.plugin(MinerUSource, { directory: join(dir, 'mineru-data'), storePath: join(dir, 'db.sqlite'),
    command: process.execPath, runner })
  assert.equal(reopened.records.getDocument(document.id).sourceAdapterId, 'mineru')
  await reopened.dispose()
})

test('MinerU nested chart captions and footnotes remain in frozen source MD/JSON', async t => {
  const dir = await fixture(t)
  const runner = await fakeRunner(dir, { nested: true })
  const app = await createApp({ store: join(dir, 'db.sqlite') })
  await app.ctx.plugin(MinerUSource, { directory: join(dir, 'mineru-data'), command: process.execPath, runner })
  t.after(() => app.dispose())
  const admitted = await app.operations.invoke('importDocument', { format: 'pdf', adapterId: 'mineru',
    contentBase64: pdf.toString('base64'), language: 'en', sourceId: 'nested' })
  const imported = await app.tasks.wait(admitted.taskId)
  assert.equal(imported.state, 'succeeded', JSON.stringify(imported))
  const docId = imported.result.document.id
  const record = app.records.record(docId)
  assert.equal(record.sourceBinding.projectionVersion, 2)
  assert.deepEqual(record.units.map(unit => unit.sourceText),
    ['A', '[image]', 'B', 'Chart caption', 'Table body', 'Chart source'])
  assert.equal(record.units[3].kind, 'caption')
  assert.equal(record.units[3].locator.childOrder, 0)
  assert.equal(record.units[3].locator.childType, 'chart_caption')
  assert.equal(record.units[3].locator.part, 'caption')
  assert.equal(record.units[5].locator.childOrder, 2)
  assert.equal(record.units[5].locator.part, 'footnote')
  const exported = await app.exporter.exportDocument(docId, { contentMode: 'source',
    outputs: [{ format: 'md' }, { format: 'json' }] })
  const markdown = await readFile(exported.artifacts.find(item => item.format === 'md').path, 'utf8')
  const json = JSON.parse(await readFile(exported.artifacts.find(item => item.format === 'json').path))
  assert.match(markdown, /Chart caption/)
  assert.match(markdown, /Chart source/)
  assert.deepEqual(json.units.map(unit => unit.sourceText), record.units.map(unit => unit.sourceText))
  assert.equal(new Set(exported.artifacts.map(item => item.snapshotId)).size, 1)
  assert.equal(app.records.listTasks().filter(task => task.kind === 'translate').length, 0)
  for (const [unitIndex, text] of [[3, '图注译文'], [5, '脚注译文']]) {
    const revision = await app.records.writeRevision(record.units[unitIndex].id,
      { targetLang: 'zh', text, baseRevisionId: null })
    await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  }
  const accepted = await app.exporter.exportDocument(docId, { targetLang: 'zh',
    onMissingAccepted: 'skip', outputs: [{ format: 'pdf' }, { format: 'md' }, { format: 'json' }] })
  assert.match((await readFile(accepted.artifacts.find(item => item.format === 'pdf').path)).toString(),
    /图注译文\|脚注译文/)
  assert.equal(new Set(accepted.artifacts.map(item => item.snapshotId)).size, 1)
  const middle = JSON.parse(await readFile(join(record.sourceBinding.bundlePath, 'middle_json.json')))
  const structured = JSON.parse(await readFile(join(record.sourceBinding.bundlePath, 'structured_content.json')))
  assert.deepEqual(projectStructured(middle, structured, record.sourceBinding.bundlePath,
    record.sourceBinding.files, { projectionVersion: 1 }).units.map(unit => unit.sourceText),
  ['A', '[image]', 'B', 'Table body'])
  const legacy = projectStructured(middle, structured, record.sourceBinding.bundlePath,
    record.sourceBinding.files, { projectionVersion: 1 })
  legacy.sourceBinding = structuredClone(record.sourceBinding)
  delete legacy.sourceBinding.projectionVersion
  Object.assign(legacy, { sourceAdapterId: 'mineru', sourceAdapterVersion: '0.1.0',
    bindingSchemaVersion: 1, availableOutputs: ['pdf', 'md', 'json'] })
  const old = await app.records.persistParsed({ format: 'pdf' },
    { sourceId: 'nested-before-caption-fix', language: 'en', origin: 'cli' }, legacy)
  const oldTitle = app.records.listUnits(old.document.id, { targetLang: 'zh' })[0]
  const oldRevision = await app.records.writeRevision(oldTitle.id,
    { targetLang: 'zh', text: '旧版标题', baseRevisionId: null })
  await app.records.acceptRevision(oldRevision.id, { expectedAcceptedRevisionId: null })
  const oldOutput = await app.exporter.exportDocument(old.document.id, { targetLang: 'zh',
    onMissingAccepted: 'skip', outputs: [{ format: 'pdf' }] })
  assert.match((await readFile(oldOutput.artifacts[0].path)).toString(), /旧版标题/)
  middle.pages[0].blocks[3].content.splice(0, 1)
  assert.throws(() => projectStructured(middle, structured, record.sourceBinding.bundlePath,
    record.sourceBinding.files), { code: 'UPSTREAM_FAILURE' })
})

test('MinerU PDF output replays frozen accepted text without a translation call', async t => {
  const dir = await fixture(t)
  const runner = await fakeRunner(dir)
  const store = join(dir, 'db.sqlite'), directory = join(dir, 'mineru-data')
  let app = await createApp({ store })
  await app.ctx.plugin(MinerUSource, { directory, command: process.execPath, runner })
  const admitted = await app.operations.invoke('importDocument', { format: 'pdf', adapterId: 'mineru',
    contentBase64: pdf.toString('base64'), language: 'en', sourceId: 'synthetic' })
  const imported = await app.tasks.wait(admitted.taskId)
  assert.equal(imported.state, 'succeeded')
  assert.equal(app.outputs.adapters.get('mineru-pdf').status().state, 'unchecked')
  const docId = imported.result.document.id
  const source = await app.exporter.exportDocument(docId, { contentMode: 'source',
    outputs: [{ format: 'pdf' }] })
  assert.equal(source.artifacts[0].adapterId, 'mineru-pdf')
  assert.deepEqual(await readFile(source.artifacts[0].path), pdf)
  const units = app.records.listUnits(docId, { targetLang: 'zh' }).filter(unit => unit.translatable)
  const accepted = []
  for (const [index, unit] of units.entries()) {
    const revision = await app.records.writeRevision(unit.id, { targetLang: 'zh',
      text: `译文${index}`, baseRevisionId: null })
    await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
    accepted.push(revision)
  }
  const first = await app.exporter.exportDocument(docId, { targetLang: 'zh',
    outputs: [{ format: 'pdf' }, { format: 'md' }, { format: 'json' }] })
  const pdfBytes = await readFile(first.artifacts.find(artifact => artifact.format === 'pdf').path)
  assert.equal(app.outputs.adapters.get('mineru-pdf').status().state, 'ready')
  assert.match(pdfBytes.toString(), /译文0\|译文1/)
  assert.equal(first.artifacts.find(artifact => artifact.format === 'pdf').adapterId, 'mineru-pdf')
  assert.deepEqual(new Set(first.artifacts.map(artifact => artifact.snapshotId)), new Set([first.snapshotId]))
  const newer = await app.records.writeRevision(units[0].id, { targetLang: 'zh',
    text: '新版译文', baseRevisionId: accepted[0].id })
  await app.records.acceptRevision(newer.id, { expectedAcceptedRevisionId: accepted[0].id })
  await app.dispose()
  app = await createApp({ store })
  await app.ctx.plugin(MinerUSource, { directory, command: process.execPath, runner })
  const replay = await app.exporter.exportDocument(docId, { targetLang: 'zh', snapshotId: first.snapshotId,
    outputs: [{ format: 'pdf' }] })
  assert.deepEqual(await readFile(replay.artifacts[0].path), pdfBytes)
  const current = await app.exporter.exportDocument(docId, { targetLang: 'zh',
    outputs: [{ format: 'pdf' }] })
  assert.match((await readFile(current.artifacts[0].path)).toString(), /新版译文/)
  assert.equal(app.records.listTasks().filter(task => task.kind === 'translate').length, 0)
  const frozen = app.records.resolveSnapshot(docId, first.snapshotId)
  frozen.units[0].unit.locator.bbox[0] += 1
  await assert.rejects(app.outputs.get('pdf', { binding: frozen.sourceBinding }).rebuild(frozen),
    { code: 'PRECONDITION_FAILED' })
  await app.dispose()
  app = await createApp({ store })
  await app.ctx.plugin(MinerUSource, { directory, command: '/missing/mineru/python' })
  const originalWithoutRuntime = await app.exporter.exportDocument(docId, { contentMode: 'source',
    outputs: [{ format: 'pdf' }] })
  assert.deepEqual(await readFile(originalWithoutRuntime.artifacts[0].path), pdf)
  await assert.rejects(app.exporter.exportDocument(docId, { targetLang: 'zh', snapshotId: first.snapshotId,
    outputs: [{ format: 'pdf' }] }), { code: 'COMPONENT_MISSING' })
  assert.equal(app.outputs.adapters.get('mineru-pdf').status().state, 'unavailable')
  const binding = app.records.record(docId).sourceBinding
  await rm(join(binding.bundlePath, 'images', 'page_0_image_1.png'))
  await assert.rejects(app.exporter.exportDocument(docId, { targetLang: 'zh', snapshotId: first.snapshotId,
    outputs: [{ format: 'pdf' }] }), { code: 'PRECONDITION_FAILED' })
  assert.deepEqual(await readFile(originalWithoutRuntime.artifacts[0].path), pdf)
  await app.dispose()
})

test('DSH profile loads a locally installed package, and disabling its row preserves other sources', async t => {
  const dir = await fixture(t)
  const settingsDir = join(dir, 'settings')
  const store = join(dir, 'db.sqlite')
  let app = await createApp({ store, settingsDir })
  await app.dispose()
  const packageDir = join(settingsDir, 'node_modules', '@ivoraige', 'mineru-source')
  await mkdir(join(settingsDir, 'node_modules', '@ivoraige'), { recursive: true })
  await cp(new URL('../plugins/mineru/', import.meta.url), packageDir, { recursive: true })
  assert.equal(AppBoot.getDshRuntimeVersion(), '0.2.0-rc.2')
  const runner = await fakeRunner(dir)
  const patch = disabled => JSON.stringify([{ insert: [{ id: 'mineru-source',
    name: './node_modules/@ivoraige/mineru-source/index.mjs', disabled, config: {
      directory: join(dir, 'mineru-data'), storePath: store, command: process.execPath, runner,
    } }] }])
  await writeFile(join(settingsDir, 'cordis.patch.yml'), patch(false))
  app = await createApp({ store, settingsDir })
  assert.equal(app.parse.adapters.has('mineru'), true)
  await app.dispose()
  const manifestPath = join(packageDir, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  await writeFile(manifestPath, JSON.stringify({ ...manifest,
    peerDependencies: { '@deepseek-ai/dsh-app-boot': '0.0.0' } }))
  app = await createApp({ store, settingsDir })
  assert.equal(app.parse.adapters.has('mineru'), false)
  assert.equal(app.parse.adapters.has('txt'), true)
  await app.dispose()
  await writeFile(manifestPath, JSON.stringify(manifest))
  await writeFile(join(settingsDir, 'cordis.patch.yml'), patch(true))
  app = await createApp({ store, settingsDir })
  assert.equal(app.parse.adapters.has('mineru'), false)
  assert.equal(app.parse.adapters.has('txt'), true)
  await app.dispose()
})

test('a second store cannot claim the first store\'s saved bundle', async t => {
  const dir = await fixture(t)
  const runner = await fakeRunner(dir)
  const root = join(dir, 'shared-mineru-data')
  const bindings = []
  for (const store of ['first.sqlite', 'second.sqlite']) {
    const storePath = join(dir, store)
    const app = await createApp({ store: storePath })
    await app.ctx.plugin(MinerUSource, { directory: root, storePath, command: process.execPath, runner })
    const admitted = await app.operations.invoke('importDocument', { format: 'pdf', adapterId: 'mineru',
      contentBase64: pdf.toString('base64'), language: 'en', sourceId: 'synthetic' })
    assert.equal((await app.tasks.wait(admitted.taskId)).state, 'succeeded')
    bindings.push(app.records.record(app.records.listDocuments()[0].id).sourceBinding)
    await app.dispose()
  }
  assert.notEqual(bindings[0].bundlePath, bindings[1].bundlePath)
  await assert.rejects(verifyMineruBundle(bindings[0], { directory: root, storePath: join(dir, 'second.sqlite') }),
    { code: 'PRECONDITION_FAILED' })
  await rm(join(bindings[0].bundlePath, 'images', 'page_0_image_1.png'))
  await assert.rejects(verifyMineruBundle(bindings[0], { directory: root, storePath: join(dir, 'first.sqlite') }),
    { code: 'PRECONDITION_FAILED' })
  assert.equal(await verifyMineruBundle(bindings[1], { directory: root, storePath: join(dir, 'second.sqlite') }), true)
})

test('case-distinct store files never share a MinerU bundle on a case-sensitive directory', async t => {
  const dir = await fixture(t)
  const stores = [join(dir, 'A.sqlite'), join(dir, 'a.sqlite')]
  for (const store of stores) await writeFile(store, '')
  const names = await readdir(dir)
  if (!names.includes('A.sqlite') || !names.includes('a.sqlite'))
    return t.skip('filesystem does not distinguish store filename case')
  const runner = await fakeRunner(dir)
  const root = join(dir, 'shared-mineru-data')
  const bindings = []
  for (const store of stores) {
    const app = await createApp({ store })
    await app.ctx.plugin(MinerUSource, { directory: root, storePath: store,
      command: process.execPath, runner })
    const admitted = await app.operations.invoke('importDocument', { format: 'pdf', adapterId: 'mineru',
      contentBase64: pdf.toString('base64'), language: 'en', sourceId: 'synthetic' })
    const task = await app.tasks.wait(admitted.taskId)
    assert.equal(task.state, 'succeeded')
    bindings.push(app.records.record(task.result.document.id).sourceBinding)
    await app.dispose()
  }
  assert.notEqual(bindings[0].bundlePath, bindings[1].bundlePath)
  await assert.rejects(verifyMineruBundle(bindings[0], { directory: root, storePath: stores[1] }),
    { code: 'PRECONDITION_FAILED' })
  assert.equal(await verifyMineruBundle(bindings[1], { directory: root, storePath: stores[1] }), true)
})

test('physical store identity survives an aliased parent but rejects another owner', async t => {
  if (process.platform === 'win32') return t.skip('directory symlink permissions vary on Windows')
  const dir = await fixture(t)
  const physical = join(dir, 'physical')
  const alias = join(dir, 'alias')
  await mkdir(physical)
  await symlink(physical, alias, 'dir')
  const store = join(alias, 'db.sqlite')
  const root = join(alias, 'mineru-data')
  const runner = await fakeRunner(dir)
  const app = await createApp({ store })
  await app.ctx.plugin(MinerUSource, { directory: root, storePath: store,
    command: process.execPath, runner })
  const admitted = await app.operations.invoke('importDocument', { format: 'pdf', adapterId: 'mineru',
    contentBase64: pdf.toString('base64'), language: 'en', sourceId: 'synthetic' })
  assert.equal((await app.tasks.wait(admitted.taskId)).state, 'succeeded')
  const binding = app.records.record(app.records.listDocuments()[0].id).sourceBinding
  assert.equal(await verifyMineruBundle(binding, { directory: root, storePath: store }), true)
  await assert.rejects(verifyMineruBundle(binding, { directory: root, storePath: join(dir, 'other.sqlite') }),
    { code: 'PRECONDITION_FAILED' })
  await app.dispose()
})

test('managed work and sources symlinks cannot write outside the bundle root', async t => {
  if (process.platform === 'win32') return t.skip('symlink permissions vary on Windows')
  const dir = await fixture(t)
  const runner = await fakeRunner(dir)
  for (const child of ['work', 'sources']) {
    const root = join(dir, `mineru-${child}`)
    const outside = join(dir, `outside-${child}`)
    await mkdir(root)
    await mkdir(outside)
    await writeFile(join(outside, 'marker'), 'keep')
    await symlink(outside, join(root, child), 'dir')
    const store = join(dir, `${child}.sqlite`)
    const app = await createApp({ store })
    await app.ctx.plugin(MinerUSource, { directory: root, storePath: store,
      command: process.execPath, runner })
    const admitted = await app.operations.invoke('importDocument', { format: 'pdf', adapterId: 'mineru',
      contentBase64: pdf.toString('base64'), language: 'en', sourceId: 'synthetic' })
    const task = await app.tasks.wait(admitted.taskId)
    assert.equal(task.state, 'failed', `${child}: ${JSON.stringify(task)}`)
    assert.equal(await readFile(join(outside, 'marker'), 'utf8'), 'keep')
    assert.deepEqual(await readdir(outside), ['marker'])
    assert.equal(app.records.listDocuments().length, 0)
    await app.dispose()
  }
})

test('sidecar diagnostics stay out of task and adapter status but remain in local diagnostics', async t => {
  const dir = await fixture(t)
  const runner = join(dir, 'failed-runner.mjs')
  await writeFile(runner, `import { createInterface } from 'node:readline';
for await (const line of createInterface({input:process.stdin})) {
 const req=JSON.parse(line);
 if (req.method==='handshake') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result:{protocolVersion:1,capabilities:{parse:['pdf']}}})+'\\n');
 else if (req.method==='configure') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result:{}})+'\\n');
 else if (req.method==='shutdown') { process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result:null})+'\\n'); break; }
 else { process.stderr.write('SENTINEL_PRIVATE_SOURCE'); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,error:{code:-32001,message:'SENTINEL_PRIVATE_SOURCE',diagnostic:'SENTINEL_PRIVATE_SOURCE'}})+'\\n'); }
}`)
  const app = await createApp({ store: join(dir, 'db.sqlite') })
  await app.ctx.plugin(MinerUSource, { directory: join(dir, 'mineru-data'), storePath: join(dir, 'db.sqlite'),
    command: process.execPath, runner })
  let logged = ''
  const originalLog = console.error
  console.error = (...parts) => { logged += parts.join(' ') }
  t.after(() => { console.error = originalLog })
  const admitted = await app.operations.invoke('importDocument', { format: 'pdf', adapterId: 'mineru',
    contentBase64: pdf.toString('base64'), language: 'en' })
  const task = await app.tasks.wait(admitted.taskId)
  assert.equal(task.state, 'failed')
  assert.doesNotMatch(JSON.stringify(task), /SENTINEL_PRIVATE_SOURCE/)
  assert.doesNotMatch(JSON.stringify(app.parse.componentStatus()), /SENTINEL_PRIVATE_SOURCE/)
  assert.match(logged, /SENTINEL_PRIVATE_SOURCE/)
  await app.dispose()
})

test('structured projection follows real MinerU ordered type/bbox identity without a structured index', () => {
  const middle = { schema: 'docvortex.middle', schema_version: '2.0', pages: [{ page_idx: 0,
    blocks: [{ type: 'doc_title', index: 0, bbox: [1, 2, 3, 4], content: [{ type: 'text', content: 'Title' }] },
      { type: 'paragraph_title', index: 2, bbox: [1, 5, 3, 6], content: [{ type: 'text', content: 'Section' }] }] }] }
  const structured = { pages: [{ page_idx: 0, blocks: [
    { type: 'doc_title', bbox: [1, 2, 3, 4], content: 'Title' },
    { type: 'paragraph_title', bbox: [1, 5, 3, 6], content: 'Section' }] }] }
  const projected = projectStructured(middle, structured, '/bundle', [])
  assert.deepEqual(projected.units.map(unit => [unit.kind, unit.translatable, unit.locator.index]),
    [['heading', true, 0], ['heading', true, 2]])
  assert.throws(() => projectStructured(
    { schema: 'docvortex.middle', schema_version: '2.0', pages: [{ page_idx: 0,
      blocks: [{ type: 'text', index: 1, bbox: [1, 2, 3, 4] }] }] },
    { pages: [{ page_idx: 0, blocks: [{ type: 'text', bbox: [1, 2, 3, 5], content: 'wrong' }] }] },
    '/bundle', []), { code: 'UPSTREAM_FAILURE' })
})

test('MinerU annotation projection follows upstream index order and retains rendered Markdown', () => {
  const bbox = [0.1, 0.1, 0.9, 0.9]
  const middle = { schema: 'docvortex.middle', schema_version: '2.0', pages: [{ page_idx: 0,
    blocks: [{ type: 'table', index: 9, bbox, content: [
      { type: 'table_caption', index: 10, content: [{ type: 'text', content: 'Later' }] },
      { type: 'table_caption', index: 8, content: [{ type: 'text', content: 'A*B' }] },
      { type: 'table_body', index: 9, content: '<table/>' },
    ] }] }] }
  const structured = { pages: [{ page_idx: 0, blocks: [{ type: 'table', bbox,
    content: 'Table body', captions: [{ content: 'A\\*B' }, { content: 'Later' }], footnotes: [] }] }] }
  const units = projectStructured(middle, structured, '/bundle', []).units
  assert.deepEqual(units.map(unit => unit.sourceText), ['A\\*B', 'Later', 'Table body'])
  assert.deepEqual(units.slice(0, 2).map(unit => unit.locator.childOrder), [1, 0])
  assert.deepEqual(units.slice(0, 2).map(unit => unit.locator.itemIndex), [0, 1])
})

test('Python runner handshakes before recognizing MinerU and never emits a raw traceback as a message', t => {
  const python = process.platform === 'win32' ? 'python' : 'python3'
  const probe = spawnSync(python, ['--version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) return t.skip('Python is unavailable')
  const runner = new URL('../plugins/mineru/runner.py', import.meta.url)
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'handshake', params: { protocolVersion: 99 } },
    { jsonrpc: '2.0', id: 2, method: 'handshake', params: { protocolVersion: 1 } },
    { jsonrpc: '2.0', id: 3, method: 'parse', params: { path: '/missing.pdf' } },
    { jsonrpc: '2.0', id: 4, method: 'shutdown', params: {} },
  ].map(value => JSON.stringify(value)).join('\n') + '\n'
  const result = spawnSync(python, [fileURLToPath(runner)], { input, encoding: 'utf8' })
  assert.equal(result.status, 0)
  const messages = result.stdout.trim().split('\n').map(JSON.parse)
  assert.equal(messages.length, 4)
  assert.equal(messages[0].error.code, -32002)
  assert.equal(messages[1].result.protocolVersion, 1)
  assert.equal(messages[2].error.code, -32002)
  assert.doesNotMatch(messages[2].error.message, /Traceback|\/missing\.pdf/)
})

test('Python replay rejects complex inline text and reads only inventoried assets', t => {
  const python = process.platform === 'win32' ? 'python' : 'python3'
  const probe = spawnSync(python, ['--version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) return t.skip('Python is unavailable')
  const check = fileURLToPath(new URL('./mineru-runner-rebuild.py', import.meta.url))
  const runner = fileURLToPath(new URL('../plugins/mineru/runner.py', import.meta.url))
  const result = spawnSync(python, [check, runner], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /frozen span and asset guards passed/)
})

test('sidecar cancellation waits for a delayed child exit', async t => {
  if (process.platform === 'win32') return t.skip('SIGTERM delay probe is Unix-specific')
  const dir = await fixture(t)
  const runner = join(dir, 'delayed-runner.mjs')
  const started = join(dir, 'started')
  const exited = join(dir, 'exited')
  await writeFile(runner, `import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
const started=${JSON.stringify(started)}, exited=${JSON.stringify(exited)};
for await (const line of createInterface({input:process.stdin})) {
 const req=JSON.parse(line);
 if(req.method==='handshake') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result:{protocolVersion:1}})+'\\n');
 else if(req.method==='configure') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result:{}})+'\\n');
 else if(req.method==='parse') {
   await writeFile(started,'yes');
   process.on('SIGTERM',()=>setTimeout(async()=>{await writeFile(exited,'yes');process.exit(0)},180));
   await new Promise(()=>{});
 }
}`)
  const app = await createApp({ store: join(dir, 'db.sqlite') })
  const client = app.ctx.get('ivoraige.sidecarFactory').create({ command: process.execPath,
    args: [runner], timeoutMs: 5000 })
  const controller = new AbortController()
  const pending = client.request('parse', {}, { signal: controller.signal })
  let exists = false
  for (let tries = 0; tries < 100 && !exists; tries++) {
    exists = await readFile(started).then(() => true, () => false)
    if (!exists) await new Promise(done => setTimeout(done, 20))
  }
  assert.equal(exists, true)
  const before = Date.now()
  controller.abort()
  await assert.rejects(pending, { code: 'UPSTREAM_FAILURE' })
  assert.ok(Date.now() - before >= 150)
  assert.equal(await readFile(exited, 'utf8'), 'yes')
  await client.close()
  await app.dispose()
})
