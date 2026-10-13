import { parameters } from './protocol.mjs'
const tools = {
  settings_get: ['getSettings', 'Read model configuration and credential status, without credential values.'],
  settings_update: ['updateSettings', 'Update model settings with existing optimistic lock fields.'],
  credential_set: ['setCredential', 'Store a named model credential through DSH; only supply a user-authorized credential.'],
}

function registerTools(ctx, definitions) {
  const registry = ctx.get('ivoraige.mcp')
  const operations = ctx.get('ivoraige.operations')
  for (const [name, [operation, description]] of Object.entries(definitions)) {
    ctx.effect(() => registry.registerTool(`ivoraige_${name}`, { description, inputSchema: parameters[operation],
      invoke: (input, context) => operations.invoke(operation, input, { signal: context.signal }) }))
  }
}

export const inject = ['ivoraige.mcp', 'ivoraige.operations', 'ivoraige.modelSettings']
export function apply(ctx) { registerTools(ctx, tools) }
