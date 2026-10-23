import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { AppBoot, ConfigEditor, Context, DshSchema as z, LlmPiAi, LlmRuntime,
  LocalCredentialProvider, Service, SettingsForms } from '../dist/dsh.mjs'
import { isPublicErrorCode, KernelError } from './errors.mjs'
import { modelPresets } from './model-presets.mjs'
import { SettingsPages } from './settings-pages.mjs'
import { ComponentsSettings } from './component-settings.mjs'

const MODEL_NS = 'ivoraige-model'
const ROUTES_NS = 'llm-pi-ai'
const PROFILE_BUNDLE = 'ivoraige-model-settings'
const DEFAULT_TIMEOUT_MS = 120_000
// Offered route-level switches in the pinned DSH pi-ai compat gates. Its
// schemastery schema passes null members and undeclared keys to resolution.
const COMPAT_FIELDS = new Set([
  'supportsStore', 'supportsDeveloperRole', 'supportsReasoningEffort',
  'supportsUsageInStreaming', 'supportsFinishReason', 'maxTokensField',
  'requiresToolResultName', 'requiresAssistantAfterToolResult', 'requiresThinkingAsText',
  'requiresReasoningContentOnAssistantMessages', 'thinkingFormat', 'chatTemplateKwargs',
  'chatTemplateArgs', 'supportsThinkingTokenBudget', 'thinkingTokenBudgetField',
  'vllmPriority', 'supportsStrictMode', 'cacheControlFormat',
  'supportsLongCacheRetention', 'supportsMaxOutputTokens',
  'supportsEagerToolInputStreaming', 'supportsCacheControlOnTools',
  'supportsTemperature', 'forceAdaptiveThinking', 'allowEmptySignature',
  'supportsStrictTools',
])

function validateCompat(value) {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return
  for (const [field, setting] of Object.entries(value)) {
    if (!COMPAT_FIELDS.has(field)) {
      throw new KernelError('INVALID_ARGUMENT', 'compat contains a nonconfigurable field')
    }
    if (setting == null) {
      throw new KernelError('INVALID_ARGUMENT', `compat.${field} must have a value`)
    }
  }
}

function settingsError(error) {
  if (error?.name === 'ValidationError') {
    return new KernelError('INVALID_ARGUMENT', 'Invalid model settings', {}, { cause: error })
  }
  return error
}

function validateReasoningEfforts(value) {
  if (value === undefined || value === null || value === false) return
  const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !Object.keys(value).some(level => level !== 'off') ||
      Object.entries(value).some(([level, wire]) => !levels.includes(level) ||
        (wire === null ? level !== 'off' : typeof wire !== 'string' || !wire.length))) {
    throw new KernelError('INVALID_ARGUMENT', 'reasoningEfforts must declare a thinking level and valid wire values')
  }
}

async function mutateSettings(settings, namespace, changes, revision) {
  try { return await settings.mutate(namespace, changes, revision) }
  catch (error) { throw settingsError(error) }
}

const nonempty = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new KernelError('INVALID_ARGUMENT', `${field} must be a nonempty string`)
  }
  return value.trim()
}

// A business selection is a normal DSH volatile Config. DSH owns its profile
// patch, revision checks, live update, and credential document.
export class ModelSettings extends Service {
  static inject = ['settings', 'credentials', 'ivoraige.settingsPages']
  static Config = z.object({
    provider: z.string().default('').volatile(),
    model: z.string().default('').volatile(),
    timeoutMs: z.number().min(1).default(DEFAULT_TIMEOUT_MS).volatile(),
    savedModels: z.array(z.object({
      provider: z.string(), model: z.string(), timeoutMs: z.number().min(1),
    })).default([]).volatile(),
  })

  constructor(ctx, config) {
    super(ctx, 'ivoraige.modelSettings')
    this.config = config
    ctx.effect(() => ctx.get('ivoraige.settingsPages').register({ id: 'models', label: '模型', order: 10 }))
  }

  resolve() {
    const provider = this.config.provider.get()
    const model = this.config.model.get()
    return provider && model ? { provider, model, timeoutMs: this.config.timeoutMs.get() } : null
  }

  savedModels(providers = {}) {
    const configuredModels = this.config.savedModels.get()
    const saved = new Map()
    const add = (provider, model, timeoutMs) => {
      if (typeof provider !== 'string' || !provider || typeof model !== 'string' || !model) return
      const key = JSON.stringify([provider, model])
      if (!saved.has(key)) saved.set(key, { provider, model, timeoutMs })
    }
    for (const entry of configuredModels) {
      add(entry.provider, entry.model, entry.timeoutMs)
    }
    const selected = this.resolve()
    if (selected) add(selected.provider, selected.model, selected.timeoutMs)
    for (const [provider, route] of Object.entries(providers)) {
      for (const entry of Array.isArray(route?.models) ? route.models : []) {
        add(provider, entry.id, DEFAULT_TIMEOUT_MS)
      }
      for (const id of Object.keys(route?.modelOverrides ?? {})) {
        add(provider, id, DEFAULT_TIMEOUT_MS)
      }
    }
    return [...saved.values()]
  }

