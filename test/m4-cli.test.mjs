import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/cli.mjs'


test('CLI defaults, status, explicit draft selection and repeat-safe translation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ivoraige-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let requests = 0
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* consume request */ }
    requests++
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end('data: {"choices":[{"index":0,"delta":{"content":"译文。"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  const store = join(root, 'store'), input = join(root, 'input.txt'), changed = join(root, 'changed.txt')
  const md = join(root, 'output.md'), json = join(root, 'output.json'), configPath = join(root, 'config.json')
  await writeFile(input, '自旋波传播。\n\n磁化保持。')
  await writeFile(changed, '自旋波缓慢传播。')
  const config = { store, defaults: { sourceLanguage: 'zh', targetLanguage: 'en', libraries: ['magnetism'], outputs: { md, json } }, model: { network: false, roles: { translation: { provider: 'local', model: 'mock', baseURL: `http://127.0.0.1:${server.address().port}/v1`, maxTokens: 128 } } } }
  await writeFile(configPath, JSON.stringify(config))
  async function run(...args) {
    const write = process.stdout.write
    process.stdout.write = () => true
    try { return await main([...args, '--config', configPath]) }
    finally { process.stdout.write = write }
  }
  await run('terms', 'create', 'magnetism')
  const doc = await run('import', input, '--id', 'sample')
  assert.equal(doc.sourceLanguage, 'zh'); assert.equal(doc.target.language, 'en'); assert.deepEqual(doc.libraries, ['magnetism'])
  assert.equal((await run('list'))[0].exportable, false)
  assert.equal((await run('status', 'sample')).details.length, 2)
  const translated = await run('translate', 'sample')
  assert.equal(translated.status, 'completed'); assert.equal(requests, 2)
  const selected = await run('accept-drafts', 'sample')
  assert.equal(selected.accepted.length, 2); assert.equal(selected.skipped.length, 0)
  assert.equal((await run('status', 'sample')).exportable, true)
  await run('export', 'sample')
  assert.match(await readFile(md, 'utf8'), /译文。/)
  assert.equal(JSON.parse(await readFile(json, 'utf8')).units.length, 2)
  await run('import', input, '--id', 'sample')
  const repeated = await run('translate', 'sample')
  assert.ok(repeated.units.every(unit => unit.status === 'reused')); assert.equal(requests, 2)
  await run('source-edit', 'sample', doc.units[0].id, changed)
  await run('translate', 'sample')
  const skipped = await run('accept-drafts', 'sample')
  assert.equal(skipped.accepted.length, 0); assert.equal(skipped.skipped.length, 2)
  assert.equal((await run('status', 'sample')).exportable, false)
  await assert.rejects(run('export', 'sample'), /Missing applicable accepted revision/)

  const stale = await run('import', input, '--id', 'stale')
  await run('translate', 'stale')
  await run('source-edit', 'stale', stale.units[0].id, changed)
  const staleSelection = await run('accept-drafts', 'stale')
  assert.equal(staleSelection.accepted.length, 0)
  assert.equal(staleSelection.skipped.length, 2)
  assert.ok(staleSelection.skipped.every(unit => unit.reason === 'No current draft'))
})
