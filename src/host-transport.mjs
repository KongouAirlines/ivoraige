import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, createConnection } from 'node:net'
import { chmod, lstat, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { ERROR_STATUSES, KernelError } from './errors.mjs'
import { assertPrivateDirectory, assertPrivateFile, createPrivateFile, ensurePrivateDirectory } from './host-permissions.mjs'

import { createWindowsPipeServer, connectWindowsPipe } from './host-windows-pipe.mjs'

import { hostSocketDirectory, releaseHostSocketDirectory } from './host-socket-directory.mjs'
import { acquireRegistryLockBounded } from './host-domain.mjs'

export const HOST_INTERFACE_VERSION = 'HostControl@1'
export const HOST_INTERFACE_MINOR = 0
const MAX_FRAME = 1024 * 1024
const MAX_CONNECTIONS = 64
// The native Windows broker may need its existing 20-second cold start before
// the pipe can connect; its own connect deadline is 25 seconds.
const CONNECT_TIMEOUT_MS = process.platform === 'win32' ? 25_000 : 5000
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/)
const shape = fields => z.object(fields).strict()
const empty = shape({})
const actions = {
  state: empty,
  drain: shape({ budgetMs: z.number().int().min(1).max(120_000) }),
  exit: shape({ budgetMs: z.number().int().min(1).max(120_000) }),
  operation: shape({ operationId: id }),
  ownerBootstrap: empty,
  transportInfo: empty,
  prepareForceExit: shape({ operationId: id }),
  forceExit: shape({ operationId: id, challengeId: id, acknowledgeUnknownOutcome: z.literal(true) }),
  business: shape({ method: id, input: z.unknown() }),
  'mcp.describe': empty,
  'mcp.call': shape({ name: id, input: z.unknown() }),
  'mcp.read': shape({ name: id, uri: z.string().min(1).max(2048), variables: z.record(z.string(), z.string().max(2048)) }),
}
const requestShape = shape({ interfaceVersion: z.string(), minor: z.number().int(), requestId: id,
  action: z.string(), expectedGeneration: id, params: z.unknown(), capability: z.string().min(1).optional() })
const attachShape = shape({ interfaceVersion: z.string(), minor: z.number().int(), requestId: id,
  action: z.literal('attach'), params: shape({ dataDomainRef: id, requiredLifetime: z.enum(['resident', 'ephemeral']) }),
  capability: z.string().min(1).optional() })
const fail = (code, reason, message = reason) => new KernelError(code, message, { reason })
const validVersion = frame => {
  if (frame.interfaceVersion !== HOST_INTERFACE_VERSION || frame.minor !== HOST_INTERFACE_MINOR)
    throw new KernelError('PRECONDITION_FAILED', 'Unsupported host control interface',
      { reason: 'interface-version-unsupported', supportedMinors: [HOST_INTERFACE_MINOR] })
}
const hashedName = domain => createHash('sha256').update(domain).digest('hex').slice(0, 24)
const recordPath = (directory, domain) => join(directory, `host-${hashedName(domain)}.json`)
const capabilityPath = (directory, domain, generation) =>
  join(directory, `host-${hashedName(domain)}-${hashedName(generation)}.cap`)

function checkRecord(value, dataDomainRef) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !['dataDomainRef', 'generation', 'lifetime', 'address', 'kind'].every(k => Object.hasOwn(value, k)) ||
    Object.keys(value).some(k => !['dataDomainRef', 'generation', 'lifetime', 'address', 'kind'].includes(k)) ||
    value.dataDomainRef !== dataDomainRef || !id.safeParse(value.generation).success ||
    !['resident', 'ephemeral'].includes(value.lifetime) ||
    (value.lifetime === 'ephemeral'
      ? value.address !== null || value.kind !== 'in-process'
      : typeof value.address !== 'string' || value.address.length > 256 ||
        value.kind !== (process.platform === 'win32' ? 'pipe-capability' : 'unix-socket')))
    throw fail('CONFLICT', 'owner-unreachable', 'Host discovery record cannot be verified')
  return value
}

