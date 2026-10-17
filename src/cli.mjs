#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { defaultDataDirectory } from './data-directory.mjs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { createApp } from './app.mjs'
import { serve } from './http.mjs'
import { serialize, errorEnvelope } from './protocol.mjs'
import { KernelError } from './errors.mjs'

const usage = `ivoraige [--url URL | --store FILE] [--pdf-config FILE] [--json] COMMAND [arguments] [options]
Commands: import, documents, units, unit, revisions, edit, accept, unaccept,
  translate, export, snapshots, artifacts, tasks, task, pause, resume, cancel,
  settings, capabilities, components, serve, mcp, help
MCP: mcp --stdio [--store FILE]; serve exposes /mcp unless --no-mcp
Components: status, catalog, credential --token-env NAME, install, local --path MANIFEST, task ID, cancel ID
Common options: --target-lang LANG, --json, --json-events, --no-wait, --url URL, --store FILE, --pdf-config FILE
`

function parse(argv) {
  const positional = [], options = {}
  const boolean = new Set(['json', 'json-events', 'help', 'no-wait', 'stdio', 'no-mcp'])
  const known = new Set([...boolean, 'url', 'store', 'export-dir', 'settings-dir', 'pdf-config', 'host', 'port', 'static-dir',
    'path', 'format', 'source-id', 'external-ref', 'source-lang', 'title', 'target-lang', 'cursor',
    'limit', 'origin', 'filter', 'text', 'base-revision', 'expected-accepted', 'mode',
    'units', 'out', 'snapshot', 'on-missing-accepted', 'state', 'kind', 'set', 'ref', 'value', 'token-env'])
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) { positional.push(token); continue }
    const name = token.slice(2)
    if (!known.has(name)) throw new KernelError('INVALID_ARGUMENT', `Unknown option --${name}`)
    if (boolean.has(name)) { options[name] = true; continue }
    if (!argv[i + 1] || argv[i + 1].startsWith('--'))
      throw new KernelError('INVALID_ARGUMENT', `Missing value for --${name}`)
    options[name] = argv[++i]
  }
  return { positional, options }
}
function required(value, label) {
  if (!value) throw new KernelError('INVALID_ARGUMENT', `Missing ${label}`)
  return value
}
function route(command, args, o) {
  const docId = args[0], unitId = args[0], taskId = args[0]
  const targetLang = o['target-lang']
  const paging = { cursor: o.cursor, limit: o.limit === undefined ? undefined : Number(o.limit) }
  switch (command) {
    case 'components': {
      switch (args[0] ?? 'status') {
        case 'status': return ['componentStatus', {}, 'GET', '/api/components']
        case 'catalog': return ['componentCatalog', {}, 'POST', '/api/components/catalog']
        case 'credential': return ['componentCredential', {
          token: required(process.env[required(o['token-env'], '--token-env')], 'token environment variable') },
          'POST', '/api/components/credential']
        case 'credential-clear': return ['componentCredentialClear', {}, 'DELETE', '/api/components/credential']
        case 'install': return ['componentInstall', { id: 'babeldoc' }, 'POST', '/api/components/install']
        case 'local': return ['componentLocal', { path: required(o.path, '--path manifest') }, 'POST', '/api/components/local']
        case 'task': return ['componentTask', { taskId: required(args[1], 'component task ID') }, 'GET', `/api/components/tasks/${args[1]}`]
        case 'cancel': return ['componentCancel', { taskId: required(args[1], 'component task ID') }, 'POST', `/api/components/tasks/${args[1]}/cancel`]
        default: throw new KernelError('INVALID_ARGUMENT', 'Unknown components command')
      }
    }
    case 'import': return ['importDocument', { path: o.path ?? required(args[0], 'file path'),
      format: o.format, sourceId: o['source-id'], externalRef: o['external-ref'],
      language: required(o['source-lang'], '--source-lang'), title: o.title, origin: 'cli' }, 'POST', '/api/documents/import']
    case 'documents': return args[0] ? ['getDocument', { docId }, 'GET', `/api/documents/${docId}`] :
      ['listDocuments', { ...paging, origin: o.origin, format: o.format }, 'GET', '/api/documents']
    case 'units': return ['listUnits', { docId: required(docId, 'document ID'), targetLang: required(targetLang, '--target-lang'),
      filter: o.filter, ...paging }, 'GET', `/api/documents/${docId}/units`]
    case 'unit': return ['getUnit', { unitId: required(unitId, 'unit ID'), targetLang: required(targetLang, '--target-lang') },
      'GET', `/api/units/${unitId}`]
    case 'revisions': return ['listRevisions', { unitId: required(unitId, 'unit ID'), targetLang: required(targetLang, '--target-lang'), ...paging },
      'GET', `/api/units/${unitId}/revisions`]
    case 'edit': return ['writeRevision', { unitId: required(unitId, 'unit ID'), targetLang: required(targetLang, '--target-lang'),
      text: required(o.text, '--text'), baseRevisionId: o['base-revision'] ?? null }, 'PATCH', `/api/units/${unitId}`]
    case 'accept': return ['acceptRevision', { revisionId: required(args[0], 'revision ID'),
      expectedAcceptedRevisionId: o['expected-accepted'] ?? null }, 'POST', `/api/revisions/${args[0]}/accept`]
    case 'unaccept': return ['unaccept', { unitId: required(unitId, 'unit ID'), targetLang: required(targetLang, '--target-lang'),
      expectedAcceptedRevisionId: o['expected-accepted'] ?? null }, 'POST', `/api/units/${unitId}/unaccept`]
    case 'translate': return ['translate', { docId: required(docId, 'document ID'), targetLang: required(targetLang, '--target-lang'),
      mode: o.mode, unitIds: o.units?.split(',') }, 'POST', `/api/documents/${docId}/translate`]
    case 'export': {
      const formats = required(o.format, '--format').split(',')
      if (o.out && formats.length !== 1)
        throw new KernelError('INVALID_ARGUMENT', '--out requires exactly one --format')
      return ['exportDocument', { docId: required(docId, 'document ID'), targetLang: required(targetLang, '--target-lang'),
      outputs: formats.map(format => ({ format, ...(o.out ? { out: o.out } : {}) })),
      snapshotId: o.snapshot, onMissingAccepted: o['on-missing-accepted'] }, 'POST', `/api/documents/${docId}/export`]
    }
    case 'snapshots': return args[1] === 'delete' ? ['deleteSnapshot',
      { docId: required(docId, 'document ID'), snapshotId: required(args[2], 'snapshot ID') },
      'DELETE', `/api/documents/${docId}/snapshots/${args[2]}`] : args[1] ? ['getSnapshot', { docId: required(docId, 'document ID'), snapshotId: args[1] },
      'GET', `/api/documents/${docId}/snapshots/${args[1]}`] :
      ['listSnapshots', { docId: required(docId, 'document ID'), targetLang, ...paging }, 'GET', `/api/documents/${docId}/snapshots`]
    case 'artifacts': return ['listArtifacts', { docId: required(docId, 'document ID'), ...paging }, 'GET', `/api/documents/${docId}/artifacts`]
    case 'tasks': return ['listTasks', { ...paging, state: o.state, kind: o.kind }, 'GET', '/api/tasks']
    case 'task': return ['getTask', { taskId: required(taskId, 'task ID') }, 'GET', `/api/tasks/${taskId}`]
    case 'pause': case 'resume': case 'cancel': return [`${command}Task`, { taskId: required(taskId, 'task ID') },
      'POST', `/api/tasks/${taskId}/${command}`]
    case 'settings': return args[0] === 'credential' ? ['setCredential',
      { ref: required(o.ref, '--ref'), value: required(o.value, '--value') }, 'PUT', '/api/settings/credentials'] :
      o.set ? ['updateSettings', JSON.parse(o.set), 'PATCH', '/api/settings/modelconfig'] :
      ['getSettings', {}, 'GET', '/api/settings/modelconfig']
    case 'capabilities': return ['capabilities', {}, 'GET', '/api/capabilities']
    default: throw new KernelError('INVALID_ARGUMENT', `Unknown command: ${command}`)
  }
}
function clean(value) { return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) }
function storePath(options) {
  if (options.store ?? process.env.IVORAIGE_STORE) return options.store ?? process.env.IVORAIGE_STORE
  return join(defaultDataDirectory(), 'store.sqlite')
}
// Relative filesystem paths in the optional PDF config are based on the config file.
// Bare command names (for example "python") remain available through PATH.
export async function readPdfConfig(path) {
  if (!path) return undefined
  let config
  try { config = JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { throw new KernelError('INVALID_ARGUMENT', `Cannot read PDF config: ${error.message}`) }
  if (!config || Array.isArray(config) || typeof config !== 'object' ||
      typeof config.command !== 'string' || !config.command.trim() ||
      (config.args !== undefined && (!Array.isArray(config.args) || !config.args.every(value => typeof value === 'string'))) ||
      (config.modelDirs !== undefined && (!config.modelDirs || Array.isArray(config.modelDirs) ||
        typeof config.modelDirs !== 'object' || !Object.values(config.modelDirs).every(value => typeof value === 'string'))) ||
      (config.options !== undefined && (!config.options || Array.isArray(config.options) || typeof config.options !== 'object')) ||
      (config.timeoutMs !== undefined && (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0)))
    throw new KernelError('INVALID_ARGUMENT', 'Invalid PDF config; expected command, optional args, modelDirs, options and timeoutMs')
  const base = dirname(resolve(path))
  const pathLike = value => value.startsWith('.') || value.includes('/') || value.includes('\\')
  return { ...config,
    command: pathLike(config.command) ? resolve(base, config.command) : config.command,
    ...(config.args ? { args: config.args.map(value => value.startsWith('./') || value.startsWith('../') ||
      value.startsWith('.\\') || value.startsWith('..\\') ? resolve(base, value) : value) } : {}),
    ...(config.modelDirs ? { modelDirs: Object.fromEntries(Object.entries(config.modelDirs)
      .map(([name, value]) => [name, resolve(base, value)])) } : {}) }
}
async function webDirectory() {
  const path = resolve(import.meta.dirname, '../dist/web')
  try { return (await stat(join(path, 'index.html'))).isFile() ? path : undefined } catch { return undefined }
}
async function invokeRemote(base, method, path, params) {
  const url = new URL(path, base)
  const keys = method === 'GET' ? Object.keys(params).filter(key => params[key] !== undefined &&
    !['docId', 'unitId', 'taskId', 'snapshotId'].includes(key)) : []
  for (const key of keys) url.searchParams.set(key, String(params[key]))
  const response = await fetch(url, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(clean(params)) })
  const body = await response.json()
  if (!response.ok) {
    const error = new KernelError(body.error?.code ?? 'INTERNAL', body.error?.message ?? response.statusText,
      body.error?.details)
    throw error
  }
  return body
}
async function waitForTask(invoke, taskId) {
  while (true) {
    const body = await invoke('getTask', { taskId }, 'GET', `/api/tasks/${taskId}`)
    const task = body.task
    if (!task) return body
    if (['succeeded', 'failed', 'canceled', 'paused'].includes(task.state)) return body
    await new Promise(resolveWait => setTimeout(resolveWait, 200))
  }
}

