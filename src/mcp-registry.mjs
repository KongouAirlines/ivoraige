import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'

// Optional entry registration, independent of the MCP SDK and business plugins.
export class McpRegistry extends Service {
  constructor(ctx) {
    super(ctx, 'ivoraige.mcp')
    this.tools = new Map()
    this.resources = new Map()
    this.listeners = new Set()
  }
  registerTool(name, definition) { return this.register(this.tools, name, definition) }
  registerResource(name, definition) { return this.register(this.resources, name, definition) }
  register(collection, name, definition) {
    if (collection.has(name)) throw new KernelError('CONFLICT', `MCP capability already registered: ${name}`)
    collection.set(name, definition)
    this.changed()
    return () => { if (collection.get(name) === definition) { collection.delete(name); this.changed() } }
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  changed() { for (const listener of this.listeners) listener() }
}
