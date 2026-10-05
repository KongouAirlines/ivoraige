import { KernelError } from '../errors.mjs'

const escapeProse = value => value.replace(/[\\`*_{}\[\]()<>#+.!|~$&-]/g, '\\$&')

// This renderer receives only resolved frozen snapshot data. The original source
// is the template; accepted prose replaces indexed spans and everything else
// remains byte-for-byte as imported.
export function renderMarkdown({ sourceBinding, units }) {
  if (sourceBinding?.adapterId !== 'markdown' || typeof sourceBinding.raw !== 'string' ||
      !Array.isArray(sourceBinding.spans) || !Array.isArray(units)) {
    throw new KernelError('PRECONDITION_FAILED', 'Frozen Markdown source binding is unavailable')
  }
  const byOrder = new Map(units.map(item => [item.unit.order, item]))
  let offset = 0
  let rendered = ''
  for (const span of sourceBinding.spans) {
    if (!Number.isSafeInteger(span.order) || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) ||
        span.start < offset || span.end <= span.start || span.end > sourceBinding.raw.length) {
      throw new KernelError('PRECONDITION_FAILED', 'Frozen Markdown source spans are invalid')
    }
    const item = byOrder.get(span.order)
    const original = sourceBinding.raw.slice(span.start, span.end)
    if (!item || item.unit.sourceText !== original || !item.unit.translatable ||
        !['revision', 'skip', 'keepOriginal'].includes(item.decision.type)) {
      throw new KernelError('PRECONDITION_FAILED', 'Frozen Markdown unit does not match its source span')
    }
    let replacement = original
    if (item.decision.type === 'revision') {
      if (typeof item.text !== 'string' || !item.text.trim() || /[\r\n\u0000-\u001f]/.test(item.text)) {
        throw new KernelError('PRECONDITION_FAILED', 'Markdown revision must be nonempty single-line prose')
      }
      replacement = escapeProse(item.text)
    }
    rendered += sourceBinding.raw.slice(offset, span.start) + replacement
    offset = span.end
  }
  return rendered + sourceBinding.raw.slice(offset)
}
