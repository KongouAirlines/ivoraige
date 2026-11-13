import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { KernelError } from './errors.mjs'

const digest = value => createHash('sha256').update(value).digest()
const secret = () => randomBytes(32).toString('base64url')
const tokenPattern = /^[A-Za-z0-9_-]{40,128}$/
const authError = () => new KernelError('UNAUTHORIZED', 'Owner authorization required',
  { reason: 'owner-authentication-required' })
const forbidden = () => new KernelError('FORBIDDEN_HOST', 'Owner origin or CSRF check failed',
  { reason: 'owner-permission-denied' })

function validOrigin(value) {
  if (typeof value !== 'string' || value.length > 2048) throw forbidden()
  let url
  try { url = new URL(value) } catch { throw forbidden() }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw forbidden()
  // Plain HTTP is only acceptable on the host itself. A remote management
  // page needs HTTPS before an owner credential may be issued to a browser.
  if (url.protocol === 'http:' && !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) throw forbidden()
  return url
}

function validHost(origin, host) {
  if (typeof host !== 'string' || host !== new URL(origin).host) throw forbidden()
}

function constantEqual(a, b) {
  return Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.length === b.length && timingSafeEqual(a, b)
}

function cookieValue(header, name) {
  if (typeof header !== 'string' || header.length > 8192) throw authError()
  const matches = header.split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`))
  if (matches.length !== 1) throw authError()
  const value = matches[0].slice(name.length + 1)
  if (!tokenPattern.test(value)) throw authError()
  return value
}

// Browser credentials are per-process only. The local owner transport is the
// sole issuer; the HTTP exchange endpoint may only call exchange(). The
// current kernel's wire names are UNAUTHORIZED/FORBIDDEN_HOST (401/403), which
// represent HostControl's AUTHENTICATION_REQUIRED/PERMISSION_DENIED semantics.
export function createHostSession({ dataDomainRef, generation, lifetime, origin,
  now = () => Date.now(), isOwnerHeld = () => true, bootstrapTtlMs = 60_000,
  maxBootstraps = 64, maxSessions = 64 } = {}) {
  if (!dataDomainRef || !generation || !['resident', 'ephemeral'].includes(lifetime) ||
    !Number.isInteger(bootstrapTtlMs) || bootstrapTtlMs < 1 || bootstrapTtlMs > 60_000 ||
    !Number.isInteger(maxBootstraps) || maxBootstraps < 1 || maxBootstraps > 1024 ||
    !Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 1024)
    throw new KernelError('INVALID_ARGUMENT', 'Invalid owner session configuration')
  const url = validOrigin(origin)
  // Cookie scope ignores ports, so distinct owners on one loopback host need
  // distinct names even when their sessions use separate HTTP origins.
  const scope = createHash('sha256').update(JSON.stringify([dataDomainRef, url.origin])).digest('hex').slice(0, 32)
  const name = `${url.protocol === 'https:' ? '__Host-' : ''}ivoraige_owner_${scope}`
  const bootstraps = new Map()
  const sessions = new Map()
  let revoked = false

  function mayIssue() {
    if (revoked || lifetime !== 'resident' || !isOwnerHeld()) throw new KernelError(
      lifetime === 'ephemeral' ? 'CONFLICT' : 'PRECONDITION_FAILED',
      'This owner cannot issue a browser session', { reason: lifetime === 'ephemeral' ? 'temporary-owner' : 'owner-unavailable' })
  }

  function issueBootstrap() {
    mayIssue()
    // A resident owner can run indefinitely. Do not retain unused grants or
    // sessions for its entire lifetime; Map order makes eviction predictable.
    for (const [hash, expiry] of bootstraps) if (expiry <= now()) bootstraps.delete(hash)
    while (bootstraps.size >= maxBootstraps) bootstraps.delete(bootstraps.keys().next().value)
    const credential = secret()
    bootstraps.set(digest(credential).toString('hex'), now() + bootstrapTtlMs)
    return { credential, origin: url.origin, dataDomainRef, generation, expiresInMs: bootstrapTtlMs }
  }

  function exchange({ credential, requestOrigin, host } = {}) {
    mayIssue()
    validHost(url.origin, host)
    if (requestOrigin !== url.origin || typeof credential !== 'string' || !tokenPattern.test(credential)) throw forbidden()
    const hash = digest(credential).toString('hex')
    const expiry = bootstraps.get(hash)
    if (expiry === undefined) throw authError()
    // Delete synchronously before issuing a session: concurrent exchanges
    // cannot consume the same bootstrap credential twice.
    bootstraps.delete(hash)
    if (expiry <= now()) throw authError()
    const sessionId = secret()
    const csrfToken = secret()
    while (sessions.size >= maxSessions) sessions.delete(sessions.keys().next().value)
    sessions.set(digest(sessionId).toString('hex'), { csrfHash: digest(csrfToken), dataDomainRef, generation })
    const attributes = ['Path=/', 'HttpOnly', 'SameSite=Strict']
    if (url.protocol === 'https:') attributes.push('Secure')
    return { setCookie: `${name}=${sessionId}; ${attributes.join('; ')}`, csrfToken,
      dataDomainRef, generation }
  }

  function authenticate({ cookie, requestOrigin, host, csrfToken, method = 'GET' } = {}) {
    if (revoked || !isOwnerHeld()) throw authError()
    validHost(url.origin, host)
    if (requestOrigin !== undefined && requestOrigin !== url.origin) throw forbidden()
    const id = cookieValue(cookie, name)
    const session = sessions.get(digest(id).toString('hex'))
    if (!session) throw authError()
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(method)
    if (write && (requestOrigin !== url.origin || typeof csrfToken !== 'string' ||
      !tokenPattern.test(csrfToken) || !constantEqual(session.csrfHash, digest(csrfToken)))) throw forbidden()
    return { dataDomainRef: session.dataDomainRef, generation: session.generation }
  }

  function refreshCsrf({ cookie, requestOrigin, host, method } = {}) {
    // Refresh changes server state. A cookie-only GET from another loopback
    // port must not invalidate the legitimate page's CSRF token.
    if (method !== 'POST' || requestOrigin !== url.origin) throw forbidden()
    const identity = authenticate({ cookie, requestOrigin, host })
    const id = cookieValue(cookie, name)
    const session = sessions.get(digest(id).toString('hex'))
    const csrfToken = secret()
    session.csrfHash = digest(csrfToken)
    return { ...identity, csrfToken }
  }

  function revokeAll() { revoked = true; bootstraps.clear(); sessions.clear() }

  return { issueBootstrap, exchange, authenticate, refreshCsrf, revokeAll,
    get cookieName() { return name }, get origin() { return url.origin } }
}
