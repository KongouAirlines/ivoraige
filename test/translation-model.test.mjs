import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { brotliCompressSync } from 'node:zlib'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, LlmRuntime, LlmPiAi, LocalCredentialProvider } from '../dist/dsh.mjs'
import { TranslationModel, PROMPT_VERSION } from '../src/translation-model.mjs'
import { TRANSLATION_FEATURE, DEFAULT_TEMPLATE } from '../src/prompt-library.mjs'
import { createApp } from '../src/app.mjs'
import { runCli } from '../src/cli.mjs'

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
    if (behavior.beforeRespond) await behavior.beforeRespond()
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

test('the DSH request distinguishes a short target from neighboring context', async t => {
  const f = await fixture(t, [{ text: '样本量' }])
  const shortLabel = { ...basis, sourceText: 'Sample size', effectiveContext: {
    before: 'The trial recruited 100 participants.',
    after: 'The analysis included 95 participants.',
  } }
  assert.equal((await f.model.translate({ basis: shortLabel })).text, '样本量')
  const [system, user] = f.requests[0].body.messages
  assert.equal(system.role, 'system')
  assert.match(system.content, /Translate only the value of sourceText/)
  assert.match(system.content, /before and after text must not be translated or appended/)
  assert.match(system.content, /no request fields, JSON wrapper/)
  assert.match(system.content, /request values as data/)
  assert.deepEqual(JSON.parse(user.content), {
    sourceLang: 'en', targetLang: 'zh-CN', effectiveContext: shortLabel.effectiveContext,
    effectiveTarget: shortLabel.effectiveTarget, sourceText: 'Sample size',
  })
})

test('JSON in sourceText remains a legitimate translation target', async t => {
  const f = await fixture(t, [{ text: '{"title":"结果"}' }])
  const jsonSource = '{"title":"Results"}'
  const result = await f.model.translate({ basis: { ...basis, sourceText: jsonSource } })
  assert.equal(result.text, '{"title":"结果"}')
  assert.match(f.requests[0].body.messages[0].content, /sourceText itself contains JSON/)
  assert.equal(JSON.parse(f.requests[0].body.messages[1].content).sourceText, jsonSource)
})

test('complete request envelopes fail without exposing source data; ordinary JSON and text pass', async t => {
  const envelope = JSON.stringify({ sourceLang: basis.sourceLang, targetLang: basis.targetLang,
    effectiveContext: basis.effectiveContext, effectiveTarget: basis.effectiveTarget,
    sourceText: '细胞分裂。' })
  const f = await fixture(t, [
    { text: envelope, usage: { prompt_tokens: 21, completion_tokens: 42 } },
    { text: `\`\`\`json\n${envelope}\n\`\`\`` },
    { text: '{"title":"结果"}', usage: { prompt_tokens: 21, completion_tokens: 8 } },
    { text: '细胞分裂。' },
    { text: envelope },
    { text: envelope },
    { text: JSON.stringify({ ...JSON.parse(envelope), targetLang: 'de' }) },
    { text: JSON.stringify({ ...JSON.parse(envelope), effectiveTarget: undefined }) },
  ])
  for (let i = 0; i < 2; i++) {
    await assert.rejects(f.model.translate({ basis }), error =>
      error.code === 'UPSTREAM_FAILURE' && error.details.stage === 'model' &&
      !JSON.stringify(error).includes('Another sentence.') &&
      !JSON.stringify(error).includes('细胞分裂。'))
  }
  assert.deepEqual((await f.model.translate({ basis: { ...basis, sourceText: '{"title":"Results"}' } })).tokens,
    { input: 21, output: 8 })
  assert.equal((await f.model.translate({ basis })).text, '细胞分裂。')
  const wrapperSource = { ...basis, sourceText: JSON.stringify({ sourceLang: 'fr', targetLang: 'de',
    effectiveContext: {}, effectiveTarget: {}, sourceText: 'Results' }) }
  assert.equal((await f.model.translate({ basis: wrapperSource })).text, envelope)
  assert.equal((await f.model.translate({ basis: { ...wrapperSource,
    sourceText: `\`\`\`json\n${wrapperSource.sourceText}\n\`\`\`` } })).text, envelope)
  assert.match((await f.model.translate({ basis })).text, /"targetLang":"de"/)
  assert.doesNotMatch((await f.model.translate({ basis })).text, /effectiveTarget/)
  assert.equal(f.requests.length, 8)
})

