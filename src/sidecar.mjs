import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KernelError } from './errors.mjs'

const PROTOCOL_VERSION = 1
const MAX_LINE = 32 * 1024 * 1024
const MAX_STDERR = 4096
const SHUTDOWN_TIMEOUT_MS = 2000

const failure = (code, message, details = {}, cause) =>
  new KernelError(code, message, { stage: 'sidecar', ...details }, cause ? { cause } : {})

const canceled = () => failure('UPSTREAM_FAILURE', 'PDF sidecar request canceled', { canceled: true })
const crashed = (message, cause) => {
  const error = failure('UPSTREAM_FAILURE', message, {}, cause)
  error.retryable = true
  return error
}

async function cleanupWorkDir(workDir) {
  try { await rm(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
  catch (cause) { return failure('UPSTREAM_FAILURE', 'PDF sidecar work directory cleanup failed', { workDir, cleanupFailed: true }, cause) }
  return null
}

function terminateWindowsTree(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return Promise.resolve(null)
  return new Promise(resolve => {
    let killer
    try { killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) }
    catch (cause) { resolve(failure('UPSTREAM_FAILURE', 'PDF sidecar process tree could not be terminated', { terminationFailed: true }, cause)); return }
    let settled = false
    const finish = error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(error)
    }
    const timer = setTimeout(() => {
      killer.kill()
      finish(failure('UPSTREAM_FAILURE', 'PDF sidecar process tree termination timed out', { terminationFailed: true }))
    }, 10_000)
    killer.once('error', cause => finish(failure('UPSTREAM_FAILURE', 'PDF sidecar process tree could not be terminated', { terminationFailed: true }, cause)))
    killer.once('close', code => finish(code === 0 ? null : failure('UPSTREAM_FAILURE', `PDF sidecar process tree termination failed (${code})`, { terminationFailed: true })))
  })
}

function remoteError(value) {
  const code = value?.code
  const cause = typeof value?.diagnostic === 'string' && value.diagnostic
    ? new Error(value.diagnostic.slice(-MAX_STDERR)) : undefined
  const details = { sidecarCode: code }
  if (value?.data !== undefined) details.sidecarData = value.data
  if (code === -32002) return failure('COMPONENT_MISSING', value.message || 'PDF sidecar model assets are missing', details, cause)
  if ([-32001, -32003].includes(code) && value?.data?.code === 'PRECONDITION_FAILED') {
    return failure('PRECONDITION_FAILED', value.message || 'PDF source binding is unavailable', details, cause)
  }
  return failure('UPSTREAM_FAILURE', value?.message || 'PDF sidecar failed', details, cause)
}

export class SidecarClient {
  constructor({ command, args = [], modelDirs = {}, options = {}, timeoutMs = 30000 } = {}) {
    if (typeof command !== 'string' || !command.trim()) throw new KernelError('INVALID_ARGUMENT', 'Sidecar command must be a nonempty string')
    if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw new KernelError('INVALID_ARGUMENT', 'Sidecar args must be strings')
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new KernelError('INVALID_ARGUMENT', 'Sidecar timeoutMs must be a positive integer')
    this.command = command
    this.args = args
    this.modelDirs = modelDirs
    this.options = options
    this.timeoutMs = timeoutMs
    this.capabilities = null
    this.session = null
    this.queue = []
    this.active = null
    this.running = false
    this.worker = null
    this.closed = false
    this.closePromise = null
    this.nextId = 1
  }

  request(method, params = {}, { signal, onProgress } = {}) {
    if (this.closed) return Promise.reject(failure('PRECONDITION_FAILED', 'PDF sidecar client is closed'))
    if (typeof method !== 'string' || !method.trim() || ['handshake', 'configure', 'shutdown'].includes(method)) {
      return Promise.reject(new KernelError('INVALID_ARGUMENT', 'Invalid PDF sidecar method'))
    }
    if (signal !== undefined && (typeof signal?.addEventListener !== 'function' || typeof signal?.aborted !== 'boolean')) {
      return Promise.reject(new KernelError('INVALID_ARGUMENT', 'signal must be an AbortSignal'))
    }
    if (onProgress !== undefined && typeof onProgress !== 'function') {
      return Promise.reject(new KernelError('INVALID_ARGUMENT', 'onProgress must be a function'))
    }
    if (signal?.aborted) return Promise.reject(canceled())
    return new Promise((resolve, reject) => {
      const item = { method, params, signal, onProgress, resolve, reject, settled: false, abort: null }
      item.abort = () => {
        if (this.active === item) {
          item.cancelRequested = true
          this.#stopSession(this.session, canceled())
        } else {
          this.#settle(item, canceled())
          this.queue = this.queue.filter(queued => queued !== item)
        }
      }
      signal?.addEventListener('abort', item.abort, { once: true })
      this.queue.push(item)
      this.worker ??= this.#drain()
    })
  }

