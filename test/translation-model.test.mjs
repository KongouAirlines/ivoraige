import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { brotliCompressSync } from 'node:zlib'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, LlmRuntime, LlmPiAi, LocalCredentialProvider } from '../dist/dsh.mjs'
import { TranslationModel, PROMPT_VERSION } from '../src/translation-model.mjs'
import { createApp } from '../src/app.mjs'

const basis = {
  sourceText: 'A cell divides.', sourceLang: 'en', targetLang: 'zh-CN',
  effectiveContext: { before: null, after: 'Another sentence.' },
  effectiveTarget: { purpose: 'scientific translation', style: 'faithful' },
  termConstraintSetId: 'none',
}

function events(text, usage, { reasoning, finishReason = 'stop' } = {}) {
  return [
    { choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] },
    ...(reasoning ? [{ choices: [{ delta: { reasoning_content: reasoning }, index: 0, finish_reason: null }] }] : []),
    { choices: [{ delta: { content: text }, index: 0, finish_reason: null }] },
    { choices: [{ delta: {}, index: 0, finish_reason: finishReason }], ...(usage ? { usage } : {}) },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
}

async function fixture(t, behaviors, { timeoutMs = 1_000 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-model-'))
  const requests = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push({ path: request.url, headers: request.headers, body: JSON.parse(body) })
    const behavior = behaviors.shift() ?? { status: 500 }
    if (behavior.status) {
      response.writeHead(behavior.status, { 'content-type': 'application/json' })
      response.end('{"error":{"message":"mock failure"}}')
      return
    }
    if (behavior.hang) {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"role":"assistant"},"index":0,"finish_reason":null}]}\n\n')
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream',
      ...(behavior.brotli ? { 'content-encoding': 'br' } : {}) })
    const responseBody = events(behavior.text, behavior.usage, behavior)
    response.end(behavior.brotli ? brotliCompressSync(responseBody) : responseBody)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const ctx = new Context()
  const closers = []
  t.after(async () => {
    for (const close of closers) await close()
    await ctx.fiber.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  await ctx.plugin(LocalCredentialProvider, { path: join(directory, 'credentials.yaml'), watch: false })
  await ctx.get('credentials').set('IVORAIGE_TEST_KEY', 'private-local-secret')
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, { providers: { local: {
    apiKeyEnv: 'IVORAIGE_TEST_KEY', api: 'openai-completions',
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    models: [{ id: 'test-model', contextWindow: 8192, maxTokens: 512 }],
  } } })
  await ctx.plugin(TranslationModel, { provider: 'local', model: 'test-model', timeoutMs })
  return { model: ctx.get('ivoraige.translationModel'), ctx, requests, directory,
    closeWithFixture: close => closers.push(close),
    translation: { provider: 'local', model: 'test-model', credentialsPath: join(directory, 'credentials.yaml'),
      providers: { local: { apiKeyEnv: 'IVORAIGE_TEST_KEY', api: 'openai-completions',
        baseURL: `http://127.0.0.1:${address.port}/v1`,
        models: [{ id: 'test-model', contextWindow: 8192, maxTokens: 512 }] } } } }
}

test('DSH pi-ai uses a credential reference and returns a constrained translation', async t => {
  const f = await fixture(t, [{ text: '细胞分裂。', usage: { prompt_tokens: 21, completion_tokens: 5 } }])
  const result = await f.model.translate({ basis })
  assert.deepEqual(result, { text: '细胞分裂。', modelId: 'local/test-model',
    promptVersion: PROMPT_VERSION, tokens: { input: 21, output: 5 } })
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].path, '/v1/chat/completions')
  assert.equal(f.requests[0].headers.authorization, 'Bearer private-local-secret')
  assert.equal(f.requests[0].body.messages[0].role, 'system')
  assert.match(JSON.stringify(f.requests[0].body), /Another sentence/)
  assert.match(JSON.stringify(f.requests[0].body), /scientific translation/)
  assert.doesNotMatch(JSON.stringify(result), /private-local-secret/)
})

test('the model SDK consumes a valid Brotli-compressed SSE response locally', async t => {
  const f = await fixture(t, [{ text: 'Cells divide.', brotli: true,
    usage: { prompt_tokens: 21, completion_tokens: 5 } }])
  const result = await f.model.translate({ basis })
  assert.equal(result.text, 'Cells divide.')
  assert.deepEqual(result.tokens, { input: 21, output: 5 })
  assert.equal(f.requests.length, 1)
})