async function readRecord(directory, dataDomainRef) {
  await assertPrivateDirectory(directory)
  const file = recordPath(directory, dataDomainRef)
  try {
    await assertPrivateFile(file)
    if ((await lstat(file)).size > 4096) throw fail('CONFLICT', 'owner-unreachable')
    return checkRecord(JSON.parse(await readFile(file, 'utf8')), dataDomainRef)
  } catch (error) {
    if (error.code === 'ENOENT') throw fail('NOT_FOUND', 'owner-absent', 'No host owner is registered')
    if (error instanceof KernelError) throw error
    throw fail('CONFLICT', 'owner-unreachable', 'Host discovery record cannot be verified')
  }
}

async function writeRecord(directory, record) {
  await assertPrivateDirectory(directory)
  const lease = await acquireRegistryLockBounded(directory)
  const target = recordPath(directory, record.dataDomainRef)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await createPrivateFile(temporary, `${JSON.stringify(record)}\n`)
    await rename(temporary, target)
    await assertPrivateFile(target)
  } finally {
    try { await rm(temporary, { force: true }) }
    finally { lease.release() }
  }
}

async function removeOwnedRecord(directory, record) {
  await assertPrivateDirectory(directory)
  // The store lease is already released during exit. Serialize the entire
  // read/check/unlink with publication so an old generation cannot remove a
  // replacement owner's record between the check and the unlink.
  const lease = await acquireRegistryLockBounded(directory)
  try {
    const existing = await readRecord(directory, record.dataDomainRef)
    if (existing.generation === record.generation && existing.address === record.address)
      await rm(recordPath(directory, record.dataDomainRef))
  } catch (error) { if (error.code !== 'NOT_FOUND') throw error }
  finally { lease.release() }
}

export function formatHostFailure(error) {
  const code = error instanceof KernelError && Object.hasOwn(ERROR_STATUSES, error.code) ? error.code : 'INTERNAL'
  const reason = code !== 'INTERNAL' && id.safeParse(error.details?.reason).success
    ? error.details.reason : 'internal-error'
  // Never return raw exception text or a received frame; either could contain
  // a browser bootstrap credential or business secret.
  return { ok: false, apiVersion: '2.0', error: { code, message: 'Host control request failed',
    details: { reason, ...(reason === 'interface-version-unsupported'
      ? { supportedMinors: [HOST_INTERFACE_MINOR] } : {}) } } }
}

function equalSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const aa = Buffer.from(a), bb = Buffer.from(b)
  return aa.length === bb.length && timingSafeEqual(aa, bb)
}

function frameSocket(socket, payload, { timeoutMs, timeoutReason = 'owner-unreachable', invalidFrameReason = 'invalid-request', socketErrorReason, signal } = {}) {
  return new Promise((resolveFrame, reject) => {
    let size = 0
    const chunks = []
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => socket.destroy(fail('CONFLICT', timeoutReason)), timeoutMs)
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); socket.off('data', data); socket.off('error', error); socket.off('end', end); socket.off('close', end) }
    const rejectFrame = cause => { cleanup(); reject(cause) }
    // Native broker failures are KernelErrors, not necessarily network errno.
    // Once waiting for a reply, any local transport failure leaves delivery
    // uncertain. Keep received failure frames and local input errors separate.
    const error = cause => rejectFrame(socketErrorReason
      ? fail('CONFLICT', signal?.aborted ? 'request-cancelled' : socketErrorReason) : cause)
    const end = () => error(fail('CONFLICT', timeoutReason))
    const abort = () => socket.destroy(fail('CONFLICT', 'request-cancelled'))
    const invalidFrame = () => fail(invalidFrameReason === 'invalid-request' ? 'INVALID_ARGUMENT' : 'CONFLICT', invalidFrameReason)
    const data = chunk => {
      size += chunk.length
      if (size > MAX_FRAME) { socket.destroy(invalidFrame()); return }
      chunks.push(chunk)
      const all = Buffer.concat(chunks)
      const newline = all.indexOf(10)
      if (newline < 0) return
      cleanup()
      if (newline !== all.length - 1) { reject(invalidFrame()); return }
      try { resolveFrame(JSON.parse(all.subarray(0, newline).toString('utf8'))) }
      catch { reject(invalidFrame()) }
    }
    socket.on('data', data).once('error', error).once('end', end).once('close', end)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    if (payload !== undefined) {
      const bytes = Buffer.from(`${JSON.stringify(payload)}\n`)
      if (bytes.length > MAX_FRAME) { rejectFrame(fail('INVALID_ARGUMENT', 'invalid-request')); return }
      socket.write(bytes)
    }
  })
}

