import { Service, LlmRuntime, LlmPiAi, createUserMessage, BlockAssembler } from '../dist/dsh.mjs'
import { randomUUID } from 'node:crypto'

const ROLES = new Set(['translation', 'builder', 'review'])
export class ModelError extends Error {
  constructor(message, code, finish, options) {
    super(message, options)
    this.name = code === 'ABORTED' ? 'AbortError' : 'ModelError'
    this.code = code
    if (finish) this.finish = finish
  }
}

/** Validate endpoint facts before mounting providers or making any request. */
function checkedConfig(config) {
  if (!config || !config.roles || typeof config.roles !== 'object' || Array.isArray(config.roles)) {
    throw new ModelError('Model configuration requires a roles object', 'INVALID_CONFIG')
  }
  if (config.network !== undefined && typeof config.network !== 'boolean') {
    throw new ModelError('network must be a boolean', 'INVALID_CONFIG')
  }
  const roles = {}
  const providers = new Map()
  for (const [role, value] of Object.entries(config.roles)) {
    if (!ROLES.has(role)) throw new ModelError(`Unsupported model role: ${role}`, 'INVALID_ROLE')
    if (!value || ['provider', 'model', 'baseURL'].some(key => typeof value[key] !== 'string' || !value[key].trim())) {
      throw new ModelError(`Role ${role} requires provider, model and baseURL`, 'INVALID_CONFIG')
    }
    if (value.apiKeyEnv !== undefined && (typeof value.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.apiKeyEnv))) {
      throw new ModelError(`Role ${role} apiKeyEnv must name an environment variable`, 'INVALID_CONFIG')
    }
    let url
    try { url = new URL(value.baseURL) } catch { throw new ModelError(`Role ${role} has an invalid baseURL`, 'INVALID_CONFIG') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new ModelError(`Role ${role} requires an HTTP(S) baseURL without credentials, query or fragment`, 'INVALID_CONFIG')
    }
    const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname)
    if (config.network !== true && !loopback) {
      throw new ModelError(`Role ${role} requires network:true for a non-loopback endpoint`, 'NETWORK_DISABLED')
    }
    if (!loopback && value.apiKeyEnv === undefined) {
      throw new ModelError(`Role ${role} requires an explicit apiKeyEnv for a non-loopback endpoint`, 'INVALID_CONFIG')
    }
    if (value.maxTokens !== undefined && (!Number.isSafeInteger(value.maxTokens) || value.maxTokens <= 0)) {
      throw new ModelError(`Role ${role} maxTokens must be a positive integer`, 'INVALID_CONFIG')
    }
    const entry = Object.freeze({ ...value, baseURL: url.href.replace(/\/$/, '') })
    const previous = providers.get(entry.provider)
    if (previous && (previous.baseURL !== entry.baseURL || previous.apiKeyEnv !== entry.apiKeyEnv)) {
      throw new ModelError(`Provider ${entry.provider} has conflicting role endpoints or credential references; use distinct provider keys`, 'PROVIDER_CONFLICT')
    }
    providers.set(entry.provider, entry)
    roles[role] = entry
  }
  if (!Object.keys(roles).length) throw new ModelError('At least one model role is required', 'INVALID_CONFIG')
  return Object.freeze({ network: config.network === true, roles: Object.freeze(roles) })
}

/** Small business-facing service over the real DSH streaming runtime. */
export class Model extends Service {
  static inject = ['llm']
  constructor(ctx, config) {
    const checked = checkedConfig(config)
    super(ctx, 'ivoraige.model')
    this.config = checked
    this.calls = []
    this.active = new Set()
    this.disposed = false
    ctx.effect(() => async () => {
      this.disposed = true
      const active = [...this.active]
      for (const call of active) call.controller.abort('Model service unloaded')
      await Promise.allSettled(active.map(call => call.promise))
    })
  }

  async generate(role, prompt, signal) {
    const started = Date.now()
    const profile = this.config.roles[role]
    const call = {
      provenance: { role, provider: profile?.provider ?? null, model: profile?.model ?? null, promptVersion: 'm2-3' },
      status: 'running', finish: null,
      startedAt: new Date(started).toISOString(), elapsedMs: null,
      usage: { status: 'unknown', inputTokens: null, outputTokens: null, totalTokens: null },
    }
    this.calls.push(call)
    const controller = new AbortController()
    const abort = () => controller.abort(signal.reason)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const active = { controller, promise: null }
    try {
      if (this.disposed) throw new ModelError('Model service has been unloaded', 'ABORTED')
      active.promise = this._generate(role, prompt, controller.signal)
      this.active.add(active)
      const result = await active.promise
      call.status = 'completed'
      call.finish = result.finish
      call.usage = result.usage
      return result
    } catch (error) {
      error.provenance = call.provenance
      call.status = error.code === 'ABORTED' ? 'cancelled' : 'failed'
      call.finish = error.finish ?? null
      call.error = { name: error.name, code: error.code ?? 'MODEL_ERROR' }
      throw error
    } finally {
      call.elapsedMs = Date.now() - started
      this.active.delete(active)
      signal?.removeEventListener('abort', abort)
    }
  }