  async get() {
    const descriptors = this.ctx.settings.describe({ redactSecrets: true })
    const routeForm = descriptors.find(row => row.ns === ROUTES_NS)
    const modelForm = descriptors.find(row => row.ns === MODEL_NS)
    if (!routeForm || !modelForm) throw new KernelError('COMPONENT_MISSING', 'DSH model settings forms are unavailable')
    const providers = routeForm.value?.providers ?? {}
    const credentials = {}
    for (const [provider, route] of Object.entries(providers)) {
      if (route && typeof route.apiKeyEnv === 'string') {
        credentials[provider] = await this.ctx.credentials.describe(route.apiKeyEnv)
      }
    }
    return {
      selected: this.resolve(),
      savedModels: this.savedModels(providers),
      presets: structuredClone(modelPresets),
      routes: providers,
      credentials,
      revisions: { routes: routeForm.revision, selected: modelForm.revision },
    }
  }

  // Route options use DSH's pi-ai schema. A route may be an installed provider
  // with catalog defaults, or a fully declared OpenAI-compatible endpoint.
  async update(input = {}) {
    let { provider, model, api, baseURL, credentialRef, contextWindow, maxTokens,
      reasoning, compat, reasoningEfforts, timeoutMs, select = true, selectOnly = false,
      routesRevision, selectedRevision } = input
    provider = nonempty(provider, 'provider')
    model = nonempty(model, 'model')
    if (routesRevision !== undefined && (!Number.isSafeInteger(routesRevision) || routesRevision < 0)) {
      throw new KernelError('INVALID_ARGUMENT', 'routesRevision must be a nonnegative integer')
    }
    if (selectedRevision !== undefined && (!Number.isSafeInteger(selectedRevision) || selectedRevision < 0)) {
      throw new KernelError('INVALID_ARGUMENT', 'selectedRevision must be a nonnegative integer')
    }
    if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) {
      throw new KernelError('INVALID_ARGUMENT', 'timeoutMs must be a positive integer')
    }
    if (typeof select !== 'boolean' || typeof selectOnly !== 'boolean') {
      throw new KernelError('INVALID_ARGUMENT', 'select and selectOnly must be booleans')
    }
    validateCompat(compat)
    validateReasoningEfforts(reasoningEfforts)
    if (selectOnly && Object.keys(input).some(field => ![
      'provider', 'model', 'selectOnly', 'routesRevision', 'selectedRevision',
    ].includes(field))) {
      throw new KernelError('INVALID_ARGUMENT', 'selectOnly accepts only a saved provider and model')
    }
    const forms = this.ctx.settings.describe()
    if (!forms.some(row => row.ns === ROUTES_NS) || !forms.some(row => row.ns === MODEL_NS)) {
      throw new KernelError('COMPONENT_MISSING', 'DSH model settings forms are unavailable')
    }
    for (const [ns, expected] of [[ROUTES_NS, routesRevision], [MODEL_NS, selectedRevision]]) {
      if (expected === undefined) continue
      const actual = forms.find(row => row.ns === ns)?.revision
      if (actual !== expected) {
        throw new KernelError('CONFLICT', `${ns} settings changed`, { expected, actual })
      }
    }
    const currentRoute = forms.find(row => row.ns === ROUTES_NS)?.value?.providers?.[provider]
    const providers = forms.find(row => row.ns === ROUTES_NS)?.value?.providers ?? {}
    const savedModels = this.savedModels(providers)
    const savedIndex = savedModels.findIndex(entry => entry.provider === provider && entry.model === model)
    if (selectOnly && savedIndex < 0) {
      throw new KernelError('INVALID_ARGUMENT', 'model configuration is not saved')
    }
    if (selectOnly) {
      const saved = savedModels[savedIndex]
      await mutateSettings(this.ctx.settings, MODEL_NS, [
        { op: 'set', path: ['provider'], value: provider },
        { op: 'set', path: ['model'], value: model },
        { op: 'set', path: ['timeoutMs'], value: saved.timeoutMs },
      ], selectedRevision)
      return this.get()
    }
    const route = currentRoute ? structuredClone(currentRoute) : {}
    const existingModels = Array.isArray(route.models) ? route.models : []
    const existingModel = existingModels.find(entry => entry.id === model)
    const catalogModels = getBuiltinModels(provider)
    const builtin = catalogModels.some(entry => entry.id === model)
    const hasCapacity = contextWindow !== undefined || maxTokens !== undefined
    const clearCapacity = contextWindow === null && maxTokens === null
    if (hasCapacity && !clearCapacity && (!Number.isSafeInteger(contextWindow) || contextWindow <= 0 ||
        !Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
      throw new KernelError('INVALID_ARGUMENT',
        'contextWindow and maxTokens must both be positive integers or both null')
    }
    if (catalogModels.length && !existingModels.length && !builtin) {
      throw new KernelError('INVALID_ARGUMENT',
        'model is absent from the installed catalog; use a distinct custom provider with api, baseURL, contextWindow and maxTokens')
    }
    if ((!catalogModels.length || existingModels.length) && !existingModel && !hasCapacity) {
      throw new KernelError('INVALID_ARGUMENT',
        'new custom models require contextWindow and maxTokens')
    }
    if (clearCapacity && (existingModels.length || !builtin)) {
      throw new KernelError('INVALID_ARGUMENT',
        'capacity can only be cleared for an installed catalog model using catalog defaults')
    }
    for (const [field, value, target] of [
      ['api', api, 'api'], ['baseURL', baseURL, 'baseURL'],
      ['credentialRef', credentialRef, 'apiKeyEnv'], ['reasoning', reasoning, 'reasoning'],
    ]) {
      if (value === null) delete route[target]
      else if (value !== undefined) route[target] = nonempty(value, field)
    }
    if (compat === null) delete route.compat
    else if (compat !== undefined) route.compat = structuredClone(compat)
    if (existingModels.length || !catalogModels.length) {
      if (hasCapacity) {
        const declared = { ...existingModel, id: model, contextWindow, maxTokens }
        if (reasoningEfforts === null) delete declared.reasoningEfforts
        else if (reasoningEfforts !== undefined) declared.reasoningEfforts = structuredClone(reasoningEfforts)
        route.models = [...existingModels.filter(entry => entry.id !== model), declared]
      } else if (reasoningEfforts !== undefined) {
        route.models = existingModels.map(entry => {
          if (entry.id !== model) return entry
          const updated = { ...entry }
          if (reasoningEfforts === null) delete updated.reasoningEfforts
          else updated.reasoningEfforts = structuredClone(reasoningEfforts)
          return updated
        })
      }
    } else if (hasCapacity || reasoningEfforts !== undefined) {
      const override = { ...route.modelOverrides?.[model] }
      if (clearCapacity) {
        delete override.contextWindow
        delete override.maxTokens
      } else if (hasCapacity) {
        override.contextWindow = contextWindow
        override.maxTokens = maxTokens
      }
      if (reasoningEfforts === null) delete override.reasoningEfforts
      else if (reasoningEfforts !== undefined) override.reasoningEfforts = structuredClone(reasoningEfforts)
      // DSH materializes empty schema defaults when describing an override.
      if (Array.isArray(override.input) && !override.input.length) delete override.input
      if (override.compat && Object.values(override.compat).every(value =>
        value && typeof value === 'object' && !Object.keys(value).length)) delete override.compat
      if (Object.keys(override).length) {
        route.modelOverrides = { ...route.modelOverrides, [model]: override }
      } else {
        delete route.modelOverrides?.[model]
      }
    }
    let routePersisted = false
    if (!currentRoute || api !== undefined || baseURL !== undefined || credentialRef !== undefined ||
        contextWindow !== undefined || maxTokens !== undefined || reasoning !== undefined ||
        compat !== undefined || reasoningEfforts !== undefined) {
      // Validate with the pinned DSH schema before its settings writer persists anything.
      try { LlmPiAi.Config({ providers: { [provider]: route } }) }
      catch (error) { throw settingsError(error) }
      await mutateSettings(this.ctx.settings, ROUTES_NS,
        [{ op: 'set', path: ['providers', provider], value: route }], routesRevision)
      routePersisted = true
    }
    const existing = savedModels[savedIndex]
    const effectiveTimeout = timeoutMs ?? existing?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const nextSaved = savedModels.filter(entry => entry.provider !== provider || entry.model !== model)
    nextSaved.push({ provider, model, timeoutMs: effectiveTimeout })
    try {
      await mutateSettings(this.ctx.settings, MODEL_NS, [
        { op: 'set', path: ['savedModels'], value: nextSaved },
        ...(select ? [
          { op: 'set', path: ['provider'], value: provider },
          { op: 'set', path: ['model'], value: model },
          { op: 'set', path: ['timeoutMs'], value: effectiveTimeout },
        ] : []),
      ], selectedRevision)
    } catch (error) {
      if (!routePersisted) throw settingsError(error)
      let revision = null
      try { revision = this.ctx.settings.describe().find(row => row.ns === ROUTES_NS)?.revision ?? null } catch {}
      const conflict = error instanceof KernelError && error.code === 'CONFLICT' ?
        { expected: error.details?.expected, actual: error.details?.actual } : {}
      const mapped = settingsError(error)
      throw new KernelError(mapped instanceof KernelError && isPublicErrorCode(mapped.code) ? mapped.code : 'UPSTREAM_FAILURE',
        'Provider route was saved, but the model list and any requested selection were not; reload settings before retrying',
        { ...conflict, partialSave: {
          persisted: 'routes', failed: 'selected', revisions: { routes: revision },
        } }, { cause: error })
    }
    return this.get()
  }

