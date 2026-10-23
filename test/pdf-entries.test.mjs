import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createApp } from '../src/app.mjs'
import { readPdfConfig, runCli } from '../src/cli.mjs'
import { serve } from '../src/http.mjs'

test('PDF config resolves relative assets and preserves bare commands and literal arguments', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-pdf-config-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'pdf.json')
  await writeFile(path, JSON.stringify({ command: 'python', args: ['-m', 'sidecar', './script.py'],
    modelDirs: { layout: './models/layout' }, options: { example: true }, timeoutMs: 30000 }))
  const value = await readPdfConfig(path)
  assert.equal(value.command, 'python')
  assert.deepEqual(value.args, ['-m', 'sidecar', resolve(dir, 'script.py')])
  assert.equal(value.modelDirs.layout, resolve(dir, 'models/layout'))
  await writeFile(path, JSON.stringify({ command: './sidecar', args: [] }))
  assert.equal((await readPdfConfig(path)).command, resolve(dir, 'sidecar'))
  await writeFile(path, JSON.stringify({ args: [] }))
  await assert.rejects(readPdfConfig(path), { code: 'INVALID_ARGUMENT' })
})

test('CLI rejects local PDF config on remote invocation', async t => {
  let out = '', err = ''
  const code = await runCli(['--url', 'http://127.0.0.1:1', '--pdf-config', 'pdf.json', 'capabilities', '--json'], {
    stdout: { write: text => { out += text } }, stderr: { write: text => { err += text } },
  })
  assert.equal(code, 2)
  assert.match(err, /only applies to a local kernel/)
  assert.equal(JSON.parse(out).error.code, 'INVALID_ARGUMENT')
})

test('PDF base64 remains binary at the operation boundary; text remains UTF-8', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-pdf-entry-'))
  const app = await createApp({ store: join(dir, 'records.sqlite') })
  t.after(async () => { await app.dispose(); await rm(dir, { recursive: true, force: true }) })
  const inputs = []
  app.tasks.importDocument = async (file, _metadata, options) => {
    inputs.push({ file, options })
    return file.format === 'txt' ? { taskId: 'import.text', document: { id: 'example' } } : { taskId: 'import.example' }
  }
  const binary = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0xff, 0x00])
  const pending = await app.operations.invoke('importDocument', { format: 'pdf', contentBase64: binary.toString('base64'), language: 'en' })
  assert.equal(pending.taskId, 'import.example')
  assert.equal(inputs[0].file.format, 'pdf')
  assert.equal(inputs[0].options.waitForQueued, false)
  assert.ok(Buffer.isBuffer(inputs[0].file.content))
  assert.deepEqual(inputs[0].file.content, binary)
  await app.operations.invoke('importDocument', { format: 'txt', contentBase64: Buffer.from('中文').toString('base64'), language: 'zh' })
  assert.equal(inputs[1].file.content, '中文')
  assert.equal(inputs[1].options.waitForQueued, false)
  await app.operations.invoke('importDocument', { path: join(dir, 'source.PDF'), language: 'en' })
  assert.equal(inputs[2].options.waitForQueued, false)
  await assert.rejects(app.operations.invoke('importDocument', {
    format: 'txt', contentBase64: binary.toString('base64'), language: 'en',
  }), { code: 'INVALID_ARGUMENT' })
})

test('PDF component status changes from unchecked to unavailable without disabling text', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-pdf-status-'))
  const app = await createApp({ store: join(dir, 'records.sqlite'),
    pdf: { command: join(dir, 'missing-sidecar.exe'), timeoutMs: 1000 } })
  t.after(async () => { await app.dispose(); await rm(dir, { recursive: true, force: true }) })
  const first = await app.operations.invoke('capabilities')
  assert.equal(first.components.babeldoc.state, 'unchecked')
  assert.ok(first.inputFormats.includes('pdf'))
  const { taskId } = await app.operations.invoke('importDocument', { format: 'pdf', language: 'en',
    contentBase64: Buffer.from('%PDF-1.4\n').toString('base64') })
  const failed = await app.tasks.wait(taskId)
  assert.equal(failed.state, 'failed')
  const after = await app.operations.invoke('capabilities')
  assert.equal(after.components.babeldoc.state, 'unavailable')
  assert.ok(!after.inputFormats.includes('pdf'))
  assert.ok(!after.outputFormats.includes('pdf'))
  const text = await app.operations.invoke('importDocument', { format: 'txt', language: 'en',
    contentBase64: Buffer.from('Text remains available.').toString('base64') })
  assert.equal(text.document.format, 'txt')
})

