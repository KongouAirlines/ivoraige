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
    await Promise.all([...this.handles].map(async handle => { await handle.close(); this.handles.delete(handle) }))
  }
}