async function observeEvents(app, base, stdout, stderr) {
  let taskId
  let terminal = false
  let wakeTerminal
  let streamError = false
  const diagnostic = message => { if (!streamError) stderr.write(`${message}\n`); streamError = true; wakeTerminal?.() }
  const buffer = []
  const handle = event => {
    if (!taskId) { buffer.push(event); return }
    if (event?.data?.taskId === taskId) {
      stdout.write(`${serialize(event)}\n`)
      if (['task.succeeded', 'task.failed', 'task.canceled', 'task.paused'].includes(event.type)) {
        terminal = true; wakeTerminal?.()
      }
    }
  }
  const waitForTerminal = () => terminal || streamError ? Promise.resolve() : new Promise(resolveWait => {
    const timer = setTimeout(resolveWait, 1000)
    wakeTerminal = () => { clearTimeout(timer); resolveWait() }
  })
  if (app) {
    const unsubscribe = app.operations.subscribe(handle)
    return { setTaskId(id) { taskId = id; buffer.splice(0).forEach(handle) }, waitForTerminal, close: unsubscribe }
  }
  const controller = new AbortController()
  const response = await fetch(new URL('/api/events', base), { signal: controller.signal })
  if (!response.ok) throw new KernelError('UPSTREAM_FAILURE', 'Could not subscribe to task events')
  if (!response.body) throw new KernelError('UPSTREAM_FAILURE', 'Task event stream has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const consume = (async () => {
    let pending = ''
    let eventType
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        pending += decoder.decode(value, { stream: true })
        let split
        while ((split = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, split).replace(/\r$/, '')
          pending = pending.slice(split + 1)
          if (line.startsWith('event: ')) eventType = line.slice(7)
          else if (line.startsWith('data: ') && eventType) {
            try { handle({ type: eventType, data: JSON.parse(line.slice(6)) }) }
            catch { diagnostic('Malformed task event received; task status will be checked directly') }
            eventType = undefined
          }
        }
      }
      if (!controller.signal.aborted && !terminal)
        diagnostic('Task event stream ended; task status will be checked directly')
    } catch { if (!controller.signal.aborted) diagnostic('Task event stream failed; task status will be checked directly') }
  })()
  return { setTaskId(id) { taskId = id; buffer.splice(0).forEach(handle) },
    waitForTerminal, close() { controller.abort(); reader.cancel().catch(() => {}) } }
}