function sendFrame(socket, frame) {
  // A handler has already run. Failure to deliver its result must never be
  // described as invalid input with no side effects.
  let bytes
  try {
    if (frame.ok === true && frame.result === undefined) throw new Error('Missing result')
    bytes = Buffer.from(`${JSON.stringify(frame)}\n`)
  } catch { throw fail('CONFLICT', 'outcome-unknown') }
  if (bytes.length > MAX_FRAME) throw fail('CONFLICT', 'outcome-unknown')
  socket.end(bytes)
}

function writeFrame(socket, frame) {
  const bytes = Buffer.from(`${JSON.stringify(frame)}\n`)
  if (bytes.length > MAX_FRAME) throw fail('INVALID_ARGUMENT', 'invalid-request')
  socket.write(bytes)
}

export function validateHostRequest(value) {
  const base = requestShape.safeParse(value)
  if (!base.success || !Object.hasOwn(actions, base.data.action)) throw fail('INVALID_ARGUMENT', 'invalid-request')
  validVersion(base.data)
  const params = actions[base.data.action].safeParse(base.data.params)
  if (!params.success) throw fail('INVALID_ARGUMENT', 'invalid-request')
  const method = params.data.method ?? params.data.name
  if (['__proto__', 'prototype', 'constructor'].includes(method)) throw fail('INVALID_ARGUMENT', 'invalid-request')
  return { ...base.data, params: params.data }
}

export function validateHostAttach(value) {
  const parsed = attachShape.safeParse(value)
  if (!parsed.success) throw fail('INVALID_ARGUMENT', 'invalid-request')
  validVersion(parsed.data)
  return parsed.data
}

