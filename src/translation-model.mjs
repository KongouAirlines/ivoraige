import { Service, BlockAssembler } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'

export const PROMPT_VERSION = 'scientific-translation-v1'

const SYSTEM_PROMPT = 'Translate the source text faithfully. Return only the translated text. Preserve scientific meaning, numbers, citations, and mathematical notation. Do not add explanations.'

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new KernelError('INVALID_ARGUMENT', `${name} must be a nonempty string`)
  }
  return value
}

function count(value) {
  // pi-ai zero-fills omitted usage; zero cannot be distinguished from unknown.
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function upstreamFailure(canceled = false, reason = 'Model translation failed', cause) {
  return new KernelError('UPSTREAM_FAILURE', reason, { stage: 'model', ...(canceled ? { canceled: true } : {}) }, { cause })
}

export class TranslationModel extends Service {
  static inject = ['llm']

  constructor(ctx, { provider, model, timeoutMs = 120_000, select } = {}) {
    super(ctx, 'ivoraige.translationModel')
    if (select !== undefined && typeof select !== 'function') {
      throw new KernelError('INVALID_ARGUMENT', 'select must be a function')
    }
    if (select !== undefined && (provider !== undefined || model !== undefined)) {
      throw new KernelError('INVALID_ARGUMENT', 'select cannot be combined with provider or model')
    }
    this.select = select
    this.provider = select ? null : requiredString(provider, 'provider')
    this.model = select ? null : requiredString(model, 'model')
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new KernelError('INVALID_ARGUMENT', 'timeoutMs must be a positive integer')
    }
    this.timeoutMs = timeoutMs
  }

  async translate({ basis, signal } = {}) {
    if (!basis || typeof basis !== 'object' || Array.isArray(basis)) {
      throw new KernelError('INVALID_ARGUMENT', 'basis must be an object')
    }
    const { sourceText, sourceLang, targetLang, effectiveContext, effectiveTarget, termConstraintSetId } = basis
    requiredString(sourceText, 'basis.sourceText')
    requiredString(sourceLang, 'basis.sourceLang')
    requiredString(targetLang, 'basis.targetLang')
    if (effectiveContext === undefined || effectiveTarget === undefined) {
      throw new KernelError('INVALID_ARGUMENT', 'basis requires effectiveContext and effectiveTarget')
    }
    if (termConstraintSetId !== 'none') {
      throw new KernelError('PRECONDITION_FAILED', 'Term constraint assembly is not available')
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new KernelError('INVALID_ARGUMENT', 'signal must be an AbortSignal')
    }
    if (signal?.aborted) throw upstreamFailure(true, 'Model translation canceled')

    const selection = this.select?.() ?? (this.select ? null :
      { provider: this.provider, model: this.model, timeoutMs: this.timeoutMs })
    if (!selection) throw new KernelError('COMPONENT_MISSING', 'No translation model configured')
    const provider = requiredString(selection.provider, 'provider')
    const model = requiredString(selection.model, 'model')
    const timeoutMs = selection.timeoutMs ?? this.timeoutMs
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new KernelError('INVALID_ARGUMENT', 'timeoutMs must be a positive integer')
    }
    const timeout = AbortSignal.timeout(timeoutMs)
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    const assembler = new BlockAssembler()
    let finished = false
    try {
      for await (const chunk of this.ctx.llm.stream({
        provider,
        model,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({
          sourceLang, targetLang, effectiveContext, effectiveTarget, sourceText,
        }) }] }],
        signal: requestSignal,
      })) {
        assembler.push(chunk)
        if (chunk.type === 'finish') finished = true
      }
    } catch (cause) {
      throw upstreamFailure(requestSignal.aborted && !timeout.aborted, requestSignal.aborted
        ? 'Model translation canceled or timed out' : 'Model translation failed', cause)
    }
    if (!finished) throw upstreamFailure(false, 'Model response ended without a finish event')
    const finish = assembler.finish
    if (finish.kind !== 'stop') {
      throw upstreamFailure(Boolean(signal?.aborted),
        finish.kind === 'max-tokens' ? 'Model response was truncated' : 'Model translation failed')
    }
    const blocks = assembler.blocks()
    if (blocks.some(block => block.type !== 'text' && block.type !== 'reasoning')) {
      throw upstreamFailure(false, 'Model returned unsupported content')
    }
    const text = blocks.filter(block => block.type === 'text').map(block => block.text).join('')
    if (!text.trim()) throw upstreamFailure(false, 'Model returned empty translation')
    return {
      text,
      modelId: `${provider}/${model}`,
      promptVersion: PROMPT_VERSION,
      tokens: { input: count(assembler.usage?.inputTokens), output: count(assembler.usage?.outputTokens) },
    }
  }
}
