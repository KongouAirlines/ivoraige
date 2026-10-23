import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import { KernelError } from './errors.mjs'
import { serialize, errorEnvelope } from './protocol.mjs'
import { Service } from '../dist/dsh.mjs'
import { resourcePolicy } from './resource-policy.mjs'

const id = '([^/]+)'
const routes = [
  ['GET', /^\/api\/components$/, 'componentStatus'],
  ['POST', /^\/api\/components\/catalog$/, 'componentCatalog'],
  ['POST', /^\/api\/components\/credential$/, 'componentCredential'],
  ['DELETE', /^\/api\/components\/credential$/, 'componentCredentialClear'],
  ['POST', /^\/api\/components\/install$/, 'componentInstall'],
  ['POST', /^\/api\/components\/local$/, 'componentLocal'],
  ['GET', new RegExp(`^/api/components/tasks/${id}$`), 'componentTask', ['taskId']],
  ['POST', new RegExp(`^/api/components/tasks/${id}/cancel$`), 'componentCancel', ['taskId']],
  ['POST', /^\/api\/documents\/import$/, 'importDocument'],
  ['GET', /^\/api\/documents$/, 'listDocuments'],
  ['GET', new RegExp(`^/api/documents/${id}$`), 'getDocument', ['docId']],
  ['GET', new RegExp(`^/api/documents/${id}/units$`), 'listUnits', ['docId']],
  ['POST', new RegExp(`^/api/documents/${id}/translate$`), 'translate', ['docId']],
  ['POST', new RegExp(`^/api/documents/${id}/export$`), 'exportDocument', ['docId']],
  ['GET', new RegExp(`^/api/documents/${id}/artifacts$`), 'listArtifacts', ['docId']],
  ['GET', new RegExp(`^/api/documents/${id}/artifact-cleanup$`), 'listArtifactCleanup', ['docId']],
  ['DELETE', new RegExp(`^/api/documents/${id}/artifacts/${id}$`), 'deleteArtifact', ['docId', 'artifactId']],
  ['GET', new RegExp(`^/api/documents/${id}/snapshots$`), 'listSnapshots', ['docId']],
  ['GET', new RegExp(`^/api/documents/${id}/snapshots/${id}$`), 'getSnapshot', ['docId', 'snapshotId']],
  ['DELETE', new RegExp(`^/api/documents/${id}/snapshots/${id}$`), 'deleteSnapshot', ['docId', 'snapshotId']],
  ['GET', new RegExp(`^/api/units/${id}$`), 'getUnit', ['unitId']],
  ['GET', new RegExp(`^/api/units/${id}/revisions$`), 'listRevisions', ['unitId']],
  ['PATCH', new RegExp(`^/api/units/${id}$`), 'writeRevision', ['unitId']],
  ['POST', new RegExp(`^/api/units/${id}/unaccept$`), 'unaccept', ['unitId']],
  ['POST', new RegExp(`^/api/revisions/${id}/accept$`), 'acceptRevision', ['revisionId']],
  ['GET', /^\/api\/tasks$/, 'listTasks'],
  ['GET', new RegExp(`^/api/tasks/${id}$`), 'getTask', ['taskId']],
  ['POST', new RegExp(`^/api/tasks/${id}/pause$`), 'pauseTask', ['taskId']],
  ['POST', new RegExp(`^/api/tasks/${id}/resume$`), 'resumeTask', ['taskId']],
  ['POST', new RegExp(`^/api/tasks/${id}/cancel$`), 'cancelTask', ['taskId']],
  ['POST', new RegExp(`^/api/tasks/${id}/abandon$`), 'abandonTask', ['taskId']],
  ['GET', /^\/api\/settings\/modelconfig$/, 'getSettings'],
  ['PATCH', /^\/api\/settings\/modelconfig$/, 'updateSettings'],
  ['PUT', /^\/api\/settings\/credentials$/, 'setCredential'],
  ['GET', /^\/api\/capabilities$/, 'capabilities'],
]

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }

function loopback(host) { return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host.toLowerCase()) }
function hostname(header) {
  if (!header) return ''
  try { return new URL(`http://${header}`).hostname.toLowerCase() } catch { return '' }
}
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(serialize(body))
}
async function readBody(req) {
  const limit = resourcePolicy.requestJsonBytes
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new KernelError('INVALID_ARGUMENT', 'Request body exceeds 10 MiB')
    chunks.push(chunk)
  }
  if (!size) return {}
  let value
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
    throw new KernelError('INVALID_ARGUMENT', 'Request body must be JSON')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new KernelError('INVALID_ARGUMENT', 'Request body must be a JSON object')
  return value
}
function queryParams(searchParams) {
  const query = Object.fromEntries(searchParams)
  if (query.limit !== undefined) {
    const limit = Number(query.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 500)
      throw new KernelError('INVALID_ARGUMENT', 'limit must be an integer from 1 to 500')
    query.limit = limit
  }
  return query
}

async function staticFile(res, staticDir, pathname) {
  if (!staticDir) throw new KernelError('NOT_FOUND', 'Route not found')
  let decoded
  try { decoded = decodeURIComponent(pathname) } catch { throw new KernelError('INVALID_ARGUMENT', 'Invalid URL encoding') }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..'))
    throw new KernelError('NOT_FOUND', 'Route not found')
  const root = await realpath(staticDir)
  const file = resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`)
  const rel = relative(root, file)
  if (rel.startsWith(`..${sep}`) || rel === '..' || rel.startsWith(sep))
    throw new KernelError('NOT_FOUND', 'Route not found')
  let resolved, info
  try { resolved = await realpath(file); info = await stat(resolved) } catch { throw new KernelError('NOT_FOUND', 'Route not found') }
  const realRel = relative(root, resolved)
  if (!info.isFile() || realRel.startsWith(`..${sep}`) || realRel === '..' || realRel.startsWith(sep))
    throw new KernelError('NOT_FOUND', 'Route not found')
  res.writeHead(200, { 'Content-Type': mime[extname(resolved)] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff' })
  createReadStream(resolved).once('error', () => res.destroy()).pipe(res)
}

function events(req, res, app, taskId, activeEvents) {
  if (app.ctx && !app.events) throw new KernelError('COMPONENT_MISSING', 'Event entry is not enabled')
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Event-Id': String(Date.now()) })
  res.write(': connected\n\n')
  const unsubscribe = app.operations.subscribe(event => {
    if (taskId && event?.data?.taskId !== taskId) return
    if (!/^[\w.]+$/.test(event?.type ?? '')) return
    res.write(`event: ${event.type}\ndata: ${serialize(event.data)}\n\n`)
  })
  activeEvents.add(res)
  const cleanup = () => { unsubscribe?.(); activeEvents.delete(res) }
  req.once('close', cleanup)
  res.once('close', cleanup)
}

function stateEvents(req, res, app, scope, activeEvents) {
  if (!app.events) throw new KernelError('COMPONENT_MISSING', 'State event entry is not enabled')
  const session = app.events.subscribe(scope)
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' })
  const sendEvent = (type, data) => {
    try {
      if (!res.write(`event: ${type}\ndata: ${serialize(data)}\n\n`)) res.destroy()
    } catch { res.destroy() }
  }
  const unsubscribe = session.onNotice(notice => sendEvent(notice.type, notice))
  activeEvents.add(res)
  const cleanup = () => { unsubscribe(); session.close(); activeEvents.delete(res) }
  req.once('close', cleanup)
  res.once('close', cleanup)
  sendEvent('state.ready', session.ready)
}

async function listenHttp(app, { host = '127.0.0.1', port = 8787, staticDir, allowedHosts = [], instance, mcp = true } = {}) {
  if (!loopback(host)) throw new KernelError('INVALID_ARGUMENT',
    'Non-loopback listening requires DSH token authentication, which is not configured')
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new KernelError('INVALID_ARGUMENT', 'port must be an integer from 0 to 65535')
  const mcpEndpoint = mcp && app.mcp ? (await import('./mcp.mjs')).createMcpHttp(app) : undefined
  const activeEvents = new Set()
  const controllers = new Set(), requests = new Set()
  let closing = false
  const server = createServer((req, res) => {
    const controller = new AbortController()
    const abort = () => controller.abort()
    controllers.add(controller)
    req.once('aborted', abort)
    res.once('close', abort)
    const pending = handle(req, res, controller.signal).finally(() => {
      controllers.delete(controller); requests.delete(pending)
      req.off('aborted', abort); res.off('close', abort)
    })
    requests.add(pending)
    pending.catch(() => res.destroy())
  })
  async function handle(req, res, signal) {
    try {
      if (closing) throw new KernelError('COMPONENT_MISSING', 'HTTP entry is closing')
      const incomingHost = hostname(req.headers.host)
      if (!loopback(incomingHost) && !allowedHosts.includes(incomingHost))
        throw new KernelError('FORBIDDEN_HOST', 'Host is not allowed')
      if (req.headers.origin) {
        let origin
        try { origin = new URL(req.headers.origin) } catch { throw new KernelError('FORBIDDEN_HOST', 'Origin is not allowed') }
        if (origin.host.toLowerCase() !== String(req.headers.host).toLowerCase() ||
            !['http:', 'https:'].includes(origin.protocol))
          throw new KernelError('FORBIDDEN_HOST', 'Origin is not allowed')
      }
      const url = new URL(req.url, `http://${req.headers.host}`)
      const pathname = url.pathname
      if (pathname === '/mcp' && mcpEndpoint) { await mcpEndpoint.handle(req, res); return }
      if (req.method === 'GET' && pathname === '/api/instance' && instance) {
        send(res, 200, instance); return
      }
      if (req.method === 'GET' && pathname === '/api/events/state') {
        stateEvents(req, res, app, Object.fromEntries(url.searchParams), activeEvents); return
      }
      if (req.method === 'GET' && pathname === '/api/state') {
        if (!app.events) throw new KernelError('COMPONENT_MISSING', 'State event entry is not enabled')
        const session = app.events.getSession(url.searchParams.get('subscriptionId'))
        const snapshot = session.snapshot()
        session.acknowledge(snapshot.stateRevision)
        send(res, 200, { apiVersion: '2.0', ...snapshot }); return
      }
      if (req.method === 'GET' && pathname === '/api/operations') {
        if (!app.operationCatalog) throw new KernelError('COMPONENT_MISSING', 'Operation discovery is not enabled')
        send(res, 200, { apiVersion: '2.0', operations: app.operationCatalog.list().map(({ id, requires, longRunning, cancellable }) =>
          ({ id, requires, longRunning, cancellable, available: requires.every(service => Boolean(app.ctx?.get(service))) })) }); return
      }
      const dynamicOperation = /^\/api\/operations\/([^/]+)$/.exec(pathname)
      if (req.method === 'POST' && dynamicOperation) {
        send(res, 200, await app.operations.invoke(decodeURIComponent(dynamicOperation[1]), await readBody(req), { signal })); return
      }
      if (req.method === 'GET' && (pathname === '/api/events' || /^\/api\/tasks\/[^/]+\/events$/.test(pathname))) {
        events(req, res, app, pathname === '/api/events' ? undefined : decodeURIComponent(pathname.split('/')[3]), activeEvents); return
      }
      const download = req.method === 'GET' && /^\/api\/artifacts\/[^/]+\/download$/.exec(pathname)
      if (download) {
        const artifactId = decodeURIComponent(pathname.split('/')[3])
        if (app.resources) {
          let resource, stream, disconnected = false
          const finish = () => { if (resource) void resource.close().catch(error => res.destroy(error)) }
          const disconnect = () => { disconnected = true; stream?.destroy(); finish() }
          res.once('close', disconnect)
          try {
            resource = await app.resources.openArtifact(artifactId, { signal })
            if (disconnected || res.destroyed || signal.aborted) { await resource.close(); return }
            stream = resource.file.createReadStream({ autoClose: false })
            stream.once('end', finish)
            stream.once('error', error => { finish(); res.destroy(error) })
            res.writeHead(200, { 'Content-Type': resource.contentType,
              'Content-Length': resource.size, 'Content-Disposition': `attachment; filename="${String(resource.filename).replace(/["\r\n]/g, '_')}"`,
              'X-Content-Type-Options': 'nosniff' })
            stream.pipe(res)
          } catch (error) { await resource?.close(); throw error }
          return
        }
        let artifact, stream, closed = false, released = false
        const release = () => {
          if (!artifact || released) return
          released = true
          artifact.release?.()
        }
        res.once('close', () => { closed = true; stream?.destroy(); release() })
        try {
          artifact = await app.operations.artifact(artifactId, { retain: true })
          if (closed || res.destroyed) { release(); return }
          if (!artifact?.path) throw new KernelError('NOT_FOUND', 'Artifact not found')
          let info
          try { info = await stat(artifact.path) } catch (error) {
            if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw new KernelError('NOT_FOUND', 'Artifact not found')
            throw error
          }
          if (closed || res.destroyed) { release(); return }
          if (!info.isFile()) throw new KernelError('NOT_FOUND', 'Artifact not found')
          stream = createReadStream(artifact.path)
          let streamError
          stream.once('close', release)
          stream.on('error', error => { streamError = error; if (!closed && res.headersSent) res.destroy(error) })
          const opened = await new Promise((resolveOpen, rejectOpen) => {
            const onOpen = () => { stream.off('error', onError); stream.off('close', onClose); resolveOpen(true) }
            const onError = error => { stream.off('open', onOpen); stream.off('close', onClose); rejectOpen(error) }
            const onClose = () => { stream.off('open', onOpen); stream.off('error', onError); resolveOpen(false) }
            stream.once('open', onOpen)
            stream.once('error', onError)
            stream.once('close', onClose)
          }).catch(error => {
            if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw new KernelError('NOT_FOUND', 'Artifact not found')
            throw error
          })
          if (closed || res.destroyed || !opened) { stream.destroy(); release(); return }
          if (streamError) throw streamError
          res.writeHead(200, { 'Content-Type': artifact.contentType ?? 'application/octet-stream',
            'Content-Length': info.size, 'Content-Disposition': `attachment; filename="${String(artifact.filename ?? artifactId).replace(/["\r\n]/g, '_')}"`,
            'X-Content-Type-Options': 'nosniff' })
          stream.pipe(res)
        } catch (error) { stream?.destroy(); release(); throw error }
        return
      }
      for (const [method, pattern, operation, keys = []] of routes) {
        const match = method === req.method && pattern.exec(pathname)
        if (!match) continue
        const ids = Object.fromEntries(keys.map((key, index) => [key, decodeURIComponent(match[index + 1])]))
        const body = ['POST', 'PATCH', 'PUT'].includes(method) ? await readBody(req) : {}
        const result = await app.operations.invoke(operation, { ...queryParams(url.searchParams), ...body, ...ids }, { signal })
        send(res, 200, result)
        return
      }
      if (pathname.startsWith('/api/')) throw new KernelError('NOT_FOUND', 'Route not found')
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new KernelError('NOT_FOUND', 'Route not found')
      await staticFile(res, staticDir, pathname)
    } catch (error) {
      if (res.headersSent) { res.destroy(); return }
      const result = errorEnvelope(error)
      send(res, result.status, result.body)
    }
  }
  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(port, host, resolveListen)
    })
  } catch (error) {
    try { await mcpEndpoint?.close() } catch (cleanupError) { console.error('MCP cleanup failed:', cleanupError) }
    throw error
  }
  const address = server.address()
  let closePromise
  const entry = { url: `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`,
    close: () => {
      if (closePromise) return closePromise
      closing = true
      closePromise = (async () => {
      let failure
      const stopped = new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()))
      for (const controller of controllers) controller.abort()
      try { await mcpEndpoint?.close() } catch (error) { failure = error }
      for (const response of activeEvents) {
        try { response.end() } catch (error) { failure ??= error }
      }
      server.closeAllConnections()
      try { await stopped }
      catch (error) { failure ??= error }
      // The operation catalog drains request handlers before storage withdrawal.
      if (failure) throw failure
      })()
      return closePromise
    } }
  return entry
}

export class HttpEntry extends Service {
  static inject = ['ivoraige.operations', 'ivoraige.capabilities']
  constructor(ctx) {
    super(ctx, 'ivoraige.httpEntry')
    this.handles = new Set()
    this.closing = false
    ctx.effect(() => () => this.close())
  }
  async listen(app, options) {
    if (this.closing) throw new KernelError('COMPONENT_MISSING', 'HTTP entry is closed')
    const handle = await listenHttp(app, options)
    if (this.closing) { await handle.close(); throw new KernelError('COMPONENT_MISSING', 'HTTP entry is closed') }
    this.handles.add(handle)
    return { url: handle.url, close: async () => { await handle.close(); this.handles.delete(handle) } }
  }
  async close() {
    this.closing = true
    await Promise.all([...this.handles].map(async handle => { await handle.close(); this.handles.delete(handle) }))
  }
}

export async function serve(app, options) {
  if (!app.ctx) return listenHttp(app, options) // Compatibility for a caller-owned facade.
  const entry = app.ctx.get('ivoraige.httpEntry')
  if (!entry) throw new KernelError('COMPONENT_MISSING', 'HTTP entry is not enabled')
  return entry.listen(app, options)
}