test('HTTP PDF import forwards binary bytes and validates base64', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-pdf-http-'))
  const app = await createApp({ store: join(dir, 'records.sqlite') })
  const server = await serve(app, { port: 0 })
  t.after(async () => { await server.close(); await app.dispose(); await rm(dir, { recursive: true, force: true }) })
  let captured
  app.tasks.importDocument = async (file, _metadata, options) => {
    captured = { file, options }
    return { taskId: 'import.example' }
  }
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff])
  const post = body => fetch(`${server.url}/api/documents/import`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const response = await post({ format: 'pdf', language: 'en', contentBase64: bytes.toString('base64') })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).taskId, 'import.example')
  assert.deepEqual(captured.file.content, bytes)
  assert.equal(captured.options.waitForQueued, false)
  const invalid = await post({ format: 'pdf', language: 'en', contentBase64: 'invalid!' })
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json()).error.code, 'INVALID_ARGUMENT')
  let output = '', error = ''
  let code = await runCli(['--url', server.url, '--no-wait', 'import',
    '--path', join(dir, 'remote.pdf'), '--source-lang', 'en', '--json'], {
    stdout: { write: text => { output += text } }, stderr: { write: text => { error += text } },
  })
  assert.equal(code, 0, error)
  assert.equal(JSON.parse(output).taskId, 'import.example')
  const invoke = app.operations.invoke.bind(app.operations)
  app.operations.invoke = (name, input) => name === 'getTask' ? Promise.resolve({ apiVersion: '2.0', task: {
    id: input.taskId, kind: 'import', state: 'succeeded', result: { document: { id: 'done', format: 'pdf' },
      deduplicated: false, warnings: [] },
  } }) : invoke(name, input)
  output = ''; error = ''
  code = await runCli(['--url', server.url, 'import', '--path', join(dir, 'remote.pdf'), '--source-lang', 'en', '--json'], {
    stdout: { write: text => { output += text } }, stderr: { write: text => { error += text } },
  })
  assert.equal(code, 0, error)
  assert.equal(JSON.parse(output).document.id, 'done')
  assert.equal(output.trim().split('\n').length, 1)
})

test('CLI PDF config starts a mock sidecar for local import', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-pdf-cli-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const sidecar = join(dir, 'mock-sidecar.mjs')
  const marker = join(dir, 'sidecar-ran.txt')
  const source = join(dir, 'source.pdf')
  const config = join(dir, 'pdf.json')
  await writeFile(source, Buffer.from('%PDF-1.4\nMock PDF\n'))
  await writeFile(sidecar, `
import { createInterface } from 'node:readline'
import { writeFileSync } from 'node:fs'
const marker = process.argv[2]
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method } = JSON.parse(line)
  if (method === 'handshake') send(id, { protocolVersion: 1, capabilities: { parse: ['pdf'] } })
  else if (method === 'configure') send(id, {})
  else if (method === 'parse') {
    writeFileSync(marker, 'parse')
    send(id, { doc: { format: 'pdf', title: 'Mock PDF', units: [
      { order: 0, kind: 'body', sourceText: 'Sample.', translatable: true,
        locator: { page: 1, bbox: [0, 0, 10, 10] } }],
      sourceBinding: { adapterId: 'babeldoc', records: [
        { order: 0, requestText: 'Sample.', placeholders: [] }] } } })
  } else if (method === 'shutdown') { send(id, {}); process.exit(0) }
}
`)
  await writeFile(config, JSON.stringify({ command: process.execPath,
    args: ['./mock-sidecar.mjs', './sidecar-ran.txt'], timeoutMs: 10000 }))
  let output = '', error = ''
  const store = join(dir, 'store.sqlite')
  const sink = { stdout: { write: text => { output += text } }, stderr: { write: text => { error += text } } }
  let code = await runCli(['--store', store, '--pdf-config', config, 'capabilities', '--json'], sink)
  assert.equal(code, 0, error)
  assert.ok(JSON.parse(output).inputFormats.includes('pdf'))
  output = ''; error = ''
  code = await runCli(['--store', store, '--pdf-config', config,
    'import', '--path', source, '--source-lang', 'en', '--json'], {
    stdout: { write: text => { output += text } }, stderr: { write: text => { error += text } },
  })
  assert.equal(code, 0, error)
  const document = JSON.parse(output).document
  assert.equal(document.format, 'pdf')
  assert.equal(await readFile(marker, 'utf8'), 'parse')
  output = ''; error = ''
  code = await runCli(['--store', store, 'documents', document.id, '--json'], sink)
  assert.equal(code, 0, error)
  assert.deepEqual(JSON.parse(output).document.availableOutputs.sort(), ['json', 'md'])
})