test('a request envelope cannot become an accepted revision in a fast task', async t => {
  const envelope = JSON.stringify({ sourceLang: 'en', targetLang: 'zh-CN', effectiveContext: {},
    effectiveTarget: {}, sourceText: '细胞分裂。' })
  const f = await fixture(t, [{ text: envelope }])
  const store = join(f.directory, 'envelope-records.sqlite')
  let app = await createApp({ store, translation: f.translation })
  f.closeWithFixture(async () => { if (app) await app.dispose() })
  const { document } = await app.records.importDocument({ format: 'txt', content: basis.sourceText },
    { sourceId: 'local:envelope', language: 'en' })
  const unit = app.records.listUnits(document.id, { targetLang: 'zh-CN' })[0]
  const { taskId } = await app.tasks.submit(document.id, { targetLang: 'zh-CN', mode: 'fast' })
  const result = await app.tasks.wait(taskId)
  assert.equal(result.state, 'failed')
  assert.equal(result.error.stage, 'translate')
  assert.match(result.error.message, /request fields instead of a translation/)
  assert.doesNotMatch(JSON.stringify(result.error), /细胞分裂|sourceText|Another sentence/)
  assert.equal(result.stats.llmCalls, 1)
  assert.equal(app.records.listRevisions(unit.id, { targetLang: 'zh-CN' }).length, 0)
  assert.equal(app.records.getUnit(unit.id, { targetLang: 'zh-CN' }).accepted, undefined)
  assert.equal(f.requests.length, 1)
  await app.dispose()
  app = await createApp({ store, translation: f.translation })
  assert.equal(app.records.listRevisions(unit.id, { targetLang: 'zh-CN' }).length, 0)
  await app.dispose()
  app = null
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

test('bound prompt edits make new revisions without changing frozen output or reusing the old translation', async t => {
  const f = await fixture(t, [{ text: '初译。' }, { text: '新译。' }])
  const store = join(f.directory, 'prompt-records.sqlite')
  let app = await createApp({ store, translation: f.translation })
  f.closeWithFixture(async () => { if (app) await app.dispose() })
  const { document } = await app.records.importDocument({ format: 'txt', content: basis.sourceText },
    { sourceId: 'local:prompt-test', language: 'en' })
  const unit = app.records.listUnits(document.id, { targetLang: 'zh-CN' })[0]
  const selectedModel = app.ctx.get('ivoraige.translationModel').configuration()
  const selector = { ...TRANSLATION_FEATURE, configurationId: selectedModel.configurationId }
  const template = await app.prompts.copyTemplate({ name: 'Academic' })
  await app.prompts.updateTemplate({ id: template.id, expectedVersion: '1', style: 'Use formal language.' })
  await app.prompts.bind({ ...selector, templateId: template.id })
  const first = await app.tasks.submit(document.id, { targetLang: 'zh-CN' })
  assert.equal((await app.tasks.wait(first.taskId)).state, 'succeeded')
  const pinned = app.records.getTask(first.taskId).promptSelection
  await assert.rejects(app.ctx.get('ivoraige.translationModel').preflight({
    basis: app.records.getBasis(unit.id, { targetLang: 'zh-CN' }), docId: document.id,
    pinned: { ...pinned, promptTrace: { ...pinned.promptTrace, protocolVersion: 'old' } },
  }), { code: 'PRECONDITION_FAILED' })
  const original = app.records.listRevisions(unit.id, { targetLang: 'zh-CN' })[0]
  assert.equal(original.promptTrace.version, '2')
  assert.equal(original.promptTrace.source, 'global')
  assert.equal(original.promptTrace.configurationId, selectedModel.configurationId)
  assert.equal(JSON.parse(f.requests[0].body.messages[1].content).effectiveTarget.stylePreference, 'Use formal language.')
  assert.doesNotMatch(f.requests[0].body.messages[0].content, /Use formal language/)
  const exported = await app.exporter.exportDocument(document.id, {
    targetLang: 'zh-CN', outputs: [{ format: 'md' }],
  })
  const frozen = await readFile(exported.artifacts[0].path, 'utf8')
  await app.prompts.updateTemplate({ id: template.id, expectedVersion: '2', name: 'Renamed academic' })
  const renamed = await app.prompts.resolve(selector)
  assert.equal(renamed.template.version, '3')
  assert.equal(renamed.contentId, original.promptTrace.contentId)
  const renamedRun = await app.tasks.submit(document.id, { targetLang: 'zh-CN' })
  assert.equal((await app.tasks.wait(renamedRun.taskId)).stats.llmCalls, 0)
  const sameStyleCopy = await app.prompts.copyTemplate({ sourceId: template.id, name: 'Same style copy' })
  await app.prompts.bind({ ...selector, templateId: sameStyleCopy.id })
  const copiedRun = await app.tasks.submit(document.id, { targetLang: 'zh-CN' })
  assert.equal((await app.tasks.wait(copiedRun.taskId)).stats.llmCalls, 0)
  await app.prompts.updateTemplate({ id: sameStyleCopy.id, expectedVersion: '1', style: 'Use plain language.' })
  assert.equal((await app.prompts.resolve(selector)).template.version, '2')
  const second = await app.tasks.submit(document.id, { targetLang: 'zh-CN' })
  const secondTask = await app.tasks.wait(second.taskId)
  assert.equal(secondTask.state, 'succeeded', JSON.stringify(secondTask.error))
  assert.equal(secondTask.stats.llmCalls, 1)
  assert.equal(JSON.parse(f.requests[1].body.messages[1].content).effectiveTarget.stylePreference, 'Use plain language.')
  const revisions = app.records.listRevisions(unit.id, { targetLang: 'zh-CN' })
  assert.equal(revisions.length, 2)
  assert.equal(revisions[0].promptTrace.version, '2')
  assert.equal(revisions[1].promptTrace.version, '2')
  assert.equal(revisions[1].promptTrace.templateId, sameStyleCopy.id)
  assert.notEqual(revisions[0].promptTrace.contentId, revisions[1].promptTrace.contentId)
  assert.equal(await readFile(exported.artifacts[0].path, 'utf8'), frozen)
  await app.prompts.restore(selector)
  assert.equal((await app.prompts.resolve(selector)).template.id, DEFAULT_TEMPLATE.id)
  await app.dispose()
  app = await createApp({ store, translation: f.translation })
  assert.equal(app.records.listRevisions(unit.id, { targetLang: 'zh-CN' })[0].promptTrace.version, '2')
  assert.equal((await app.prompts.resolve(selector)).source, 'builtin')
  await app.dispose()
  app = null
})

test('an in-flight prompt edit cannot change later units after pause and restart', async t => {
  let received, release
  const firstReceived = new Promise(resolve => { received = resolve })
  const heldResponse = new Promise(resolve => { release = resolve })
  const f = await fixture(t, [
    { text: '第一译文。', beforeRespond: async () => { received(); await heldResponse } },
    { text: '第二译文。' },
  ])
  t.after(() => release?.())
  const store = join(f.directory, 'pinned-prompt.sqlite')
  let app = await createApp({ store, translation: f.translation })
  f.closeWithFixture(async () => { if (app) await app.dispose() })
  const { document } = await app.records.importDocument({ format: 'txt', content: 'First.\n\nSecond.' },
    { sourceId: 'local:pinned-two-units', language: 'en' })
  const units = app.records.listUnits(document.id, { targetLang: 'zh-CN' })
  const configurationId = app.ctx.get('ivoraige.translationModel').configuration().configurationId
  const selector = { ...TRANSLATION_FEATURE, configurationId }
  const template = await app.prompts.copyTemplate({ name: 'Pinned' })
  await app.prompts.updateTemplate({ id: template.id, expectedVersion: '1', style: 'Original style.' })
  await app.prompts.bind({ ...selector, templateId: template.id })
  const { taskId } = await app.tasks.submit(document.id, { targetLang: 'zh-CN' })
  await firstReceived
  const pausing = app.tasks.pause(taskId)
  await app.prompts.updateTemplate({ id: template.id, expectedVersion: '2', style: 'Updated style.' })
  release()
  const paused = await pausing
  assert.equal(paused.state, 'paused')
  assert.equal(paused.cursor, 1)
  await app.dispose()
  app = await createApp({ store, translation: f.translation })
  await app.tasks.resume(taskId)
  const finished = await app.tasks.wait(taskId)
  assert.equal(finished.state, 'succeeded', JSON.stringify(finished.error))
  assert.equal(finished.promptSelection.prompt.template.version, '2')
  assert.equal(f.requests.length, 2)
  for (const request of f.requests) {
    assert.equal(JSON.parse(request.body.messages[1].content).effectiveTarget.stylePreference, 'Original style.')
  }
  for (const unit of units) {
    const revisions = app.records.listRevisions(unit.id, { targetLang: 'zh-CN' })
    assert.equal(revisions.length, 1)
    assert.equal(revisions[0].promptTrace.version, '2')
    assert.equal(revisions[0].promptTrace.templateId, template.id)
  }
  await app.dispose()
  app = null
})

test('missing run template fails only selected translation and keeps an existing revision', async t => {
  const f = await fixture(t, [{ text: '初译。' }])
  const store = join(f.directory, 'missing-prompt.sqlite')
  let app = await createApp({ store, translation: f.translation })
  f.closeWithFixture(async () => { if (app) await app.dispose() })
  const { document } = await app.records.importDocument({ format: 'txt', content: basis.sourceText },
    { sourceId: 'local:missing-prompt', language: 'en' })
  const unit = app.records.listUnits(document.id, { targetLang: 'zh-CN' })[0]
  const first = await app.tasks.submit(document.id, { targetLang: 'zh-CN' })
  assert.equal((await app.tasks.wait(first.taskId)).state, 'succeeded')
  const second = await app.tasks.submit(document.id, { targetLang: 'zh-CN', promptTemplateId: 'missing' })
  const failed = await app.tasks.wait(second.taskId)
  assert.equal(failed.state, 'failed')
  assert.match(failed.error.message, /template or version is missing/)
  assert.equal(f.requests.length, 1)
  assert.equal(app.records.listRevisions(unit.id, { targetLang: 'zh-CN' }).length, 1)
  await app.dispose()
  app = await createApp({ store })
  const third = await app.tasks.submit(document.id, { targetLang: 'zh-CN', promptTemplateId: 'missing' })
  const absentModel = await app.tasks.wait(third.taskId)
  assert.equal(absentModel.state, 'failed')
  assert.match(absentModel.error.message, /cannot resolve the prompt template/)
  assert.equal(app.records.listRevisions(unit.id, { targetLang: 'zh-CN' }).length, 1)
  await app.dispose()
  app = null
})

test('prompt operations are available through the CLI entry without a model call', async t => {
  const f = await fixture(t, [])
  const store = join(f.directory, 'prompt-cli.sqlite')
  let app = await createApp({ store, translation: f.translation })
  f.closeWithFixture(async () => { if (app) await app.dispose() })
  let output = ''
  const stdout = { write: value => { output += value } }
  const stderr = { write: () => {} }
  assert.equal(await runCli(['prompts'], { app, stdout, stderr }), 0)
  const library = JSON.parse(output).library
  assert.equal(library.selectedModel.provider, 'local')
  assert.equal(library.features[0].featureId, TRANSLATION_FEATURE.featureId)
  output = ''
  assert.equal(await runCli(['prompts', 'copy', '--set', JSON.stringify({ name: 'Short' })],
    { app, stdout, stderr }), 0)
  assert.equal(JSON.parse(output).template.name, 'Short')
  assert.equal(f.requests.length, 0)
  await app.dispose()
  app = null
})

test('unavailable translation plugin leaves document and source export operations usable', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-prompt-absent-'))
  const app = await createApp({ store: join(directory, 'store.sqlite') })
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }) })
  assert.deepEqual((await app.prompts.list()).features, [])
  await assert.rejects(app.prompts.bind({ ...TRANSLATION_FEATURE, configurationId: 'absent',
    templateId: DEFAULT_TEMPLATE.id }), { code: 'COMPONENT_MISSING' })
  const { document } = await app.records.importDocument({ format: 'txt', content: basis.sourceText },
    { sourceId: 'local:absent-plugin', language: 'en' })
  assert.equal(app.records.listUnits(document.id, { targetLang: 'zh-CN' }).length, 1)
  const exported = await app.exporter.exportDocument(document.id, {
    contentMode: 'source', outputs: [{ format: 'md' }],
  })
  assert.match(await readFile(exported.artifacts[0].path, 'utf8'), /A cell divides/)
})