// A protected owner transport is deliberately separate from HTTP and MCP.
// The host bootstrap must already own the canonical store lock before start().
// POSIX uses kernel-enforced private directory/socket DAC; Windows uses a
// current-SID native pipe DACL plus verified server/client token identities.
// The per-generation 256-bit capability remains a second, generation-bound check.
// Ephemeral owners publish only a protected marker, never a connectable IPC.
export function createHostTransport({ directory, dataDomainRef, generation, lifetime,
  getState, handleControl, handleBusiness, session, getSession = () => session,
  getInfo = () => ({}), waitForAttempt } = {}) {
  if (!id.safeParse(dataDomainRef).success || !id.safeParse(generation).success ||
    !['resident', 'ephemeral'].includes(lifetime) || typeof getState !== 'function' ||
    (lifetime === 'resident' && typeof handleControl !== 'function'))
    throw fail('INVALID_ARGUMENT', 'invalid-request')
  directory = resolve(directory)
  let server, record, capability, closing, socketDirectory, closed = false
  const ownerProcess = { pid: process.pid, runtimeStartTimeMs: Math.floor(performance.timeOrigin), nonce: randomUUID() }
  const sockets = new Set()
  const exitWaiters = new Map()
  const finalizedSockets = new Set()
  const removeExitWaiter = socket => {
    for (const [operationId, peers] of exitWaiters) {
      peers.delete(socket)
      if (!peers.size) exitWaiters.delete(operationId)
    }
  }

  async function handle(socket) {
    try {
      const hello = await frameSocket(socket, undefined, { timeoutMs: 5000 })
      if (hello?.action !== 'attach') { await dispatchHostAction(socket, hello, { dataDomainRef, generation, capability,
        getState, handleControl, handleBusiness, getSession, getInfo, onAcceptedExit }); return }
      const parsed = validateHostAttach(hello)
      if (parsed.params.dataDomainRef !== dataDomainRef) throw fail('CONFLICT', 'stale-generation')
      if (parsed.params.requiredLifetime !== 'resident') throw fail('CONFLICT', 'temporary-owner')
      if (process.platform === 'win32' && !equalSecret(parsed.capability, capability))
        throw fail('UNAUTHORIZED', 'owner-authentication-required')
      const state = await getState()
      if (state.dataDomainRef !== dataDomainRef || state.generation !== generation ||
        state.storeOwnership !== 'held') throw fail('CONFLICT', 'owner-unreachable')
      sendFrame(socket, { ok: true, result: { reused: true, dataDomainRef, generation,
        supportedMinors: [HOST_INTERFACE_MINOR], state, ownerProcess } })
    } catch (error) {
      try { sendFrame(socket, formatHostFailure(error)) } catch { socket.destroy() }
    }
  }

  function onAcceptedExit(socket, result) {
    let peers = exitWaiters.get(result.operationId)
    if (!peers) exitWaiters.set(result.operationId, peers = new Set())
    peers.add(socket)
    writeFrame(socket, { ok: true, result })
    // Preserve the finalization channel until this attempt settles; a blocked
    // attempt closes without a receipt instead of waiting for a later retry.
    if (typeof waitForAttempt === 'function') Promise.resolve().then(() => waitForAttempt()).finally(() => {
      if (peers.has(socket) && !finalizedSockets.has(socket)) socket.end()
    }).catch(() => { socket.destroy() })
  }

  async function start() {
    if (server) return record
    if (record) return record
    if (closed) throw fail('PRECONDITION_FAILED', 'owner-unavailable')
    await assertPrivateDirectory(directory)
    if ((await getState()).storeOwnership !== 'held') throw fail('CONFLICT', 'owner-unreachable')
    if (lifetime === 'ephemeral') {
      record = { dataDomainRef, generation, lifetime, address: null, kind: 'in-process' }
      await writeRecord(directory, record)
      return record
    }
    const nonce = randomBytes(16).toString('base64url')
    socketDirectory = process.platform === 'win32' ? null : await hostSocketDirectory(directory)
    if (socketDirectory) await ensurePrivateDirectory(socketDirectory)
    const address = process.platform === 'win32' ? `\\\\.\\pipe\\ivoraige-${nonce}` : join(socketDirectory, `host-${nonce}.sock`)
    if (process.platform !== 'win32' && Buffer.byteLength(address) > 100)
      throw fail('PRECONDITION_FAILED', 'owner-unavailable', 'Host control path is too long')
    capability = process.platform === 'win32' ? randomBytes(32).toString('base64url') : undefined
    record = { dataDomainRef, generation, lifetime, address,
      kind: process.platform === 'win32' ? 'pipe-capability' : 'unix-socket' }
    if (capability) await createPrivateFile(capabilityPath(directory, dataDomainRef, generation), `${capability}\n`)
    server = (process.platform === 'win32' ? createWindowsPipeServer : createServer)(socket => {
      if (sockets.size >= MAX_CONNECTIONS) { socket.destroy(); return }
      sockets.add(socket)
      socket.once('close', () => { sockets.delete(socket); finalizedSockets.delete(socket); removeExitWaiter(socket) })
      void handle(socket)
    })
    try {
      await new Promise((resolveListen, reject) => {
        server.once('error', reject)
        server.listen(address, () => { server.off('error', reject); resolveListen() })
      })
      if (process.platform !== 'win32') {
        await chmod(address, 0o600)
        const info = await lstat(address)
        if (!info.isSocket() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600) throw fail('PRECONDITION_FAILED', 'owner-permissions-unverified')
      }
      await writeRecord(directory, record)
      return record
    } catch (error) { await cleanupDiscovery(); await close(); throw error }
  }

  async function cleanupDiscovery() {
    if (record) {
      await removeOwnedRecord(directory, record)
    }
  }

  async function finalize(receipt) {
    if (!receipt || receipt.type !== 'host.finalized' || receipt.dataDomainRef !== dataDomainRef ||
        receipt.generation !== generation || receipt.storeOwnership !== 'released' ||
        !id.safeParse(receipt.operationId).success || (await getState()).storeOwnership !== 'released')
      throw fail('PRECONDITION_FAILED', 'finalization-unavailable')
    const peers = exitWaiters.get(receipt.operationId)
    if (!peers) return
    for (const socket of peers) {
      if (socket.destroyed) continue
      finalizedSockets.add(socket)
      try { sendFrame(socket, receipt) } catch { socket.destroy() }
    }
  }

  async function close() {
    if (closed) return
    if (closing) return closing
    closing = (async () => {
      // Permit a queued finalization frame to leave the host before tearing
      // down its authenticated channel. A client that never reads is bounded.
      if (finalizedSockets.size) await Promise.race([
        Promise.all([...finalizedSockets].map(socket => socket.destroyed ? undefined :
          new Promise(resolveClose => socket.once('close', resolveClose)))),
        new Promise(resolveTimeout => setTimeout(resolveTimeout, 500)),
      ])
      for (const socket of sockets) socket.destroy()
      if (server) await new Promise((resolveClose, reject) => server.close(error => {
        // Failed POSIX listen never owned a socket. Do not mask its original
        // EPERM/EACCES with net.Server's already-stopped cleanup diagnostic.
        if (error && !(process.platform !== 'win32' && error.code === 'ERR_SERVER_NOT_RUNNING')) reject(error)
        else resolveClose()
      }))
      if (record) {
        if (record.address && process.platform !== 'win32') await rm(record.address, { force: true })
        else if (record.address) await rm(capabilityPath(directory, dataDomainRef, generation), { force: true })
      }
      if (socketDirectory) await releaseHostSocketDirectory(socketDirectory)
      getSession()?.revokeAll()
      closed = true
    })()
    try { await closing } finally { closing = undefined }
  }

  return { start, cleanupDiscovery, finalize, close, get record() { return record } }
}

