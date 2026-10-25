import { McpServer, ResourceTemplate, ProtocolError, createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { KernelError } from './errors.mjs'
import { errorEnvelope } from './protocol.mjs'
import packageInfo from '../package.json' with { type: 'json' }
import { resourcePolicy } from './resource-policy.mjs'
import { AsyncLocalStorage } from 'node:async_hooks'

function result(body, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body, ...(isError ? { isError } : {}) }
}

function resourceError(error) {
  const { body } = errorEnvelope(error)
  const code = body.error.code === 'NOT_FOUND' ? -32002
    : body.error.code === 'INVALID_ARGUMENT' ? -32602 : -32603
  return new ProtocolError(code, body.error.message, body)
}

export function createMcpServer(app, { signal, listChanged = true, watchRegistry = true } = {}) {
  const registry = app.mcp
  if (!registry) throw new KernelError('COMPONENT_MISSING', 'MCP entry is not enabled')
  const server = new McpServer({ name: 'ivoraige', version: packageInfo.version },
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
  // Keep SDK discovery/transport ownership, but dispatch operation arguments
  // through the kernel's single validator. SDK's default tool validator would
  // otherwise replace INVALID_ARGUMENT with an unstructured SDK error string.
  server.server.setRequestHandler('tools/call', async (request, context) => {
    try {
      const definition = registry.tools.get(request.params.name)
      if (!definition) throw new KernelError('NOT_FOUND', 'MCP tool not found')
      const requestSignal = context.mcpReq?.signal
      const invocationSignal = signal && requestSignal ? AbortSignal.any([signal, requestSignal]) : signal ?? requestSignal
      return result(await definition.invoke(request.params.arguments ?? {}, { signal: invocationSignal }))
    } catch (error) { return result(errorEnvelope(error).body, true) }
  })
  const unsubscribe = watchRegistry ? registry.subscribe(refresh) : () => {}
  let release
  server.server.onclose = () => { unsubscribe(); release?.() }
  const entry = app.ctx?.get('ivoraige.mcpEntry')
  if (app.ctx && !entry) { unsubscribe(); throw new KernelError('COMPONENT_MISSING', 'MCP entry is not enabled') }
  release = entry?.own(() => server.close())
  return server
}

export function createMcpHttp(app) {
  if (!app.mcp) throw new KernelError('COMPONENT_MISSING', 'MCP entry is not enabled')
  const requestLifetime = new AsyncLocalStorage()
  const requests = new Set()
  const handler = createMcpHandler(({ requestInfo, era }) => createMcpServer(app,
    { signal: requestLifetime.getStore() ?? requestInfo?.signal,
      listChanged: era !== 'legacy', watchRegistry: false }), { maxRequestBodySize: resourcePolicy.requestJsonBytes })
  // HTTP server instances last one request; discovery subscriptions outlive them.
  const unsubscribe = app.mcp.subscribe(kind => {
    if (kind === 'tools') handler.notify.toolsChanged()
    else if (kind === 'resources') handler.notify.resourcesChanged()
  })
  const handleNode = toNodeHandler(handler, { maxRequestBodySize: resourcePolicy.requestJsonBytes })
  let closePromise, release
  const endpoint = { handle: async (req, res, parsedBody) => {
      // Keep the raw Node lifetime independent of Request.clone abort forwarding.
      // The legacy SDK leg clones Requests, whose controller can be collected.
      const controller = new AbortController()
      const abort = () => controller.abort()
      requests.add(controller)
      req.once('aborted', abort)
      res.once('close', abort)
      if (req.aborted || res.destroyed || closePromise) abort()
      try { return await requestLifetime.run(controller.signal, () => handleNode(req, res, parsedBody)) }
      finally {
        req.off('aborted', abort); res.off('close', abort)
        requests.delete(controller)
      }
    },
    close: () => {
      if (closePromise) return closePromise
      closePromise = (async () => {
      let failure
      for (const controller of requests) controller.abort()
      try { unsubscribe() } catch (error) { failure = error }
      try { await handler.close() } catch (error) { failure ??= error }
      release?.()
      if (failure) throw failure
      })()
      return closePromise
    } }
  const entry = app.ctx?.get('ivoraige.mcpEntry')
  if (app.ctx && !entry) { unsubscribe(); void handler.close(); throw new KernelError('COMPONENT_MISSING', 'MCP entry is not enabled') }
  release = entry?.own(endpoint.close)
  return endpoint
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
    await stopped
  }
  finally {
    stdin.off('end', stop); stdin.off('close', stop)
    process.off('SIGINT', stop); process.off('SIGTERM', stop)
    await handle.close()
  }
}