test('accepted manual and machine revisions reuse without a model, but explicit prompts never bypass resolution', async t => {
  const f = await fixture(t, [{ text: 'machine 译文' }])
  for (const configured of [false, true]) {
    const store = join(f.directory, `reuse-matrix-${configured}.sqlite`)
    const app = await createApp({ store, ...(configured ? { translation: f.translation } :
      { settingsDir: join(f.directory, `settings-${configured}`) }) })
    try {
      for (const origin of ['human', 'machine']) {
        const sourceText = `Source for ${origin}.`
        const { document } = await app.records.importDocument({ format: 'txt', content: sourceText },
          { sourceId: `${configured}:${origin}`, language: 'en' })
        const unit = app.records.listUnits(document.id, { targetLang: 'zh-CN' })[0]
        if (configured && origin === 'machine') {
          const seed = await app.tasks.submit(document.id, { targetLang: 'zh-CN' })
          assert.equal((await app.tasks.wait(seed.taskId)).state, 'succeeded')
        } else {
          const revision = await app.records.writeRevision(unit.id, { targetLang: 'zh-CN',
            text: `${origin} 译文`, baseRevisionId: null, origin })
          await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
        }
        const implicit = await app.tasks.submit(document.id, { targetLang: 'zh-CN' })
        const reused = await app.tasks.wait(implicit.taskId)
        assert.equal(reused.state, 'succeeded', JSON.stringify({ configured, origin, error: reused.error }))
        assert.equal(reused.stats.llmCalls, 0)
        const explicit = await app.tasks.submit(document.id, { targetLang: 'zh-CN', promptTemplateId: 'missing' })
        const failed = await app.tasks.wait(explicit.taskId)
        assert.equal(failed.state, 'failed')
        assert.match(failed.error.message, configured ? /template or version is missing/ : /No translation model configured/)
        assert.equal(app.records.listRevisions(unit.id, { targetLang: 'zh-CN' }).length, 1)
      }
      if (!configured) {
        const { document } = await app.records.importDocument({ format: 'txt', content: 'No reusable result.' },
          { sourceId: 'no-reuse', language: 'en' })
        const missing = await app.tasks.submit(document.id, { targetLang: 'zh-CN' })
        const failed = await app.tasks.wait(missing.taskId)
        assert.equal(failed.state, 'failed')
        assert.equal(failed.stats.llmCalls, 0)
      }
    } finally { await app.dispose() }
  }
  assert.equal(f.requests.length, 1)
})

