import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { Context, Service, LlmRuntime, LlmPiAi, createUserMessage, BlockAssembler } from './bridge.bundle.mjs'

// A local endpoint is the only fake here. Framework, registry, profiles,
// credential lookup, HTTP SDK, stream conversion and assembly are upstream.
const checks = []
const contexts = []
const servers = []
const check = (name, detail) => { checks.push({ name, status: 'passed', ...detail }); console.log(`PASS ${name}`) }
async function endpoint(label) {
  const requests = []
  let mode = 'normal'
  let closedSlow = 0
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', part => { body += part })
    req.on('end', () => {
      const current = mode
      requests.push({ path: req.url, body: JSON.parse(body), authorization: req.headers.authorization === 'Bearer local-test-key' ? 'expected-dummy-key' : 'unexpected' })
      if (current === 'auth') {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: '401 fixture refusal', type: 'authentication_error' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const event = payload => res.write(`data: ${JSON.stringify(payload)}\n\n`)
      event({ choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })
      event({ choices: [{ index: 0, delta: { content: `${label}:自旋波` }, finish_reason: null }] })
      if (current === 'slow') {
        const timer = setTimeout(() => { if (!res.destroyed) res.end() }, 5000)
        res.on('close', () => { clearTimeout(timer); closedSlow++ })
        return
      }
      const usage = current === 'no-usage' ? {} : { usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }
      event({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], ...usage })
      res.end('data: [DONE]\n\n')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  return { url: `http://127.0.0.1:${server.address().port}/v1`, requests, setMode: value => { mode = value }, get closedSlow() { return closedSlow } }
}
const profiles = url => ({ providers: { local: { api: 'openai-completions', baseURL: url, apiKeyEnv: 'IVORAIGE_EXPERIMENT_KEY', models: [{ id: 'mock-translator', name: 'Mock translator', contextWindow: 65536, maxTokens: 512 }] } } })
const request = signal => ({ provider: 'local', model: 'mock-translator', maxTokens: 128, messages: [createUserMessage({ content: [{ type: 'text', text: 'Translate spin wave into Chinese. Term: spin wave=自旋波.' }], source: { kind: 'user' } })], ...(signal ? { signal } : {}) })
async function collect(ctx, options = request()) {
  const assembler = new BlockAssembler()
  const chunks = []
  for await (const chunk of ctx.llm.stream(options)) { chunks.push(chunk); assembler.push(chunk) }
  return { text: assembler.blocks().filter(b => b.type === 'text').map(b => b.text).join(''), usage: assembler.usage ?? null, finish: assembler.finish, chunkTypes: chunks.map(c => c.type) }
}
async function waitFor(predicate, label) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(10) }
  throw new Error(`Timed out waiting for ${label}`)
}
try {
  process.env.IVORAIGE_EXPERIMENT_KEY = 'local-test-key'
  const a = await endpoint('A')
  const b = await endpoint('B')
  const ctx = new Context()
  contexts.push(ctx)
  const llmFiber = await ctx.plugin(LlmRuntime)
  let providerFiber = await ctx.plugin(LlmPiAi, profiles(a.url))
  const first = await collect(ctx)
  assert.equal(first.text, 'A:自旋波')
  assert.deepEqual(first.usage, { inputTokens: 3, outputTokens: 2, totalTokens: 5 })
  assert.equal(first.finish.kind, 'stop')
  assert.equal(a.requests[0].path, '/v1/chat/completions')
  assert.equal(a.requests[0].authorization, 'expected-dummy-key')
  assert.equal(a.requests[0].body.model, 'mock-translator')
  assert.equal(a.requests[0].body.max_completion_tokens, 128)
  check('real DSH registry → pi-ai adapter → local HTTP stream', { result: first, request: a.requests[0] })

  // Same business request/collector; replace only the plugin configuration.
  await providerFiber.dispose()
  const absent = await collect(ctx)
  assert.equal(absent.finish.failure.code, 'NO_ADAPTER')
  providerFiber = await ctx.plugin(LlmPiAi, profiles(b.url))
  const replaced = await collect(ctx)
  assert.equal(replaced.text, 'B:自旋波')
  assert.equal(a.requests.length, 1)
  assert.equal(b.requests.length, 1)
  check('unload withdraws route; reload changes endpoint', { absent: absent.finish, result: replaced })

  delete process.env.IVORAIGE_EXPERIMENT_KEY
  const missingKey = await collect(ctx)
  assert.equal(missingKey.finish.failure.code, 'MISSING_CREDENTIAL')
  assert.equal(b.requests.length, 1)
  process.env.IVORAIGE_EXPERIMENT_KEY = 'local-test-key'
  check('named credential missing fails before HTTP', { finish: missingKey.finish })

  b.setMode('auth')
  const auth = await collect(ctx)
  assert.equal(auth.finish.kind, 'error')
  assert.equal(auth.finish.failure.code, 'AUTH')
  check('HTTP 401 becomes terminal AUTH outcome', { finish: auth.finish })

  b.setMode('no-usage')
  const noUsage = await collect(ctx)
  check('missing provider usage observation', { result: noUsage, warning: 'Raw provider omitted usage; pi-ai fills zeros. Business ledger must mark unverified counts unknown.' })

  b.setMode('slow')
  const controller = new AbortController()
  const started = b.requests.length
  const pending = collect(ctx, request(controller.signal))
  await waitFor(() => b.requests.length > started, 'in-flight request')
  controller.abort('user cancellation')
  const cancelled = await pending
  assert.equal(cancelled.finish.kind, 'aborted')
  await waitFor(() => b.closedSlow === 1, 'HTTP response connection closed')
  // The task scheduler owns this guard; the provider does not own future units.
  let dispatched = 1
  for (const unit of ['next unit']) { if (controller.signal.aborted) break; dispatched++; await collect(ctx) }
  assert.equal(dispatched, 1)
  check('AbortSignal closes in-flight HTTP and scheduler stops next unit', { finish: cancelled.finish, closedSlow: b.closedSlow, dispatched })

  const iterator = ctx.llm.stream(request())[Symbol.asyncIterator]()
  await iterator.next()
  await iterator.next()
  await iterator.return()
  await waitFor(() => b.closedSlow === 2, 'consumer early-return closes HTTP')
  check('consumer iterator return releases HTTP stream', { closedSlow: b.closedSlow })

  const timeoutCtx = new Context()
  contexts.push(timeoutCtx)
  await timeoutCtx.plugin(LlmRuntime)
  const shortIdle = profiles(b.url)
  shortIdle.providers.local.streamIdleTimeoutMs = 40
  await timeoutCtx.plugin(LlmPiAi, shortIdle)
  const timedOut = await collect(timeoutCtx)
  assert.equal(timedOut.finish.kind, 'error')
  assert.equal(timedOut.finish.failure.code, 'TIMEOUT')
  await waitFor(() => b.closedSlow === 3, 'idle timeout closes HTTP')
  check('configured stream idle timeout ends request and closes HTTP', { finish: timedOut.finish, closedSlow: b.closedSlow })

  let active = 0
  let hits = 0
  const consumer = { name: 'translation-consumer', inject: ['llm', 'terms'], apply(child) {
    active++
    child.on('experiment/translate', () => { hits++ })
    child.effect(() => () => { active-- })
  } }
  const consumerFiber = ctx.plugin(consumer)
  await delay(20)
  assert.equal(active, 0)
  check('missing injected term service leaves consumer pending', { active, fiberState: consumerFiber.state })
  class Terms extends Service { constructor(child) { super(child, 'terms'); this.spinWave = '自旋波' } }
  let termFiber = await ctx.plugin(Terms)
  await waitFor(() => active === 1, 'consumer activation')
  ctx.emit('experiment/translate')
  assert.equal(hits, 1)
  await termFiber.dispose()
  await waitFor(() => active === 0, 'consumer dependency teardown')
  ctx.emit('experiment/translate')
  assert.equal(hits, 1)
  termFiber = await ctx.plugin(Terms)
  await waitFor(() => active === 1, 'consumer reactivation')
  ctx.emit('experiment/translate')
  assert.equal(hits, 2)
  await consumerFiber.dispose()
  ctx.emit('experiment/translate')
  assert.equal(hits, 2)
  await termFiber.dispose()
  await providerFiber.dispose()
  await llmFiber.dispose()
  check('dependency removal/reload cleans listeners without duplication', { active, eventHits: hits })
  await writeFile('results.json', JSON.stringify({ date: new Date().toISOString(), node: process.version, dshCommit: '639ed015397290b3745d163aafe02ffee4aa3f84', realModules: ['Cordis Context/Service', 'LlmRuntime', 'llm-pi-ai plugin', 'PiAiAdapter', 'profile/credential resolver', 'pi-ai HTTP SDK', 'BlockAssembler'], checks }, null, 2) + '\n')
  console.log(`${checks.length} checks passed; results.json written`)
} finally {
  delete process.env.IVORAIGE_EXPERIMENT_KEY
  for (const ctx of contexts) await ctx.fiber.dispose()
  for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}
