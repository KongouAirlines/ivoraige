import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'

// Public descriptions only. Cordis owns activation, dependencies and cleanup.
export class CapabilityCatalog extends Service {
  constructor(ctx) {
    super(ctx, 'ivoraige.capabilities')
    this.descriptors = new Map()
  }
  register({ id, kind = 'service', requires = [] }) {
    if (typeof id !== 'string' || !id || !['service', 'entry'].includes(kind) ||
        !Array.isArray(requires) || requires.some(x => typeof x !== 'string'))
      throw new KernelError('INVALID_ARGUMENT', 'Capability requires an id and service requirements')
    if (this.descriptors.has(id)) throw new KernelError('CONFLICT', 'Capability already registered', { id })
    const item = Object.freeze({ id, kind, requires: Object.freeze([...requires]) })
    this.descriptors.set(id, item)
    this.ctx.emit('ivoraige/capabilities-changed', { kind, id })
    return () => {
      if (this.descriptors.get(id) === item) {
        this.descriptors.delete(id)
        this.ctx.emit('ivoraige/capabilities-changed', { kind, id })
      }
    }
  }
  list() {
    return [...this.descriptors.values()].map(item => ({ ...item, requires: [...item.requires],
      available: item.requires.every(service => Boolean(this.ctx.get(service))) }))
  }
}

export const CapabilityContributions = {
  inject: ['ivoraige.capabilities'],
  apply(ctx) {
    for (const [id, service, kind] of [
      ['parse', 'ivoraige.parse'], ['outputs', 'ivoraige.outputs'], ['records', 'ivoraige.records'],
      ['tasks', 'ivoraige.tasks'], ['settings', 'ivoraige.modelSettings'], ['components', 'ivoraige.components'],
      ['events', 'ivoraige.events'], ['operations', 'ivoraige.operations'],
      ['cli', 'ivoraige.cliEntry', 'entry'], ['http', 'ivoraige.httpEntry', 'entry'], ['mcp', 'ivoraige.mcpEntry', 'entry'],
    ]) ctx.effect(() => ctx.get('ivoraige.capabilities').register({ id, kind, requires: [service] }))
  },
}
