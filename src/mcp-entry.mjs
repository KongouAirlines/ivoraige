import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'

export class McpEntry extends Service {
  static inject = ['ivoraige.operations', 'ivoraige.capabilities', 'ivoraige.mcp']
  constructor(ctx) {
    super(ctx, 'ivoraige.mcpEntry')
    this.handles = new Set()
    this.closing = false
    ctx.effect(() => () => this.close())
  }
  own(close) {
    if (this.closing) throw new KernelError('COMPONENT_MISSING', 'MCP entry is closed')
    const handle = { close }
    this.handles.add(handle)
    return () => this.handles.delete(handle)
  }
  async close() {
    this.closing = true
    const results = await Promise.allSettled([...this.handles].map(async handle => {
      try { await handle.close() }
      finally { this.handles.delete(handle) }
    }))
    const failure = results.find(result => result.status === 'rejected')
    if (failure) throw failure.reason
  }
}
