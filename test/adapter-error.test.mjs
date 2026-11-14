import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'
import { runCli } from '../src/cli.mjs'
import { serve } from '../src/http.mjs'
import { errorEnvelope } from '../src/protocol.mjs'
import { z } from '../dist/dsh.mjs'
import MinerUSource from '../plugins/mineru/index.mjs'

const capture = () => { let value = ''; return { write: chunk => { value += chunk }, get value() { return value } } }

test('independent MinerU errors retain public HTTP and CLI meaning', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-mineru-adapter-error-'))
  const store = join(directory, 'records.sqlite')
  const app = await createApp({ store })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  await app.ctx.plugin(MinerUSource, { directory: join(directory, 'pdf'), storePath: store })
  const unregister = app.operationCatalog.register({ id: 'probeAdapterError', inputSchema: z.object({}).strict(),
    resultSchema: z.object({}).strict(), handler: () => app.parse.parse({ adapterId: 'mineru', format: 'pdf',
      content: Buffer.from('not a PDF') }) })
  t.after(unregister)
  const server = await serve(app, { port: 0 })
  t.after(() => server.close())
  const response = await fetch(`${server.url}/api/operations/probeAdapterError`, { method: 'POST', body: '{}' })
  const body = await response.json()
  assert.equal(response.status, 412)
  assert.equal(body.error.code, 'PRECONDITION_FAILED')
  assert.equal(body.error.message, 'Use document import to retain MinerU resources')
  const stdout = capture(), stderr = capture()
  const exit = await runCli(['--json', 'call', 'probeAdapterError', '--set', '{}'], { app, stdout, stderr })
  assert.equal(exit, 3)
  assert.deepEqual(JSON.parse(stdout.value), body)
  assert.match(stderr.value, /Use document import to retain MinerU resources/)
})

test('independent MinerU import failure retains the actionable task message', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-mineru-task-error-'))
  const store = join(directory, 'records.sqlite')
  const app = await createApp({ store })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  await app.ctx.plugin(MinerUSource, { directory: join(directory, 'pdf'), storePath: store })
  const admitted = await app.operations.invoke('importDocument', { adapterId: 'mineru', format: 'pdf',
    contentBase64: Buffer.from('not a PDF').toString('base64'), language: 'en', sourceId: 'bad-mineru' })
  const task = await app.tasks.wait(admitted.taskId)
  assert.equal(task.state, 'failed')
  assert.equal(task.error?.message, 'Input is not a PDF file')
})

test('generic adapter errors cannot impersonate public KernelError codes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-generic-adapter-error-'))
  const app = await createApp({ store: join(directory, 'records.sqlite') })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  const foreign = new Error('private failure')
  foreign.code = 'INVALID_ARGUMENT'
  app.parse.register({ id: 'foreign-error', formats: ['foreign'], match: () => 1, parse: () => { throw foreign } })
  await assert.rejects(app.parse.parse({ format: 'foreign', adapterId: 'foreign-error', content: 'data' }), error => {
    const mapped = errorEnvelope(error)
    assert.equal(mapped.status, 500)
    assert.equal(mapped.body.error.message, 'Internal operation failed')
    assert.doesNotMatch(JSON.stringify(mapped.body), /private failure/)
    return true
  })
})

test('class adapters retain inherited callbacks, private receiver and live descriptors', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-class-adapter-error-'))
  const app = await createApp({ store: join(directory, 'records.sqlite') })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  class KernelError extends Error {
    constructor(code, message) { super(message); this.code = code }
  }
  class BaseSource {
    #version = 'class-1'
    #calls = 0
    get version() { return this.#version }
    get calls() { return this.#calls }
    get status() { return () => ({ state: this.#version ? 'ready' : 'failed' }) }
    match(file) { this.#calls++; return file.format === 'class' ? 1 : 0 }
    async parse(file) {
      this.#calls++
      if (file.content === 'bad') throw new KernelError('INVALID_ARGUMENT', 'Class source rejected input')
      return { format: 'class', title: 'Class source',
        units: [{ order: 0, kind: 'body', sourceText: file.content, translatable: true }],
        sourceBinding: { adapterId: 'class-source' } }
    }
  }
  class Source extends BaseSource {
    id = 'class-source'
    formats = ['class']
    inputKinds = ['text']
  }
  const source = new Source()
  app.parse.register(source)
  const registered = app.parse.adapters.get(source.id)
  assert.equal(registered.version, 'class-1')
  assert.equal(registered.status().state, 'ready')
  const parsed = await app.parse.parse({ format: 'class', adapterId: source.id, content: 'good' })
  assert.equal(parsed.sourceAdapterVersion, 'class-1')
  assert.equal(source.calls, 2)
  await assert.rejects(app.parse.parse({ format: 'class', adapterId: source.id, content: 'bad' }),
    { code: 'INVALID_ARGUMENT', message: 'Class source rejected input' })
  const oldMatch = registered.match
  source.match = () => 0
  assert.notEqual(registered.match, oldMatch)
  await assert.rejects(app.parse.parse({ format: 'class', adapterId: source.id, content: 'no match' }),
    { code: 'INVALID_ARGUMENT' })
})

test('frozen adapter descriptors and original registration identity are preserved', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-frozen-adapter-error-'))
  const app = await createApp({ store: join(directory, 'records.sqlite') })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  class KernelError extends Error {
    constructor(code, message) { super(message); this.code = code }
  }
  const source = Object.freeze({ id: 'frozen-source', version: 'frozen-1', formats: ['frozen'],
    inputKinds: ['text'], match: file => file.format === 'frozen' ? 1 : 0,
    parse: file => {
      if (file.content === 'bad') throw new KernelError('INVALID_ARGUMENT', 'Frozen source rejected input')
      return { format: 'frozen', title: 'Frozen source',
        units: [{ order: 0, kind: 'body', sourceText: file.content, translatable: true }],
        sourceBinding: { adapterId: 'frozen-source' } }
    } })
  const remove = app.parse.register(source)
  assert.equal(app.parse.adapters.get(source.id), source)
  assert.equal((await app.parse.parse({ format: 'frozen', adapterId: source.id,
    content: 'good' })).sourceAdapterVersion, 'frozen-1')
  await assert.rejects(app.parse.parse({ format: 'frozen', adapterId: source.id, content: 'bad' }),
    { code: 'INVALID_ARGUMENT', message: 'Frozen source rejected input' })
  remove()
  assert.equal(app.parse.adapters.has(source.id), false)
})
