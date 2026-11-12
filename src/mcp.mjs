import { z } from 'zod'
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

function enabledRegistry(app) {
  const entry = app.ctx?.get('ivoraige.mcpEntry')
  if (app.ctx && (!entry || entry.closing) || !app.mcp)
    throw new KernelError('COMPONENT_MISSING', 'MCP entry is not enabled or is closing')
  return app.mcp
}

export async function ownerMcp(app, method, input = {}, { signal } = {}) {
  const registry = enabledRegistry(app)
  if (method === 'mcp.describe') return {
    tools: [...registry.tools].map(([name, definition]) => ({ name,
      description: definition.description,
      inputSchema: definition.inputSchema ? z.toJSONSchema(definition.inputSchema, { target: 'draft-7' }) :
        { type: 'object', properties: {} },
      ...(definition.annotations ? { annotations: definition.annotations } : {}) })),
    resources: [...registry.resources].map(([name, definition]) => ({ name,
      template: definition.template, ...(definition.metadata ? { metadata: definition.metadata } : {}) })),
  }
  if (method === 'mcp.call') {
    const tool = registry.tools.get(input.name)
    if (!tool) throw new KernelError('NOT_FOUND', 'MCP tool not found')
    return tool.invoke(input.input, { signal })
  }
  if (method === 'mcp.read') {
    const resource = registry.resources.get(input.name)
    if (!resource) throw new KernelError('NOT_FOUND', 'MCP resource not found')
    const variables = new ResourceTemplate(resource.template, { list: undefined }).uriTemplate.match(input.uri)
    if (!variables) throw new KernelError('INVALID_ARGUMENT', 'MCP resource URI mismatch')
    return resource.read(new URL(input.uri), variables, { signal })
  }
  throw new KernelError('INVALID_ARGUMENT', 'Unknown MCP owner request')
}

export function createMcpServer(app, { signal, listChanged = true, watchRegistry = true } = {}) {
  const registry = enabledRegistry(app)
  const entry = app.ctx?.get('ivoraige.mcpEntry')
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
      new ResourceTemplate(definition.template, { list: undefined }), definition.metadata ?? {}, async (uri, variables, context) => {
        try { return await definition.read(uri, variables,
          { signal: signal ? AbortSignal.any([signal, context.mcpReq.signal]) : context.mcpReq.signal }) }
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
  release = entry?.own(() => server.close())
  return server
}

export function createMcpHttp(app) {
  const entry = app.ctx?.get('ivoraige.mcpEntry')
  if (app.ctx && (!entry || entry.closing))
    throw new KernelError('COMPONENT_MISSING', 'MCP entry is not enabled or is closing')
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

// The stdio process is only a protocol bridge. It never creates a Context or
// opens a store: every discovery, invocation and resource read goes through
// the already authenticated local owner connection.
export async function runMcpOwnerStdio(client, { stdin = process.stdin, stdout = process.stdout } = {}) {
  const controller = new AbortController()
  const invocationSignal = context => context?.mcpReq?.signal
    ? AbortSignal.any([controller.signal, context.mcpReq.signal]) : controller.signal
  const initial = await client.request('mcp.describe')
  if (!initial || !Array.isArray(initial.tools) || !Array.isArray(initial.resources))
    throw new KernelError('UPSTREAM_FAILURE', 'Owner MCP discovery is unavailable')
  const server = new McpServer({ name: 'ivoraige', version: packageInfo.version },
    { capabilities: { tools: { listChanged: false }, resources: { listChanged: false } } })
  const resources = new Map()
  const syncResources = descriptions => {
    for (const definition of descriptions) {
      if (resources.has(definition.name)) continue
      resources.set(definition.name, server.registerResource(definition.name,
        new ResourceTemplate(definition.template, { list: undefined }), definition.metadata ?? {},
        async (uri, variables, context) => {
          try { return await client.request('mcp.read', { name: definition.name, uri: uri.href, variables },
            { signal: invocationSignal(context) }) }
          catch (error) { throw resourceError(error) }
        }))
    }
  }
  syncResources(initial.resources)
  server.server.setRequestHandler('tools/list', async (request, context) => {
    const description = await client.request('mcp.describe', {}, { signal: invocationSignal(context) })
    syncResources(description.resources)
    return { tools: description.tools }
  })
  server.server.setRequestHandler('tools/call', async (request, context) => {
    try { return result(await client.request('mcp.call', {
      name: request.params.name, input: request.params.arguments ?? {} }, { signal: invocationSignal(context) })) }
    catch (error) { return result(errorEnvelope(error).body, true) }
  })
  let stop
  const stopped = new Promise(resolve => { stop = () => { controller.abort(); resolve() } })
  const transport = new StdioServerTransport(stdin, stdout)
  const handle = serveStdio(() => server, { transport, onerror: error => console.error('MCP stdio error:', error) })
  const onclose = transport.onclose
  transport.onclose = () => { try { onclose?.() } finally { stop() } }
  stdin.once('end', stop)
  stdin.once('close', stop)
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try { await stopped }
  finally {
    controller.abort()
    stdin.off('end', stop); stdin.off('close', stop)
    process.off('SIGINT', stop); process.off('SIGTERM', stop)
    await handle.close()
  }
}
