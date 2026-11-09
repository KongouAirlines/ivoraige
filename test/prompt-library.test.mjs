import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Storage, StorageSqlite, StorageDomain } from '../dist/dsh.mjs'
import { PromptLibrary, DEFAULT_TEMPLATE, TRANSLATION_FEATURE, modelConfigurationId } from '../src/prompt-library.mjs'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-prompts-'))
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageSqlite, { path: join(dir, 'store.sqlite') })
  await ctx.plugin(StorageDomain, { backend: 'sqlite' })
  await ctx.plugin(PromptLibrary)
  const library = ctx.get('ivoraige.prompts')
  t.after(async () => { await ctx.fiber.dispose(); await rm(dir, { recursive: true, force: true }) })
  return { library }
}

test('templates are immutable versions, bound by plugin, feature and real connection', async t => {
  const { library } = await fixture(t)
  const stopTranslate = library.register(TRANSLATION_FEATURE)
  const review = { pluginId: 'example.review', featureId: 'review', variables: ['sourceText'], output: 'review-notes' }
  const reviewDefault = { ...review, id: 'builtin:review', version: '1', name: 'Review', style: '' }
  const stopReview = library.register(review, reviewDefault)
  t.after(() => { stopTranslate(); stopReview() })
  const routeA = { api: 'openai-completions', baseURL: 'http://localhost:8001/v1', apiKeyEnv: 'A' }
  const routeB = { ...routeA, baseURL: 'http://localhost:8002/v1' }
  const a = modelConfigurationId({ provider: 'local', model: 'same-name', route: routeA })
  const b = modelConfigurationId({ provider: 'local', model: 'same-name', route: routeB })
  assert.notEqual(a, b)
  assert.notEqual(a, modelConfigurationId({ provider: 'local', model: 'other-name', route: routeA }))
  assert.notEqual(a, modelConfigurationId({ provider: 'different-provider', model: 'same-name', route: routeA }))
  const selector = { ...TRANSLATION_FEATURE, configurationId: a }
  const builtin = await library.resolve(selector)
  assert.equal(builtin.source, 'builtin')
  assert.equal(builtin.template.id, DEFAULT_TEMPLATE.id)
  const custom = await library.copyTemplate({ name: 'Formal' })
  assert.equal(custom.style, '')
  const updated = await library.updateTemplate({ id: custom.id, expectedVersion: '1', style: 'Use concise academic prose.' })
  assert.equal(updated.version, '2')
  assert.equal(library.getTemplate(custom.id, '1').style, '')
  await library.bind({ ...selector, templateId: custom.id })
  const global = await library.resolve(selector)
  assert.equal(global.source, 'global')
  assert.equal(global.template.style, 'Use concise academic prose.')
  assert.notEqual(global.contentId, builtin.contentId)
  assert.equal((await library.resolve({ ...selector, configurationId: b })).source, 'builtin')
  assert.equal((await library.resolve({ ...review, configurationId: a })).source, 'builtin')
  const reviewCopy = await library.copyTemplate({ sourceId: reviewDefault.id })
  await library.bind({ ...review, configurationId: a, templateId: reviewCopy.id })
  assert.equal((await library.resolve({ ...review, configurationId: a })).template.id, reviewCopy.id)
  await assert.rejects(library.bind({ ...review, configurationId: a, templateId: custom.id }),
    { code: 'PRECONDITION_FAILED' })
  await library.bind({ ...selector, configurationId: b, templateId: custom.id })
  await library.bind({ ...selector, docId: 'doc-1', templateId: DEFAULT_TEMPLATE.id })
  assert.equal((await library.resolve({ ...selector, docId: 'doc-1' })).source, 'document')
  assert.equal((await library.resolve({ ...selector, docId: 'doc-2' })).source, 'global')
  assert.equal((await library.resolve({ ...selector, docId: 'doc-1', templateId: custom.id })).source, 'run')
  await library.restore({ ...selector, docId: 'doc-1' })
  assert.equal((await library.resolve({ ...selector, docId: 'doc-1' })).source, 'global')
  await library.restore(selector)
  assert.equal((await library.resolve(selector)).source, 'builtin')
  await assert.rejects(library.resolve({ ...selector, templateId: 'missing' }), { code: 'NOT_FOUND' })
  await assert.rejects(library.resolve({ ...review, configurationId: a, templateId: custom.id }),
    { code: 'PRECONDITION_FAILED' })
  assert.equal((await library.resolve({ ...selector, configurationId: b })).source, 'global')
  assert.equal(library.table.get('library').templates.some(item => item.style === 'Use concise academic prose.'), true)
})

test('missing bound template records a compatible built-in fallback; missing plugin is isolated', async t => {
  const { library } = await fixture(t)
  library.register(TRANSLATION_FEATURE)
  const selector = { ...TRANSLATION_FEATURE, configurationId: 'config' }
  const custom = await library.copyTemplate()
  await library.bind({ ...selector, templateId: custom.id })
  const saved = structuredClone(library.table.get('library'))
  saved.bindings[JSON.stringify([selector.pluginId, selector.featureId, 'config', null])].templateId = 'missing'
  await library.table.put('library', saved)
  library.data = saved
  const fallback = await library.resolve(selector)
  assert.equal(fallback.source, 'builtin')
  assert.equal(fallback.fallback.reason, 'Prompt template or version is missing')
  await assert.rejects(library.resolve({ pluginId: 'missing', featureId: 'missing', configurationId: 'config' }),
    { code: 'COMPONENT_MISSING' })
  assert.equal((await library.resolve(selector)).template.id, DEFAULT_TEMPLATE.id)
})

test('invalid stored prompt content is reported by the prompt service, without losing storage availability', async t => {
  const { library } = await fixture(t)
  library.register(TRANSLATION_FEATURE)
  await library.table.put('library', { templates: [{ id: 'broken', variables: null }], bindings: {} })
  library.data = structuredClone(library.table.get('library'))
  await assert.rejects(library.list(), { code: 'PRECONDITION_FAILED' })
  await assert.rejects(library.resolve({ ...TRANSLATION_FEATURE, configurationId: 'local' }),
    { code: 'PRECONDITION_FAILED' })
  assert.equal(library.domain.table('library').get('library').templates.length, 1)
})
