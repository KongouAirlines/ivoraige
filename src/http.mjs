import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import { KernelError } from './errors.mjs'
import { serialize, errorEnvelope } from './protocol.mjs'

const id = '([A-Za-z0-9_.-]+)'
const routes = [
  ['GET', /^\/api\/components$/, 'componentStatus'],
  ['POST', /^\/api\/components\/catalog$/, 'componentCatalog'],
  ['POST', /^\/api\/components\/credential$/, 'componentCredential'],
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
  const limit = 10 * 1024 * 1024
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

export async function serve(app, { host = '127.0.0.1', port = 8787, staticDir, allowedHosts = [], instance, mcp = true } = {}) {
  if (!loopback(host)) throw new KernelError('INVALID_ARGUMENT',
    'Non-loopback listening requires DSH token authentication, which is not configured')
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new KernelError('INVALID_ARGUMENT', 'port must be an integer from 0 to 65535')
  const mcpEndpoint = mcp && app.mcp ? (await import('./mcp.mjs')).createMcpHttp(app) : undefined
  const activeEvents = new Set()
  const server = createServer(async (req, res) => {
    try {
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
      if (req.method === 'GET' && (pathname === '/api/events' || /^\/api\/tasks\/[A-Za-z0-9_.-]+\/events$/.test(pathname))) {
        events(req, res, app, pathname === '/api/events' ? undefined : pathname.split('/')[3], activeEvents); return
      }
      const download = req.method === 'GET' && /^\/api\/artifacts\/[A-Za-z0-9_.-]+\/download$/.exec(pathname)
      if (download) {
        const artifactId = pathname.split('/')[3]
        const artifact = await app.operations.artifact(artifactId)
        if (!artifact?.path) throw new KernelError('NOT_FOUND', 'Artifact not found')
        let info
        try { info = await stat(artifact.path) } catch (error) {
          if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw new KernelError('NOT_FOUND', 'Artifact not found')
          throw error
        }
        if (!info.isFile()) throw new KernelError('NOT_FOUND', 'Artifact not found')
        const stream = createReadStream(artifact.path)
        await new Promise((resolveOpen, rejectOpen) => {
          const onOpen = () => { stream.off('error', onError); resolveOpen() }
          const onError = error => { stream.off('open', onOpen); rejectOpen(error) }
          stream.once('open', onOpen)
          stream.once('error', onError)
        }).catch(error => {
          if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw new KernelError('NOT_FOUND', 'Artifact not found')
          throw error
        })
        stream.on('error', error => res.destroy(error))
        res.writeHead(200, { 'Content-Type': artifact.contentType ?? 'application/octet-stream',
          'Content-Length': info.size, 'Content-Disposition': `attachment; filename="${String(artifact.filename ?? artifactId).replace(/["\r\n]/g, '_')}"`,
          'X-Content-Type-Options': 'nosniff' })
        stream.pipe(res)
        return
      }
      for (const [method, pattern, operation, keys = []] of routes) {
        const match = method === req.method && pattern.exec(pathname)
        if (!match) continue
        const ids = Object.fromEntries(keys.map((key, index) => [key, match[index + 1]]))
        const body = ['POST', 'PATCH', 'PUT'].includes(method) ? await readBody(req) : {}
        const result = await app.operations.invoke(operation, { ...queryParams(url.searchParams), ...body, ...ids })
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
  })
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(port, host, resolveListen)
  })
  const address = server.address()
  return { url: `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`,
    close: async () => {
      await mcpEndpoint?.close()
      for (const response of activeEvents) response.end()
      return new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()))
    } }
}