  async setCredential({ ref, value } = {}) {
    ref = nonempty(ref, 'ref')
    value = nonempty(value, 'value')
    try { await this.ctx.credentials.set(ref, value) }
    catch (error) { throw settingsError(error) }
    this.ctx.emit('ivoraige/settings-changed', { namespace: 'credentials' })
    return this.ctx.credentials.describe(ref)
  }
}

// Profile scaffolding is a static DSH composition. User edits go exclusively
// through DSH config-editor/settings and credentials-local after boot.
async function ensureProfile(directory) {
  const profileDir = resolve(directory)
  const bundleDir = join(profileDir, 'node_modules', PROFILE_BUNDLE)
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) AppBoot.initProfile(profileDir, [PROFILE_BUNDLE])
  await mkdir(bundleDir, { recursive: true })
  const bundleManifest = join(bundleDir, 'package.json')
  if (!existsSync(bundleManifest)) await writeFile(bundleManifest, JSON.stringify({
    name: PROFILE_BUNDLE, version: '0.1.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }) + '\n')
  const bundlePatch = join(bundleDir, 'cordis.patch.yml')
  if (!existsSync(bundlePatch)) await writeFile(bundlePatch, JSON.stringify([{ insert: [
    { id: 'credentials', name: 'cordis:credentials', config: { path: join(profileDir, '.credentials.yaml'), watch: false } },
    { id: 'llm', name: 'cordis:llm' },
    { id: ROUTES_NS, name: 'cordis:piAi', config: { providers: {} } },
    { id: 'config-editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    { id: 'settings-pages', name: 'cordis:settingsPages' },
    { id: MODEL_NS, name: 'cordis:modelSettings' },
  ] }]) + '\n')
  else {
    // Profiles created before settings pages already have this managed bundle.
    const patch = JSON.parse(await readFile(bundlePatch, 'utf8'))
    if (!patch.some(step => step.insert?.some(item => item.id === 'settings-pages'))) {
      const models = patch.find(step => step.insert?.some(item => item.id === MODEL_NS))?.insert
      if (!models) throw new Error('DSH model settings profile bundle is missing its model service')
      models.splice(models.findIndex(item => item.id === MODEL_NS), 0,
        { id: 'settings-pages', name: 'cordis:settingsPages' })
      await writeFile(bundlePatch, JSON.stringify(patch) + '\n')
    }
  }
  const configPath = join(profileDir, 'cordis.yml')
  // Additive managed-profile entry; existing model and credential settings stay intact.
  const componentPatch = JSON.parse(await readFile(bundlePatch, 'utf8'))
  if (!componentPatch.some(step => step.insert?.some(item => item.id === 'ivoraige-components'))) {
    componentPatch.push({ insert: [{ id: 'ivoraige-components', name: 'cordis:componentsSettings' }] })
    await writeFile(bundlePatch, JSON.stringify(componentPatch) + '\n')
  }
  if (!existsSync(configPath)) await writeFile(configPath, '[]\n')
  return { profileDir, configPath, patchPath: join(profileDir, 'cordis.patch.yml') }
}

export async function bootModelSettings({ directory } = {}) {
  directory = nonempty(directory, 'directory')
  const { profileDir, configPath, patchPath } = await ensureProfile(directory)
  const profile = {
    name: 'ivoraige', startedBundles: [PROFILE_BUNDLE], dir: profileDir, patchPath,
    installAnchor: join(profileDir, 'package.json'), cwd: profileDir, home: join(profileDir, '.home'),
    overlays: [], telemetryDisabledEnv: undefined,
  }
  const ctx = await AppBoot.boot('dsh', configPath, AppBoot.readProfilePatches('dsh', profile), root => {
    root.provide('profileContext', profile)
    Object.assign(root.loader.builtins, {
      credentials: LocalCredentialProvider, llm: LlmRuntime, piAi: LlmPiAi,
      editor: ConfigEditor, settings: SettingsForms, settingsPages: SettingsPages, modelSettings: ModelSettings,
      componentsSettings: ComponentsSettings,
    })
  })
  const settings = ctx.get('ivoraige.modelSettings')
  if (!settings) {
    await ctx.fiber.dispose()
    throw new Error('DSH model settings did not activate')
  }
  return { ctx, settings, dispose: () => ctx.fiber.dispose() }
}