export async function dispatchHostAction(socket, frame, { dataDomainRef, generation, capability,
  getState, handleControl, handleBusiness, getSession, getInfo, onAcceptedExit } = {}) {
  let businessController, cancelBusiness
  try {
    // Each connection is one authenticated action. The protected socket
    // path/capability is checked again rather than trusting a prior attach.
    const parsed = validateHostRequest(frame)
    if (process.platform === 'win32' && !equalSecret(frame.capability, capability))
      throw fail('UNAUTHORIZED', 'owner-authentication-required')
    if (parsed.expectedGeneration !== generation) throw fail('CONFLICT', 'stale-generation')
    if (parsed.action === 'business' || parsed.action.startsWith('mcp.')) {
      businessController = new AbortController()
      cancelBusiness = () => businessController.abort()
      socket.once('close', cancelBusiness)
      if (socket.destroyed) cancelBusiness()
    }
    const state = await getState()
    if (businessController?.signal.aborted) return
    if (state.dataDomainRef !== dataDomainRef || state.generation !== generation)
      throw fail('CONFLICT', 'stale-generation')
    if (state.storeOwnership !== 'held' && !['state', 'operation'].includes(parsed.action))
      throw fail('CONFLICT', 'owner-unreachable')
    if (parsed.action === 'prepareForceExit' || parsed.action === 'forceExit')
      throw fail('PRECONDITION_FAILED', 'force-unavailable')
    let result
    if (parsed.action === 'ownerBootstrap') {
      const currentSession = getSession()
      if (!currentSession) throw fail('PRECONDITION_FAILED', 'owner-unavailable')
      result = currentSession.issueBootstrap()
    } else if (parsed.action === 'transportInfo') {
      result = await getInfo()
    } else if (parsed.action === 'business' || parsed.action.startsWith('mcp.')) {
      if (state.storeOwnership !== 'held' || !state.acceptingBusiness || typeof handleBusiness !== 'function')
        throw fail('PRECONDITION_FAILED', 'host-draining')
      result = parsed.action === 'business'
        ? await handleBusiness(parsed.params.method, parsed.params.input, { signal: businessController.signal })
        : await handleBusiness(parsed.action, parsed.params, { signal: businessController.signal })
    } else result = await handleControl(parsed.action, parsed.params, parsed)
    if (!socket.destroyed) {
      if (parsed.action === 'exit' && result?.accepted === true &&
          id.safeParse(result.operationId).success && typeof onAcceptedExit === 'function')
        onAcceptedExit(socket, result)
      else sendFrame(socket, { ok: true, result })
    }
  } catch (error) {
    if (!socket.destroyed) try { sendFrame(socket, formatHostFailure(error)) } catch { socket.destroy() }
  } finally { if (cancelBusiness) socket.off('close', cancelBusiness) }
}