test('unknown pi-ai usage remains null; terms fail before making a request', async t => {
  const f = await fixture(t, [{ text: '细胞分裂。' }])
  await assert.rejects(f.model.translate({ basis: { ...basis, termConstraintSetId: 'terms:1' } }),
    { code: 'PRECONDITION_FAILED' })
  assert.equal(f.requests.length, 0)
  const result = await f.model.translate({ basis })
  assert.deepEqual(result.tokens, { input: null, output: null })
})

test('reasoning remains internal and only final text is returned', async t => {
  const response = { reasoning: 'private reasoning', text: '细胞分裂。' }
  const f = await fixture(t, [response, response])
  const chunks = []
  for await (const chunk of f.ctx.llm.stream({ provider: 'local', model: 'test-model',
    messages: [{ role: 'user', content: [{ type: 'text', text: basis.sourceText }] }] })) chunks.push(chunk)
  assert.ok(chunks.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'reasoning'))
  const result = await f.model.translate({ basis })
  assert.equal(result.text, '细胞分裂。')
  assert.doesNotMatch(JSON.stringify(result), /private reasoning/)
})

test('truncated provider output is rejected even after partial text', async t => {
  const f = await fixture(t, [{ text: 'partial', finishReason: 'length' }])
  await assert.rejects(f.model.translate({ basis }), error =>
    error.code === 'UPSTREAM_FAILURE' && /truncated/.test(error.message))
})

test('provider timeout rejects instead of accepting a partial response', async t => {
  const f = await fixture(t, [{ hang: true }], { timeoutMs: 30 })
  await assert.rejects(f.model.translate({ basis }), error =>
    error.code === 'UPSTREAM_FAILURE' && error.details.canceled !== true)
  assert.equal(f.requests.length, 1)
})

test('provider error and cancellation are contained', async t => {
  const f = await fixture(t, [{ status: 503 }, { hang: true }])
  await assert.rejects(f.model.translate({ basis }), { code: 'UPSTREAM_FAILURE' })
  const controller = new AbortController()
  const pending = f.model.translate({ basis, signal: controller.signal })
  setTimeout(() => controller.abort(), 30)
  await assert.rejects(pending, error => error.code === 'UPSTREAM_FAILURE' && error.details.canceled === true)
  assert.equal(f.requests.length, 2)
})

test('createApp translates once, exports accepted revisions, and reuses after restart', async t => {
  const f = await fixture(t, [{ text: '细胞分裂。', usage: { prompt_tokens: 21, completion_tokens: 5 } }])
  const store = join(f.directory, 'records.sqlite')
  let app = await createApp({ store, translation: f.translation })
  f.closeWithFixture(async () => { if (app) await app.dispose() })
  const { document } = await app.records.importDocument({ format: 'txt', content: basis.sourceText },
    { sourceId: 'local:cell', language: 'en' })
  const first = await app.tasks.submit(document.id, { targetLang: 'zh-CN', mode: 'fast' })
  const finished = await app.tasks.wait(first.taskId)
  assert.equal(finished.state, 'succeeded', JSON.stringify(finished.error))
  assert.equal(finished.stats.llmCalls, 1)
  assert.equal(f.requests.length, 1)
  const output = await app.exporter.exportDocument(document.id, {
    targetLang: 'zh-CN', outputs: [{ format: 'md' }, { format: 'json' }],
  })
  assert.equal(output.artifacts[0].snapshotId, output.artifacts[1].snapshotId)
  assert.match(await readFile(output.artifacts[0].path, 'utf8'), /细胞分裂。/)
  assert.equal(JSON.parse(await readFile(output.artifacts[1].path, 'utf8')).units[0].text, '细胞分裂。')
  await app.dispose()
  app = await createApp({ store, translation: f.translation })
  const second = await app.tasks.submit(document.id, { targetLang: 'zh-CN', mode: 'fast' })
  const reused = await app.tasks.wait(second.taskId)
  assert.equal(reused.state, 'succeeded', JSON.stringify(reused.error))
  assert.equal(reused.stats.llmCalls, 0)
  assert.equal(reused.stats.reusedUnits, 1)
  assert.equal(f.requests.length, 1)
  await app.dispose()
  app = null
})