  async close() {
    if (this.closePromise) return this.closePromise
    this.closed = true
    const error = failure('PRECONDITION_FAILED', 'PDF sidecar client is closed')
    for (const item of this.queue.splice(0)) this.#settle(item, error)
    let activeClosed
    if (this.active) {
      this.active.closeRequested = true
      activeClosed = this.#stopSession(this.session, error)
    }
    this.closePromise = (async () => {
      await this.worker
      const activeCleanupError = await activeClosed
      if (activeCleanupError) throw activeCleanupError
      const session = this.session
      if (!session) return
      try { await this.#rpc(session, 'shutdown', {}, undefined, SHUTDOWN_TIMEOUT_MS) } catch { /* shutdown is best effort */ }
      const cleanupError = await this.#stopSession(session)
      if (cleanupError) throw cleanupError
    })()
    return this.closePromise
  }

  #settle(item, error, result) {
    if (item.settled) return
    item.settled = true
    item.signal?.removeEventListener('abort', item.abort)
    if (error) item.reject(error)
    else item.resolve(result)
  }

  async #drain() {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length && !this.closed) {
        const item = this.queue.shift()
        if (item.settled) continue
        this.active = item
        let crashes = 0
        while (!item.settled) {
          try {
            if (!this.session) await this.#start()
            if (item.settled) break
            const result = await this.#rpc(this.session, item.method, item.params, item.onProgress)
            this.#settle(item, null, result)
          } catch (error) {
            const cleanupError = await error.closePromise
            if (cleanupError) error = cleanupError
            if (error.details?.cleanupFailed || error.details?.terminationFailed) { this.#settle(item, error); break }
            if (item.cancelRequested) { this.#settle(item, canceled()); break }
            if (item.closeRequested) { this.#settle(item, failure('PRECONDITION_FAILED', 'PDF sidecar client is closed')); break }
            if (item.settled) break
            if (error.retryable && crashes++ < 1 && !this.closed) continue
            this.#settle(item, error)
          }
        }
        this.active = null
      }
    } finally {
      this.running = false
      this.worker = null
      if (this.queue.length && !this.closed) this.worker = this.#drain()
    }
  }

