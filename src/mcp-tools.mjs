import { parameters } from './protocol.mjs'

// Operation bridge shared by capability plugins; definitions remain with their owners.
export function registerTools(ctx, definitions) {
  const registry = ctx.get('ivoraige.mcp')
  const operations = ctx.get('ivoraige.operations')
  for (const [name, [operation, description]] of Object.entries(definitions)) {
    ctx.effect(() => registry.registerTool(`ivoraige_${name}`, { description, inputSchema: parameters[operation],
      invoke: (input, context) => operations.invoke(operation, input, { signal: context.signal }) }))
  }
}
