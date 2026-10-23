import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'

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

  availableFor(sourceBinding) {
    return [...new Set([...this.adapters.values()].filter(adapter => adapter.supports(sourceBinding))
      .flatMap(adapter => adapter.formats ?? [adapter.id]))]
  }

  listAdapters() { return [...this.adapters.values()].filter(adapter => adapter.status?.().state !== 'unavailable').map(adapter => adapter.id) }
  listFormats() { return [...new Set([...this.adapters.values()]
    .filter(adapter => !['unavailable', 'disabled', 'failed'].includes(adapter.status?.().state))
    .flatMap(adapter => adapter.formats ?? [adapter.id]))] }

  get(format, { adapterId, binding, contentMode } = {}) {
    if (adapterId !== undefined && (typeof adapterId !== 'string' || !adapterId))
      throw new KernelError('INVALID_ARGUMENT', 'adapterId must be a nonempty string')
    const candidates = [...this.adapters.values()].filter(adapter =>
      (adapter.formats ?? [adapter.id]).includes(format) &&
      (adapterId === undefined || adapter.id === adapterId))
    if (!candidates.length) throw new KernelError(adapterId ? 'COMPONENT_MISSING' : 'INVALID_ARGUMENT',
      `Output adapter for ${format} is not installed`, { format, adapterId })
    const compatible = candidates.filter(adapter =>
      (!['unavailable', 'disabled', 'failed'].includes(adapter.status?.().state) ||
        adapter.canRunUnavailable?.(contentMode)) &&
      (binding === undefined || adapter.supports(binding, contentMode)))
    if (!compatible.length) throw new KernelError('PRECONDITION_FAILED',
      'Output adapter does not support the frozen source binding or mode', { format, adapterId })
    if (compatible.length > 1) throw new KernelError('CONFLICT', 'Output adapter selection is ambiguous',
      { format, adapterIds: compatible.map(adapter => adapter.id) })
    return compatible[0]
  }
}