export async function runCli(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr } = {}) {
  let app, server, observer, mcpStdio = false
  try {
    const { positional, options: o } = parse(argv)
    const command = positional.shift() ?? 'help'
    mcpStdio = command === 'mcp' && !!o.stdio
    if (o.stdio && command !== 'mcp') throw new KernelError('INVALID_ARGUMENT', '--stdio is only supported by mcp')
    if (command === 'help' || o.help) { stdout.write(usage); return 0 }
    if (command === 'mcp' && (!o.stdio || o.url))
      throw new KernelError('INVALID_ARGUMENT', 'Use mcp --stdio for a local kernel, or connect an HTTP MCP client to the running /mcp endpoint')
    if (command === 'serve' || command === 'mcp') {
      if (o.url) throw new KernelError('INVALID_ARGUMENT', 'serve requires a local store')
      const store = storePath(o)
      await mkdir(dirname(store), { recursive: true })
      app = await createApp({ store, exportDir: o['export-dir'],
        components: { directory: join(dirname(resolve(store)), 'components') },
        settingsDir: o['settings-dir'] ?? join(dirname(store), 'settings'), pdf: await readPdfConfig(o['pdf-config']) })
      if (command === 'mcp') {
        const { runMcpStdio } = await import('./mcp.mjs')
        await runMcpStdio(app, { stdout })
        return 0
      }
      server = await serve(app, { host: o.host ?? '127.0.0.1', port: o.port ? Number(o.port) : 8787,
        mcp: !o['no-mcp'], staticDir: o['static-dir'] ?? await webDirectory() })
      stdout.write(`${server.url}\n`)
      await new Promise(resolveStop => { process.once('SIGINT', resolveStop); process.once('SIGTERM', resolveStop) })
      return 0
    }
    const [name, params, method, path] = route(command, positional, o)
    const remote = !!o.url
    if (remote && o['pdf-config']) throw new KernelError('INVALID_ARGUMENT', '--pdf-config only applies to a local kernel')
    const startsComponent = command === 'components' && ['install', 'local'].includes(positional[0])
    const startsTask = ['translate', 'export', 'import'].includes(command) || startsComponent
    if (startsComponent && o['json-events']) throw new KernelError('INVALID_ARGUMENT', 'Component installation uses task polling; use components task ID')
    if (!remote && o['no-wait'] && startsTask)
      throw new KernelError('INVALID_ARGUMENT', '--no-wait requires --url so the live server owns the task')
    if (o['json-events'] && o['no-wait'] && startsTask)
      throw new KernelError('INVALID_ARGUMENT', '--json-events cannot be combined with --no-wait')
    if (!remote) {
      const store = storePath(o)
      await mkdir(dirname(store), { recursive: true })
      app = await createApp({ store, exportDir: o['export-dir'],
        components: { directory: join(dirname(resolve(store)), 'components') },
        settingsDir: o['settings-dir'] ?? join(dirname(store), 'settings'), pdf: await readPdfConfig(o['pdf-config']) })
    }
    const invoke = remote ? (_name, p, m, url) => invokeRemote(o.url, m, url, p) :
      (operation, p) => app.operations.invoke(operation, clean(p))
    if (o['json-events'] && startsTask)
      observer = await observeEvents(app, o.url, stdout, stderr)
    const result = await invoke(name, params, method, path)
    if (startsComponent) {
      stdout.write(`${serialize(result)}\n`)
      if (o['no-wait']) return 0
      while (true) {
        const state = await invoke('componentTask', { taskId: result.taskId }, 'GET', `/api/components/tasks/${result.taskId}`)
        if (!['queued', 'running', 'stopping'].includes(state.task.state)) {
          stdout.write(`${serialize(state)}\n`)
          return state.task.state === 'completed' ? 0 : state.task.state === 'killed' ? 5 : 4
        }
        await new Promise(done => setTimeout(done, 250))
      }
    }
    observer?.setTaskId(result.taskId)
    const pendingImport = command === 'import' && result.taskId && !result.document
    if (o['json-events'] && result.taskId) {
      const final = await waitForTask(invoke, result.taskId)
      await observer?.waitForTerminal()
      if (final.task?.state === 'canceled') return 5
      if (final.task?.state === 'failed') return 4
    } else if (pendingImport && !o['no-wait']) {
      const final = await waitForTask(invoke, result.taskId)
      stdout.write(`${serialize(final.task?.state === 'succeeded' ?
        { ...result, ...final.task.result } : { ...result, task: final.task })}\n`)
      if (final.task?.state === 'canceled') return 5
      if (final.task?.state === 'failed') return 4
    } else {
      stdout.write(`${serialize(result)}\n`)
      if (result.taskId && !o['no-wait']) {
        const final = await waitForTask(invoke, result.taskId)
        if (final.task?.state === 'canceled') return 5
        if (final.task?.state === 'failed') return 4
      }
    }
    return 0
  } catch (error) {
    const mapped = errorEnvelope(error)
    if (argv.includes('--json') && !mcpStdio) stdout.write(`${serialize(mapped.body)}\n`)
    stderr.write(`${mapped.body.error.message}\n`)
    return mapped.exitCode
  } finally {
    let failure
    try { observer?.close() } catch (error) { failure = error }
    try { await server?.close() } catch (error) { failure ??= error }
    try { await app?.dispose() } catch (error) { failure ??= error }
    if (failure) throw failure
  }
}

function invokedAsCli() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1])) }
  catch { return false }
}

if (invokedAsCli())
  process.exitCode = await runCli()