  async _generate(role, prompt, signal) {
    const profile = this.config.roles[role]
    if (!profile || !ROLES.has(role)) throw new ModelError(`Model role is not configured: ${role}`, 'INVALID_ROLE')
    if (typeof prompt !== 'string' || !prompt.trim()) throw new ModelError('Model prompt must be nonempty text', 'INVALID_PROMPT')
    if (signal?.aborted) throw new ModelError('Model request was cancelled', 'ABORTED')
    const assembler = new BlockAssembler()
    let terminal = false
    try {
      for await (const chunk of this.ctx.llm.stream({
        provider: profile.provider,
        model: profile.model,
        ...(profile.maxTokens === undefined ? {} : { maxTokens: profile.maxTokens }),
        messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })],
        ...(signal ? { signal } : {}),
      })) {
        assembler.push(chunk)
        if (chunk.type === 'finish') terminal = true
      }
    } catch (error) {
      if (signal?.aborted || error.name === 'AbortError') throw new ModelError('Model request was cancelled', 'ABORTED', undefined, { cause: error })
      throw new ModelError('Model stream failed', error.code ?? 'MODEL_ERROR', undefined, { cause: error })
    }
    const finish = assembler.finish
    if (signal?.aborted || finish.kind === 'aborted') throw new ModelError('Model request was cancelled', 'ABORTED', finish)
    if (finish.kind === 'error') throw new ModelError(finish.failure?.message ?? 'Model request failed', finish.failure?.code ?? 'MODEL_ERROR', finish)
    if (!terminal) throw new ModelError('Model stream ended without a terminal outcome', 'INCOMPLETE_STREAM')
    if (finish.kind === 'max-tokens') throw new ModelError('Model response reached its token limit', 'INCOMPLETE_STREAM', finish)
    if (finish.kind !== 'stop') throw new ModelError(`Unsupported model outcome: ${finish.kind}`, 'UNSUPPORTED_FINISH', finish)
    return {
      text: assembler.blocks().filter(block => block.type === 'text').map(block => block.text).join(''),
      finish,
      // pi-ai fills absent provider usage with zero; its normalized stream
      // does not establish provenance. Never record that as known zero cost.
      usage: { status: 'unknown', inputTokens: null, outputTokens: null, totalTokens: null },
      provenance: { role, provider: profile.provider, model: profile.model, promptVersion: 'm2-3' },
    }
  }
}

/** Mount explicitly configured OpenAI-compatible routes; no ambient fallback. */
export async function mountModel(ctx, config) {
  const checked = checkedConfig(config)
  // OpenAI SDK requires an authentication value even for an unauthenticated
  // local server. Use a unique, non-secret sentinel reference so it cannot
  // discover an unrelated ambient provider key. Dispose it with this mount.
  const dummyRef = Object.values(checked.roles).some(profile => profile.apiKeyEnv === undefined)
    ? `IVORAIGE_LOCAL_DUMMY_${randomUUID().replaceAll('-', '')}` : undefined
  const providers = {}
  for (const profile of Object.values(checked.roles)) {
    const provider = providers[profile.provider] ??= {
      api: 'openai-completions', baseURL: profile.baseURL, apiKeyEnv: profile.apiKeyEnv ?? dummyRef,
      models: [], retryPolicy: { mode: 'normal', maxRetries: 0 },
    }
    const existing = provider.models.find(model => model.id === profile.model)
    if (existing) existing.maxTokens = Math.max(existing.maxTokens, profile.maxTokens ?? 4096)
    else provider.models.push({ id: profile.model, name: profile.model, contextWindow: 65536, maxTokens: profile.maxTokens ?? 4096, ...(profile.reasoningEfforts === undefined ? {} : { reasoningEfforts: profile.reasoningEfforts }), ...(profile.compat === undefined ? {} : { compat: profile.compat }) })
  }
  const fibers = []
  try {
    if (dummyRef) {
      fibers.push(await ctx.plugin({ name: 'ivoraige-local-auth', apply(child) {
        child.effect(() => {
          process.env[dummyRef] = 'ivoraige-local-no-auth'
          return () => { delete process.env[dummyRef] }
        })
      } }))
    }
    fibers.push(await ctx.plugin(LlmRuntime))
    fibers.push(await ctx.plugin(LlmPiAi, { providers }))
    fibers.push(await ctx.plugin(Model, checked))
    return fibers
  } catch (error) {
    for (const fiber of fibers.reverse()) await fiber.dispose()
    throw error
  }
}
