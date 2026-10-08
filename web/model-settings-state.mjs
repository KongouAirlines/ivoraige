export const emptyModelForm = () => ({ provider: '', model: '', api: '', baseURL: '',
  credentialRef: '', contextWindow: '', maxTokens: '', timeoutMs: 120_000,
  reasoning: '', thinkingFormat: '', reasoningEfforts: null, compat: {} })

export function modelForm(settings, provider = settings.selected?.provider, model = settings.selected?.model) {
  const route = settings.routes?.[provider] ?? {}
  const declared = route.models?.find(item => item.id === model) ?? route.modelOverrides?.[model] ?? {}
  const saved = settings.savedModels?.find(item => item.provider === provider && item.model === model)
  return { ...emptyModelForm(), provider: provider ?? '', model: model ?? '',
    api: route.api ?? '', baseURL: route.baseURL ?? '', credentialRef: route.apiKeyEnv ?? '',
    contextWindow: declared.contextWindow ?? '', maxTokens: declared.maxTokens ?? '',
    timeoutMs: saved?.timeoutMs ?? (settings.selected?.provider === provider && settings.selected?.model === model
      ? settings.selected.timeoutMs : 120_000),
    reasoning: route.reasoning ?? '', thinkingFormat: route.compat?.thinkingFormat ?? '',
    reasoningEfforts: declared.reasoningEfforts ?? null, compat: { ...route.compat } }
}

export function presetForm(preset) {
  const { defaults } = preset
  return { ...emptyModelForm(), ...defaults, thinkingFormat: defaults.compat?.thinkingFormat ?? '',
    compat: { ...defaults.compat } }
}

export function formForPresetChoice(settings, preset) {
  const { provider, model } = preset.defaults
  return settings?.routes?.[provider]
    ? modelForm(settings, provider, model)
    : presetForm(preset)
}

// Identity changes must read destination scope before constructing a request.
// Route fields are shared by provider; capacities and timeout belong to a model.
export function formForProviderChange(settings, presets, form, provider) {
  const sameModel = sharedRouteModels(settings, provider).some(item => item.model === form.model)
  const model = sameModel ? form.model : ''
  if (settings.routes?.[provider]) return modelForm(settings, provider, model)
  const preset = presets.find(item => item.defaults.provider === provider)
  if (preset) {
    const target = presetForm(preset)
    return { ...target, model, contextWindow: '', maxTokens: '', reasoningEfforts: null }
  }
  return { ...emptyModelForm(), provider, model }
}

export function formForModelChange(settings, form, model) {
  const target = modelForm(settings, form.provider, model)
  return { ...form, model, contextWindow: target.contextWindow, maxTokens: target.maxTokens,
    reasoningEfforts: target.reasoningEfforts, timeoutMs: target.timeoutMs }
}

export function modelSettingsRequest(form, revisions, select = false) {
  const hasContext = String(form.contextWindow).trim() !== ''
  const hasMaxTokens = String(form.maxTokens).trim() !== ''
  if (hasContext !== hasMaxTokens) throw new Error('上下文窗口与最大 token 必须同时填写，或同时留空。')
  const body = { provider: form.provider, model: form.model, select,
    routesRevision: revisions.routes, selectedRevision: revisions.selected,
    timeoutMs: Number(form.timeoutMs) }
  for (const field of ['api', 'baseURL', 'credentialRef', 'reasoning']) {
    body[field] = form[field] || null
  }
  if (hasContext) {
    body.contextWindow = Number(form.contextWindow)
    body.maxTokens = Number(form.maxTokens)
  } else { body.contextWindow = null; body.maxTokens = null }
  const compat = { ...form.compat }
  if (form.thinkingFormat) compat.thinkingFormat = form.thinkingFormat
  else delete compat.thinkingFormat
  body.compat = compat
  body.reasoningEfforts = form.reasoningEfforts
  return body
}

export function modelSettingsPath(provider, model) {
  if (provider === undefined) return '/settings/models?new=1'
  const params = new URLSearchParams({ provider, model })
  return `/settings/models?${params}`
}

export function modelSettingsView(path = '') {
  const query = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
  const params = new URLSearchParams(query)
  if (params.has('new')) return { kind: 'new' }
  if (params.has('provider') && params.has('model')) {
    return { kind: 'edit', provider: params.get('provider'), model: params.get('model') }
  }
  return { kind: 'list' }
}

export function savedModelPathAfterSave(view, form) {
  if (view.kind === 'new' || (view.kind === 'edit' &&
    (view.provider !== form.provider || view.model !== form.model))) {
    return modelSettingsPath(form.provider, form.model)
  }
  return null
}

export function sharedRouteModels(settings, provider) {
  return (settings?.savedModels ?? []).filter(item => item.provider === provider)
}

export function modelDraftDirty(form, baseline, secret = '') {
  // Number inputs return strings; restoring the displayed saved value is clean.
  const comparable = value => ({ ...value, timeoutMs: String(value.timeoutMs),
    contextWindow: String(value.contextWindow), maxTokens: String(value.maxTokens) })
  return !!secret || JSON.stringify(comparable(form)) !== JSON.stringify(comparable(baseline))
}

export function shouldReplaceModelDraft({ available, settings, initializedView, viewKey, form, baseline, secret }) {
  return !!available && !!settings &&
    (initializedView !== viewKey || !modelDraftDirty(form, baseline, secret))
}

export function mayApplyModelRead({ active, available, startedVersion, currentVersion, startedView, currentView }) {
  return !!active && !!available && startedVersion === currentVersion && startedView === currentView
}
