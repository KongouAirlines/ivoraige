import { parameters } from './protocol.mjs'
const tools = {
  component_status: ['componentStatus', 'Read optional component installation status.'],
  component_catalog: ['componentCatalog', 'Query the configured release catalog using saved credentials.'],
  component_credential: ['componentCredential', 'Save a user-authorized private repository token through DSH.'],
  component_install: ['componentInstall', 'Download and install the official PDF component; requires explicit user intent. Restart after success.'],
  component_local: ['componentLocal', 'Install the official PDF component from a local manifest path; requires explicit user intent.'],
  component_task: ['componentTask', 'Read a component installation task (separate from document tasks).'],
  component_cancel: ['componentCancel', 'Cancel a component installation task.'],
}

function registerTools(ctx, definitions) {
  const registry = ctx.get('ivoraige.mcp')
  const operations = ctx.get('ivoraige.operations')
  for (const [name, [operation, description]] of Object.entries(definitions)) {
    ctx.effect(() => registry.registerTool(`ivoraige_${name}`, { description, inputSchema: parameters[operation],
      invoke: (input, context) => operations.invoke(operation, input, { signal: context.signal }) }))
  }
}

export const inject = ['ivoraige.mcp', 'ivoraige.operations', 'ivoraige.components']
export function apply(ctx) { registerTools(ctx, tools) }
