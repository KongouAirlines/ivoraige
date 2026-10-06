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
    this.adapters.set(adapter.id, adapter)
    return () => {
      if (this.adapters.get(adapter.id) === adapter) this.adapters.delete(adapter.id)
    }
  }

  availableFor(sourceBinding) {
    return [...this.adapters.values()].filter(adapter => adapter.supports(sourceBinding)).map(adapter => adapter.id)
  }

  listAdapters() { return [...this.adapters.keys()] }

  get(format) {
    const adapter = this.adapters.get(format)
    if (!adapter) throw new KernelError('INVALID_ARGUMENT', `Output format is not installed: ${format}`, {
      availableFormats: [...this.adapters.keys()],
    })
    return adapter
  }
}