export async function exchangeHostFrame(address, frame, { timeoutMs, signal,
  createSocket = process.platform === 'win32' ? connectWindowsPipe : createConnection } = {}) {
  if ((timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)) ||
    (signal !== undefined && (typeof signal?.addEventListener !== 'function' ||
      typeof signal?.removeEventListener !== 'function' || typeof signal?.aborted !== 'boolean')))
    throw fail('INVALID_ARGUMENT', 'invalid-request')
  const socket = createSocket(address)
  let connected = false
  try {
    if (signal?.aborted) throw fail('CONFLICT', 'request-cancelled')
    await new Promise((resolveConnect, reject) => {
      const timer = setTimeout(() => socket.destroy(fail('CONFLICT', 'owner-unreachable')), CONNECT_TIMEOUT_MS)
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); socket.off('connect', connect); socket.off('error', error); socket.off('close', close) }
      const connect = () => { cleanup(); connected = true; resolveConnect() }
      const error = cause => { cleanup(); reject(cause) }
      const close = () => error(fail('CONFLICT', 'owner-unreachable'))
      const abort = () => socket.destroy(fail('CONFLICT', 'request-cancelled'))
      socket.once('connect', connect).once('error', error).once('close', close)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
    const response = await frameSocket(socket, frame, { timeoutMs,
      timeoutReason: frame.action === 'attach' ? 'owner-unreachable' : 'outcome-unknown',
      invalidFrameReason: frame.action === 'attach' ? 'owner-unreachable' : 'outcome-unknown',
      socketErrorReason: frame.action === 'attach' ? 'owner-unreachable' : 'outcome-unknown', signal })
    const validResponse = response?.ok === true ? Object.hasOwn(response, 'result')
      : response?.ok === false && response.apiVersion === '2.0' &&
        Object.hasOwn(ERROR_STATUSES, response.error?.code) && typeof response.error?.message === 'string' &&
        id.safeParse(response.error?.details?.reason).success
    if (!validResponse)
      throw fail('CONFLICT', frame.action === 'attach' ? 'owner-unreachable' : 'outcome-unknown')
    if (!response.ok) throw new KernelError(response.error?.code || 'CONFLICT',
      'Host control request failed', { reason: response.error?.details?.reason,
        ...(response.error?.details?.supportedMinors ? { supportedMinors: response.error.details.supportedMinors } : {}) })
    return response.result
  } catch (error) {
    if (['ENOENT', 'ECONNREFUSED', 'EPIPE', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code))
      throw fail('CONFLICT', connected && frame.action !== 'attach' ? 'outcome-unknown' : 'owner-unreachable')
    throw error
  } finally { socket.destroy() }
}

