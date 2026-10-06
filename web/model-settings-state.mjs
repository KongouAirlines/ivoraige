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
    timeoutMs: saved?.timeoutMs ?? settings.selected?.timeoutMs ?? 120_000,
    reasoning: route.reasoning ?? '', thinkingFormat: route.compat?.thinkingFormat ?? '',
    reasoningEfforts: declared.reasoningEfforts ?? null, compat: { ...route.compat } }
}

export function presetForm(preset) {
  const { defaults } = preset
  return { ...emptyModelForm(), ...defaults, thinkingFormat: defaults.compat?.thinkingFormat ?? '',
    compat: { ...defaults.compat } }
}

export function modelSettingsRequest(form, revisions, select = false) {
  const body = { provider: form.provider, model: form.model, select,
    routesRevision: revisions.routes, selectedRevision: revisions.selected,
    timeoutMs: Number(form.timeoutMs) }
  for (const field of ['api', 'baseURL', 'credentialRef', 'reasoning']) {
    body[field] = form[field] || null
  }
  if (form.contextWindow || form.maxTokens) {
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