  async #start() {
    let workDir
    try {
      const root = this.options?.workDir || tmpdir()
      await mkdir(root, { recursive: true })
      workDir = await mkdtemp(join(root, 'ivoraige-sidecar-'))
    } catch (cause) {
      throw failure('UPSTREAM_FAILURE', 'PDF sidecar work directory could not be created', {}, cause)
    }
    if (this.closed || this.active?.cancelRequested) {
      const cleanupError = await cleanupWorkDir(workDir)
      if (cleanupError) throw cleanupError
      throw this.closed ? failure('PRECONDITION_FAILED', 'PDF sidecar client is closed') : canceled()
    }
    let child
    try {
      child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    } catch (cause) {
      const cleanupError = await cleanupWorkDir(workDir)
      if (cleanupError) throw cleanupError
      throw failure('COMPONENT_MISSING', 'PDF sidecar executable is unavailable', {}, cause)
    }
    const session = { child, workDir, pending: null, buffer: '', stderr: '', dead: false }
    session.childClosed = new Promise(resolve => { session.resolveChildClosed = resolve })
    session.closed = session.childClosed.then(async () => {
      // close follows stdio closure; exit alone can precede the final stderr data.
      if (session.stopError && !session.stopError.cause && session.stderr &&
          !Object.hasOwn(session.stopError.details, 'sidecarCode')) {
        session.stopError.cause = new Error(session.stderr)
      }
      const terminationError = await session.termination
      const cleanupError = await cleanupWorkDir(workDir)
      return terminationError ?? cleanupError
    })
    this.session = session
    child.once('close', () => {
      clearTimeout(session.killTimer)
      session.resolveChildClosed()
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => this.#stdout(session, chunk))
    child.stderr.on('data', chunk => { session.stderr = (session.stderr + chunk).slice(-MAX_STDERR) })
    child.on('error', cause => {
      const error = cause.code === 'ENOENT'
        ? failure('COMPONENT_MISSING', 'PDF sidecar executable is unavailable', {}, cause)
        : crashed('PDF sidecar could not start', cause)
      this.#stopSession(session, error)
    })
    child.on('exit', (code, signal) => {
      this.#stopSession(session, crashed(`PDF sidecar exited (${signal ?? code ?? 'unknown'})`))
    })
    try {
      const handshake = await this.#rpc(session, 'handshake', { protocolVersion: PROTOCOL_VERSION })
      if (handshake?.protocolVersion !== PROTOCOL_VERSION) {
        throw failure('COMPONENT_MISSING', 'PDF sidecar protocol version mismatch; upgrade the sidecar', {
          expected: PROTOCOL_VERSION, actual: handshake?.protocolVersion
        })
      }
      if (this.closed) throw failure('PRECONDITION_FAILED', 'PDF sidecar client is closed')
      await this.#rpc(session, 'configure', { modelDirs: this.modelDirs, options: { ...this.options, workDir } })
      this.capabilities = handshake.capabilities ?? null
    } catch (error) {
      const cleanupError = await this.#stopSession(session, error)
      throw cleanupError ?? error
    }
  }

  #stdout(session, chunk) {
    if (session.dead) return
    session.buffer += chunk
    if (session.buffer.length > MAX_LINE && !session.buffer.includes('\n')) {
      this.#stopSession(session, failure('UPSTREAM_FAILURE', 'PDF sidecar response line is too large'))
      return
    }
    let end
    while (!session.dead && (end = session.buffer.indexOf('\n')) !== -1) {
      const line = session.buffer.slice(0, end).trim()
      session.buffer = session.buffer.slice(end + 1)
      if (!line || line.length > MAX_LINE) {
        this.#stopSession(session, failure('UPSTREAM_FAILURE', 'PDF sidecar emitted invalid protocol output'))
        return
      }
      let message
      try { message = JSON.parse(line) } catch {
        this.#stopSession(session, failure('UPSTREAM_FAILURE', 'PDF sidecar emitted invalid JSON'))
        return
      }
      if (message?.method === 'progress' && message.id === undefined && message.params && typeof message.params === 'object') {
        try { session.pending?.onProgress?.(message.params) } catch { /* observers cannot corrupt transport */ }
        continue
      }
      const pending = session.pending
      if (message?.jsonrpc !== '2.0' || !pending || message.id !== pending.id ||
          (Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error')) ||
          (Object.hasOwn(message, 'error') && (!message.error || typeof message.error !== 'object')) ||
          (Object.hasOwn(message, 'error') && !Number.isInteger(message.error.code))) {
        this.#stopSession(session, failure('UPSTREAM_FAILURE', 'PDF sidecar emitted invalid protocol output'))
        return
      }
      session.pending = null
      clearTimeout(pending.timer)
      if (message.error) {
        // Only the response can associate a diagnostic with this request.
        pending.reject(remoteError(message.error))
      }
      else pending.resolve(message.result)
    }
  }

  #rpc(session, method, params, onProgress, timeoutMs = this.timeoutMs) {
    if (session.dead) return Promise.reject(crashed('PDF sidecar exited'))
    const id = this.nextId++
    let line
    try { line = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n' } catch (cause) {
      return Promise.reject(new KernelError('INVALID_ARGUMENT', 'PDF sidecar params must be JSON data', {}, { cause }))
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#stopSession(session, failure('UPSTREAM_FAILURE', `PDF sidecar ${method} timed out`))
      }, timeoutMs)
      session.pending = { id, resolve, reject, timer, onProgress }
      try {
        session.child.stdin.write(line, error => {
          if (error && !session.dead) this.#stopSession(session, crashed('PDF sidecar input failed', error))
        })
      } catch (cause) {
        this.#stopSession(session, crashed('PDF sidecar input failed', cause))
      }
    })
  }

  #stopSession(session, error) {
    if (!session) return Promise.resolve()
    if (session.dead) return session.closed
    session.dead = true
    session.stopError = error
    if (this.session === session) {
      this.session = null
      this.capabilities = null
    }
    if (session.pending) {
      const pending = session.pending
      session.pending = null
      clearTimeout(pending.timer)
      pending.reject(error ?? failure('PRECONDITION_FAILED', 'PDF sidecar client is closed'))
    }
    if (error) error.closePromise = session.closed
    if (session.child.exitCode === null && session.child.signalCode === null) {
      if (process.platform === 'win32') {
        session.termination = terminateWindowsTree(session.child.pid).then(treeError => {
          // Shutdown or startup failure can close the process while taskkill is
          // starting; an already exited launcher no longer needs termination.
          if (treeError && session.child.exitCode !== null) return null
          if (treeError && session.child.exitCode === null && session.child.signalCode === null) {
            session.child.kill()
            session.killTimer = setTimeout(() => session.child.kill('SIGKILL'), 1500)
            session.killTimer.unref()
          }
          return treeError
        })
      } else {
        session.child.kill()
        session.killTimer = setTimeout(() => session.child.kill('SIGKILL'), 1500)
        session.killTimer.unref()
      }
    }
    return session.closed
  }
}
