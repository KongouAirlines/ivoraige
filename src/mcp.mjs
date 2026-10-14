import { McpServer, ResourceTemplate, ProtocolError, createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { KernelError } from './errors.mjs'
import { errorEnvelope } from './protocol.mjs'

function result(body, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body, ...(isError ? { isError } : {}) }
}

function resourceError(error) {
  const { body } = errorEnvelope(error)
  return new ProtocolError(body.error.code === 'NOT_FOUND' ? -32002 : -32603, body.error.message, body)
}

export function createMcpServer(app, { signal, listChanged = true, watchRegistry = true } = {}) {
  const registry = app.mcp
  if (!registry) throw new KernelError('COMPONENT_MISSING', 'MCP entry is not enabled')
  const server = new McpServer({ name: 'ivoraige', version: '0.1.0-dev.0' },
    { capabilities: { tools: { listChanged }, resources: { listChanged } } })
  const activeTools = new Map(), activeResources = new Map()
  function sync(collection, active, register) {
    for (const [name, item] of active) if (collection.get(name) !== item.definition) {
      item.registration.remove(); active.delete(name)
    }
    for (const [name, definition] of collection) if (!active.has(name)) {
      active.set(name, { definition, registration: register(name, definition) })
    }
  }
  const refresh = () => {
    sync(registry.tools, activeTools, (name, definition) => server.registerTool(name,
      { description: definition.description, inputSchema: definition.inputSchema, annotations: definition.annotations },
      async (input, context) => {
        try { return result(await definition.invoke(input, { signal: signal ? AbortSignal.any([signal, context.mcpReq.signal]) : context.mcpReq.signal })) }
        catch (error) { return result(errorEnvelope(error).body, true) }
      }))
    sync(registry.resources, activeResources, (name, definition) => server.registerResource(name,
      new ResourceTemplate(definition.template, { list: undefined }), definition.metadata ?? {}, async (uri, variables) => {
        try { return await definition.read(uri, variables) }
        catch (error) { throw resourceError(error) }
      }))
  }
  refresh()
  if (watchRegistry) server.server.onclose = registry.subscribe(refresh)
  return server
}

export function createMcpHttp(app) {
  const handler = createMcpHandler(({ requestInfo, era }) => createMcpServer(app,
    { signal: requestInfo?.signal, listChanged: era !== 'legacy', watchRegistry: false }), { maxRequestBodySize: 10 * 1024 * 1024 })
  // HTTP server instances last one request; discovery subscriptions outlive them.
  const unsubscribe = app.mcp.subscribe(kind => {
    if (kind === 'tools') handler.notify.toolsChanged()
    else if (kind === 'resources') handler.notify.resourcesChanged()
  })
  return { handle: toNodeHandler(handler, { maxRequestBodySize: 10 * 1024 * 1024 }),
    close: () => { unsubscribe(); return handler.close() } }
}

export async function runMcpStdio(app, { stdin = process.stdin, stdout = process.stdout } = {}) {
  let stop
  const stopped = new Promise(resolve => { stop = resolve })
  const transport = new StdioServerTransport(stdin, stdout)
  const handle = serveStdio(() => createMcpServer(app), { transport, onerror: error => console.error('MCP stdio error:', error) })
  const onclose = transport.onclose
  transport.onclose = () => { try { onclose?.() } finally { stop() } }
  stdin.once('end', stop)
  stdin.once('close', stop)
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    const error = await stopped
    if (error instanceof Error) throw error
  }
  finally {
    stdin.off('end', stop); stdin.off('close', stop)
    process.off('SIGINT', stop); process.off('SIGTERM', stop)
    await handle.close()
  }
}