test('configured model reuses an applicable manual revision before term assembly, but still validates prompts', async t => {
  const f = await fixture(t, [])
  const app = await createApp({ store: join(f.directory, 'term-reuse.sqlite'), translation: f.translation })
  f.closeWithFixture(() => app.dispose())
  const { document } = await app.records.importDocument({ format: 'txt', content: basis.sourceText },
    { sourceId: 'local:term-reuse', language: 'en' })
  const unit = app.records.listUnits(document.id, { targetLang: 'zh-CN' })[0]
  const original = app.records.getBasis(unit.id, { targetLang: 'zh-CN' })
  await app.records.setConstraints(unit.id, { targetLang: 'zh-CN',
    effectiveContext: original.effectiveContext, effectiveTarget: original.effectiveTarget,
    termConstraintSetId: 'terms:reviewed-v1' })
  const revision = await app.records.writeRevision(unit.id, { targetLang: 'zh-CN', text: '人工译文。',
    baseRevisionId: null, origin: 'human' })
  await app.records.acceptRevision(revision.id, { expectedAcceptedRevisionId: null })
  assert.equal(app.records.findReusable(unit.id, { targetLang: 'zh-CN' })?.id, revision.id)

  const first = await app.tasks.submit(document.id, { targetLang: 'zh-CN' })
  const reused = await app.tasks.wait(first.taskId)
  assert.equal(reused.state, 'succeeded', JSON.stringify(reused.error))
  assert.equal(reused.stats.reusedUnits, 1)
  assert.equal(reused.stats.llmCalls, 0)
  assert.equal(f.requests.length, 0)

  const chosen = await app.tasks.submit(document.id, { targetLang: 'zh-CN',
    promptTemplateId: DEFAULT_TEMPLATE.id })
  const chosenTask = await app.tasks.wait(chosen.taskId)
  assert.equal(chosenTask.state, 'succeeded', JSON.stringify(chosenTask.error))
  assert.equal(chosenTask.stats.reusedUnits, 1)
  assert.equal(chosenTask.stats.llmCalls, 0)

  const missing = await app.tasks.submit(document.id, { targetLang: 'zh-CN', promptTemplateId: 'missing' })
  const missingTask = await app.tasks.wait(missing.taskId)
  assert.equal(missingTask.state, 'failed')
  assert.match(missingTask.error.message, /template or version is missing/)
  assert.equal(missingTask.stats.llmCalls, 0)
  const review = { pluginId: 'example.review', featureId: 'review', variables: ['sourceText'], output: 'review-notes' }
  app.prompts.register(review, { ...review, id: 'builtin:review', version: '1', name: 'Review', style: '' })
  const incompatible = await app.prompts.copyTemplate({ sourceId: 'builtin:review' })
  const selected = await app.tasks.submit(document.id, { targetLang: 'zh-CN', promptTemplateId: incompatible.id })
  const rejected = await app.tasks.wait(selected.taskId)
  assert.equal(rejected.state, 'failed')
  assert.match(rejected.error.message, /incompatible with feature/)
  assert.equal(rejected.stats.llmCalls, 0)

  const { document: newDocument } = await app.records.importDocument({ format: 'txt', content: 'Untranslated unit.' },
    { sourceId: 'local:term-miss', language: 'en' })
  const newUnit = app.records.listUnits(newDocument.id, { targetLang: 'zh-CN' })[0]
  const newBasis = app.records.getBasis(newUnit.id, { targetLang: 'zh-CN' })
  await app.records.setConstraints(newUnit.id, { targetLang: 'zh-CN',
    effectiveContext: newBasis.effectiveContext, effectiveTarget: newBasis.effectiveTarget,
    termConstraintSetId: 'terms:reviewed-v1' })
  const miss = await app.tasks.submit(newDocument.id, { targetLang: 'zh-CN' })
  const failed = await app.tasks.wait(miss.taskId)
  assert.equal(failed.state, 'failed')
  assert.match(failed.error.message, /Term constraint assembly is not available/)
  assert.equal(failed.stats.reusedUnits, 0)
  assert.equal(failed.stats.llmCalls, 0)
  assert.equal(f.requests.length, 0)
})
