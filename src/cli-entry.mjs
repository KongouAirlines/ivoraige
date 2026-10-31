import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'

export class CliEntry extends Service {
  static inject = ['ivoraige.operations', 'ivoraige.capabilities']
  constructor(ctx) {
    super(ctx, 'ivoraige.cliEntry')
    this.closing = false
    this.controllers = new Set()
    ctx.effect(() => () => this.close())
  }
  async invoke(operation, input, { signal } = {}) {
    if (this.closing) throw new KernelError('COMPONENT_MISSING', 'CLI entry is closed')
    const controller = new AbortController()
    this.controllers.add(controller)
    try { return await this.ctx.get('ivoraige.operations').invoke(operation, input,
      { signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal }) }
    finally { this.controllers.delete(controller) }
  }
  close() {
    this.closing = true
    for (const controller of this.controllers) controller.abort()
  }
}
