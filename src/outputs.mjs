import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'

function available(adapter, contentMode) {
  const state = adapter.status?.().state
  if (state === 'disabled' || state === 'failed') return false
  return state !== 'unavailable' || adapter.canRunUnavailable?.(contentMode) === true
}

export class Outputs extends Service {
  constructor(ctx) {
    super(ctx, 'ivoraige.outputs')
    this.adapters = new Map()
  }

  register(adapter) {
    if (!adapter?.id || typeof adapter.supports !== 'function' || typeof adapter.rebuild !== 'function') {
      throw new KernelError('INVALID_ARGUMENT', 'Output adapter requires id, supports and rebuild')
    }
    if (this.adapters.has(adapter.id)) {
      throw new KernelError('INVALID_ARGUMENT', `Output adapter already registered: ${adapter.id}`)
    }
    if (adapter.version !== undefined && (typeof adapter.version !== 'string' || !adapter.version.trim()))
      throw new KernelError('INVALID_ARGUMENT', 'Output adapter version must be a nonempty string')
    if (adapter.formats !== undefined && (!Array.isArray(adapter.formats) || !adapter.formats.length ||
        adapter.formats.some(format => typeof format !== 'string' || !format)))
      throw new KernelError('INVALID_ARGUMENT', 'Output adapter formats must be nonempty')
    if (adapter.requiredViews !== undefined && (!Array.isArray(adapter.requiredViews) ||
        adapter.requiredViews.some(view => !['readable-text', 'native-markdown'].includes(view))))
      throw new KernelError('INVALID_ARGUMENT', 'Output adapter requiredViews is invalid')
    this.adapters.set(adapter.id, adapter)
    this.ctx.emit('ivoraige/capabilities-changed', { kind: 'output', id: adapter.id })
    return () => {
      if (this.adapters.get(adapter.id) === adapter) {
        this.adapters.delete(adapter.id)
        this.ctx.emit('ivoraige/capabilities-changed', { kind: 'output', id: adapter.id })
      }
    }
  }

  viewError(adapter, { binding, provenance } = {}) {
    const views = adapter.requiredViews ?? []
    if (!views.length) return null
    const parser = this.ctx.get('ivoraige.parse')
    if (!parser) return new KernelError('COMPONENT_MISSING', 'Source adapter registry is unavailable')
    if (binding !== undefined) return parser.outputViewError(binding, { views, provenance })
    return parser.hasOutputViews(views) ? null :
      new KernelError('COMPONENT_MISSING', 'No source adapter provides the requested output views')
  }

  availableAdapters(options = {}) {
    const { binding, contentMode } = options
    return [...this.adapters.values()].filter(adapter => available(adapter, contentMode) &&
      (binding === undefined || adapter.supports(binding, contentMode)) && !this.viewError(adapter, options))
  }

  availableFor(binding, options = {}) { return this.listFormats({ ...options, binding }) }
  listAdapters(options = {}) { return this.availableAdapters(options).map(adapter => adapter.id) }
  listFormats(options = {}) { return [...new Set(this.availableAdapters(options)
    .flatMap(adapter => adapter.formats ?? [adapter.id]))] }

  get(format, { adapterId, binding, provenance, contentMode } = {}) {
    if (adapterId !== undefined && (typeof adapterId !== 'string' || !adapterId))
      throw new KernelError('INVALID_ARGUMENT', 'adapterId must be a nonempty string')
    const candidates = [...this.adapters.values()].filter(adapter =>
      (adapter.formats ?? [adapter.id]).includes(format) &&
      (adapterId === undefined || adapter.id === adapterId))
    if (!candidates.length) throw new KernelError(adapterId ? 'COMPONENT_MISSING' : 'INVALID_ARGUMENT',
      `Output adapter for ${format} is not installed`, { format, adapterId })
    const compatible = candidates.filter(adapter =>
      available(adapter, contentMode) &&
      (binding === undefined || adapter.supports(binding, contentMode)))
    if (!compatible.length) throw new KernelError('PRECONDITION_FAILED',
      'Output adapter does not support the frozen source binding or mode', { format, adapterId })
    const checked = compatible.map(adapter => ({ adapter, error: this.viewError(adapter, { binding, provenance }) }))
    const ready = checked.filter(item => !item.error).map(item => item.adapter)
    if (!ready.length) throw checked[0].error
    if (ready.length > 1) throw new KernelError('CONFLICT', 'Output adapter selection is ambiguous',
      { format, adapterIds: ready.map(adapter => adapter.id) })
    return ready[0]
  }
}