export async function connectHostTransport({ directory, dataDomainRef, requiredLifetime = 'resident' } = {}) {
  if (!id.safeParse(dataDomainRef).success || requiredLifetime !== 'resident')
    throw fail('INVALID_ARGUMENT', 'invalid-request')
  directory = resolve(directory)
  const record = await readRecord(directory, dataDomainRef)
  if (record.lifetime === 'ephemeral') throw fail('CONFLICT', 'temporary-owner')
  let capability
  if (process.platform === 'win32') {
    const prefix = '\\\\.\\pipe\\ivoraige-'
    if (!record.address.startsWith(prefix) ||
      !/^[A-Za-z0-9_-]{22}$/.test(record.address.slice(prefix.length)))
      throw fail('CONFLICT', 'owner-unreachable')
    const file = capabilityPath(directory, dataDomainRef, record.generation)
    await assertPrivateFile(file)
    if ((await lstat(file)).size > 128) throw fail('CONFLICT', 'owner-unreachable')
    capability = (await readFile(file, 'utf8')).trim()
    if (!/^[A-Za-z0-9_-]{43}$/.test(capability)) throw fail('CONFLICT', 'owner-unreachable')
  } else {
    let info
    try { info = await lstat(record.address) }
    catch { throw fail('CONFLICT', 'owner-unreachable') }
    const socketDirectory = dirname(record.address)
    await assertPrivateDirectory(socketDirectory)
    if (!/^host-[A-Za-z0-9_-]{22}\.sock$/.test(basename(record.address)) ||
      resolve(record.address) !== record.address || !info.isSocket() ||
      info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600)
      throw fail('CONFLICT', 'owner-unreachable')
  }
  const attached = await exchangeHostFrame(record.address, { interfaceVersion: HOST_INTERFACE_VERSION,
    minor: HOST_INTERFACE_MINOR, requestId: randomUUID(), action: 'attach',
    params: { dataDomainRef, requiredLifetime }, ...(capability ? { capability } : {}) }, { timeoutMs: 5000 })
  if (attached.generation !== record.generation || attached.dataDomainRef !== dataDomainRef ||
    attached.state?.generation !== record.generation || attached.state?.dataDomainRef !== dataDomainRef ||
    attached.state?.storeOwnership !== 'held') throw fail('CONFLICT', 'owner-unreachable')
  return { attached, generation: record.generation, async request(action, params = {}, options = {}) {
    if (!Object.hasOwn(actions, action)) throw fail('INVALID_ARGUMENT', 'invalid-request')
    if (options === null || typeof options !== 'object' || Array.isArray(options) ||
      (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) ||
        options.timeoutMs < 1 || options.timeoutMs > 2_147_483_647)) ||
      (options.signal !== undefined && (typeof options.signal?.addEventListener !== 'function' ||
        typeof options.signal?.removeEventListener !== 'function' || typeof options.signal?.aborted !== 'boolean')))
      throw fail('INVALID_ARGUMENT', 'invalid-request')
    if (options.signal?.aborted) throw fail('CONFLICT', 'request-cancelled')
    const timeoutMs = options.timeoutMs ?? (['business', 'mcp.describe', 'mcp.call', 'mcp.read'].includes(action)
      ? undefined : ['drain', 'exit'].includes(action) ? params.budgetMs + 5000 : 5000)
    return exchangeHostFrame(record.address, { interfaceVersion: HOST_INTERFACE_VERSION,
      minor: HOST_INTERFACE_MINOR, requestId: randomUUID(), action,
      expectedGeneration: record.generation, params, ...(capability ? { capability } : {}) },
    { timeoutMs, signal: options.signal })
  }, close() {} }
}
