import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { AppBoot, ConfigEditor, Context, DshSchema as z, LlmPiAi, LlmRuntime,
  LocalCredentialProvider, Service, SettingsForms } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'

const MODEL_NS = 'ivoraige-model'
const ROUTES_NS = 'llm-pi-ai'
const PROFILE_BUNDLE = 'ivoraige-model-settings'

const nonempty = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new KernelError('INVALID_ARGUMENT', `${field} must be a nonempty string`)
  }
  return value.trim()
}

// A business selection is a normal DSH volatile Config. DSH owns its profile
// patch, revision checks, live update, and credential document.
export class ModelSettings extends Service {
  static inject = ['settings', 'credentials']
  static Config = z.object({
    provider: z.string().default('').volatile(),
    model: z.string().default('').volatile(),
    timeoutMs: z.number().min(1).default(120_000).volatile(),
  })

  constructor(ctx, config) {
    super(ctx, 'ivoraige.modelSettings')
    this.config = config
  }

  resolve() {
    const provider = this.config.provider.get()
    const model = this.config.model.get()
    return provider && model ? { provider, model, timeoutMs: this.config.timeoutMs.get() } : null
  }

  async get() {
    const descriptors = this.ctx.settings.describe({ redactSecrets: true })
    const routeForm = descriptors.find(row => row.ns === ROUTES_NS)
    const modelForm = descriptors.find(row => row.ns === MODEL_NS)
    if (!routeForm || !modelForm) throw new Error('DSH model settings forms are unavailable')
    const providers = routeForm.value?.providers ?? {}
    const credentials = {}
    for (const [provider, route] of Object.entries(providers)) {
      if (route && typeof route.apiKeyEnv === 'string') {
        credentials[provider] = await this.ctx.credentials.describe(route.apiKeyEnv)
      }
    }
    return {
      selected: this.resolve(),
      routes: providers,
      credentials,
      revisions: { routes: routeForm.revision, selected: modelForm.revision },
    }
  }

  // Route options use DSH's pi-ai schema. A route may be an installed provider
  // with catalog defaults, or a fully declared OpenAI-compatible endpoint.
  async update({ provider, model, api, baseURL, credentialRef, contextWindow, maxTokens,
    reasoning, compat, reasoningEfforts, timeoutMs,
    routesRevision, selectedRevision } = {}) {
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
    const forms = this.ctx.settings.describe()
    for (const [ns, expected] of [[ROUTES_NS, routesRevision], [MODEL_NS, selectedRevision]]) {
      if (expected === undefined) continue
      const actual = forms.find(row => row.ns === ns)?.revision
      if (actual !== expected) {
        throw new KernelError('CONFLICT', `${ns} settings changed`, { expected, actual })
      }
    }
    const currentRoute = forms.find(row => row.ns === ROUTES_NS)?.value?.providers?.[provider]
    const route = currentRoute ? structuredClone(currentRoute) : {}
    if (api !== undefined) route.api = nonempty(api, 'api')
    if (baseURL !== undefined) route.baseURL = nonempty(baseURL, 'baseURL')
    if (credentialRef !== undefined) route.apiKeyEnv = nonempty(credentialRef, 'credentialRef')
    if (reasoning !== undefined) route.reasoning = nonempty(reasoning, 'reasoning')
    if (compat !== undefined) route.compat = structuredClone(compat)
    if (contextWindow !== undefined || maxTokens !== undefined) {
      if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0 ||
          !Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
        throw new KernelError('INVALID_ARGUMENT', 'contextWindow and maxTokens must be positive integers')
      }
      const existingModels = Array.isArray(route.models) ? route.models : []
      route.models = [...existingModels.filter(entry => entry.id !== model), {
        ...(existingModels.find(entry => entry.id === model) ?? {}), id: model,
        contextWindow, maxTokens,
        ...(reasoningEfforts === undefined ? {} : { reasoningEfforts: structuredClone(reasoningEfforts) }),
      }]
    } else if (reasoningEfforts !== undefined) {
      const existingModels = Array.isArray(route.models) ? route.models : []
      const existing = existingModels.find(entry => entry.id === model)
      if (!existing) throw new KernelError('INVALID_ARGUMENT',
        'reasoningEfforts requires a declared model or contextWindow and maxTokens')
      route.models = existingModels.map(entry => entry.id === model
        ? { ...entry, reasoningEfforts: structuredClone(reasoningEfforts) } : entry)
    }
    if (api !== undefined || baseURL !== undefined || credentialRef !== undefined ||
        contextWindow !== undefined || maxTokens !== undefined || reasoning !== undefined ||
        compat !== undefined || reasoningEfforts !== undefined) {
      await this.ctx.settings.mutate(ROUTES_NS,
        [{ op: 'set', path: ['providers', provider], value: route }], routesRevision)
    }
    await this.ctx.settings.mutate(MODEL_NS, [
      { op: 'set', path: ['provider'], value: provider },
      { op: 'set', path: ['model'], value: model },
      ...(timeoutMs === undefined ? [] : [{ op: 'set', path: ['timeoutMs'], value: timeoutMs }]),
    ], selectedRevision)
    return this.get()
  }

  async setCredential({ ref, value } = {}) {
    ref = nonempty(ref, 'ref')
    value = nonempty(value, 'value')
    await this.ctx.credentials.set(ref, value)
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
    { id: MODEL_NS, name: 'cordis:modelSettings' },
  ] }]) + '\n')
  const configPath = join(profileDir, 'cordis.yml')
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
      editor: ConfigEditor, settings: SettingsForms, modelSettings: ModelSettings,
    })
  })
  const settings = ctx.get('ivoraige.modelSettings')
  if (!settings) {
    await ctx.fiber.dispose()
    throw new Error('DSH model settings did not activate')
  }
  return { ctx, settings, dispose: () => ctx.fiber.dispose() }
}
