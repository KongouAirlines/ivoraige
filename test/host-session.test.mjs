import test from 'node:test'
import assert from 'node:assert/strict'
import { createHostSession } from '../src/host-session.mjs'

// Model browser cookie lookup: the storage key is host, path and name,
// deliberately not the port or this application's data domain.
function browserJar() {
  const stored = new Map()
  return {
    accept(origin, setCookie) {
      const url = new URL(origin)
      const [pair, ...attributes] = setCookie.split(';').map(part => part.trim())
      const [name, value] = pair.split('=')
      assert.ok(!attributes.some(part => part.startsWith('Domain=')))
      assert.ok(attributes.includes('Path=/'))
      assert.ok(attributes.includes('HttpOnly'))
      assert.ok(attributes.includes('SameSite=Strict'))
      if (name.startsWith('__Host-')) assert.ok(url.protocol === 'https:' && attributes.includes('Secure'))
      stored.set(`${url.hostname}|/|${name}`, value)
    },
    header(origin) {
      const url = new URL(origin)
      return [...stored].filter(([key]) => key.startsWith(`${url.hostname}|/|`))
        .map(([key, value]) => `${key.split('|')[2]}=${value}`).join('; ')
    }
  }
}

const make = (overrides = {}) => createHostSession({ dataDomainRef: 'domain-a', generation: 'generation-a',
  lifetime: 'resident', origin: 'http://127.0.0.1:4321', ...overrides })

test('bootstrap is origin bound, single use, and produces a strict host-only cookie', () => {
  const session = make()
  const { credential, origin } = session.issueBootstrap()
  assert.equal(origin, 'http://127.0.0.1:4321')
  assert.equal(credential.length, 43)
  assert.throws(() => session.exchange({ credential, requestOrigin: 'http://localhost:4321', host: '127.0.0.1:4321' }),
    { code: 'FORBIDDEN_HOST' })
  const browser = session.exchange({ credential, requestOrigin: origin, host: '127.0.0.1:4321' })
  assert.match(browser.setCookie, /^ivoraige_owner_[a-f0-9]{32}=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Strict$/)
  assert.doesNotMatch(browser.setCookie, /Domain=|Secure/)
  assert.equal(browser.dataDomainRef, 'domain-a')
  assert.equal(browser.generation, 'generation-a')
  assert.throws(() => session.exchange({ credential, requestOrigin: origin, host: '127.0.0.1:4321' }),
    { code: 'UNAUTHORIZED' })
  const cookie = browser.setCookie.split(';')[0]
  assert.deepEqual(session.authenticate({ cookie, host: '127.0.0.1:4321' }),
    { dataDomainRef: 'domain-a', generation: 'generation-a' })
  assert.throws(() => session.authenticate({ cookie, host: 'localhost:4321' }), { code: 'FORBIDDEN_HOST' })
  assert.throws(() => session.authenticate({ cookie, host: '127.0.0.1:4321', method: 'POST', requestOrigin: origin }),
    { code: 'FORBIDDEN_HOST' })
  assert.deepEqual(session.authenticate({ cookie, host: '127.0.0.1:4321', method: 'POST',
    requestOrigin: origin, csrfToken: browser.csrfToken }), { dataDomainRef: 'domain-a', generation: 'generation-a' })
  session.revokeAll()
  assert.throws(() => session.authenticate({ cookie, host: '127.0.0.1:4321' }), { code: 'UNAUTHORIZED' })
  assert.throws(() => session.issueBootstrap(), { code: 'PRECONDITION_FAILED' })
})

test('expired bootstrap, temporary owner and released owner cannot issue sessions', () => {
  let now = 1000
  const session = make({ now: () => now })
  const { credential } = session.issueBootstrap()
  now += 60_000
  assert.throws(() => session.exchange({ credential, requestOrigin: session.origin, host: '127.0.0.1:4321' }),
    { code: 'UNAUTHORIZED' })
  const temporary = make({ lifetime: 'ephemeral' })
  assert.throws(() => temporary.issueBootstrap(), { code: 'CONFLICT' })
  let held = true
  const released = make({ isOwnerHeld: () => held })
  const browser = released.issueBootstrap()
  held = false
  assert.throws(() => released.exchange({ credential: browser.credential, requestOrigin: released.origin,
    host: '127.0.0.1:4321' }), { code: 'PRECONDITION_FAILED' })
})

test('HTTPS cookie is Secure and untrusted origins are rejected', () => {
  const session = make({ origin: 'https://example.test' })
  const bootstrap = session.issueBootstrap()
  const browser = session.exchange({ credential: bootstrap.credential,
    requestOrigin: session.origin, host: 'example.test' })
  assert.match(browser.setCookie, /^__Host-ivoraige_owner_[a-f0-9]{32}=.*; Path=\/; HttpOnly; SameSite=Strict; Secure$/)
  assert.throws(() => make({ origin: 'http://example.test' }), { code: 'FORBIDDEN_HOST' })
  assert.throws(() => make({ origin: 'http://127.0.0.1:4321/path' }), { code: 'FORBIDDEN_HOST' })
})

test('browser cookies retain two data domains on the same host across different ports', () => {
  const first = make({ dataDomainRef: 'domain-a', origin: 'http://127.0.0.1:4321' })
  const second = make({ dataDomainRef: 'domain-b', origin: 'http://127.0.0.1:4322' })
  const jar = browserJar()
  for (const session of [first, second]) {
    const bootstrap = session.issueBootstrap()
    jar.accept(session.origin, session.exchange({ credential: bootstrap.credential,
      requestOrigin: session.origin, host: new URL(session.origin).host }).setCookie)
  }
  assert.notEqual(first.cookieName, second.cookieName)
  const header = jar.header(first.origin)
  assert.equal(header, jar.header(second.origin)) // browser sends both names to both ports
  assert.equal(header.split('; ').length, 2)
  assert.deepEqual(first.authenticate({ cookie: header, host: '127.0.0.1:4321' }),
    { dataDomainRef: 'domain-a', generation: 'generation-a' })
  assert.deepEqual(second.authenticate({ cookie: header, host: '127.0.0.1:4322' }),
    { dataDomainRef: 'domain-b', generation: 'generation-a' })
  assert.notEqual(first.cookieName, make({ dataDomainRef: 'domain-b', origin: first.origin }).cookieName)
})

test('CSRF refresh requires the complete Origin and does not rotate on a missing or foreign Origin', () => {
  const session = make()
  const { credential } = session.issueBootstrap()
  const browser = session.exchange({ credential, requestOrigin: session.origin, host: '127.0.0.1:4321' })
  const cookie = browser.setCookie.split(';')[0]
  for (const requestOrigin of [undefined, 'http://127.0.0.1:4322', 'http://localhost:4321']) {
    assert.throws(() => session.refreshCsrf({ cookie, host: '127.0.0.1:4321', requestOrigin, method: 'POST' }),
      { code: 'FORBIDDEN_HOST' })
    assert.deepEqual(session.authenticate({ cookie, host: '127.0.0.1:4321',
      requestOrigin: session.origin, method: 'POST', csrfToken: browser.csrfToken }),
    { dataDomainRef: 'domain-a', generation: 'generation-a' })
  }
  assert.throws(() => session.refreshCsrf({ cookie, host: '127.0.0.1:4321',
    requestOrigin: session.origin, method: 'GET' }), { code: 'FORBIDDEN_HOST' })
  const next = session.refreshCsrf({ cookie, host: '127.0.0.1:4321', requestOrigin: session.origin,
    method: 'POST' })
  assert.notEqual(next.csrfToken, browser.csrfToken)
  assert.throws(() => session.authenticate({ cookie, host: '127.0.0.1:4321',
    requestOrigin: session.origin, method: 'POST', csrfToken: browser.csrfToken }), { code: 'FORBIDDEN_HOST' })
})

test('bootstrap expiry pruning and deterministic admission caps bound resident state', () => {
  let clock = 1000
  const session = make({ now: () => clock, bootstrapTtlMs: 10, maxBootstraps: 2, maxSessions: 2 })
  const first = session.issueBootstrap()
  const second = session.issueBootstrap()
  const third = session.issueBootstrap() // evicts first
  const redeem = credential => session.exchange({ credential, requestOrigin: session.origin, host: '127.0.0.1:4321' })
  assert.throws(() => redeem(first.credential), { code: 'UNAUTHORIZED' })
  const oldSession = redeem(second.credential)
  const middleSession = redeem(third.credential)
  const fourth = session.issueBootstrap()
  const newestSession = redeem(fourth.credential) // evicts oldest session
  const cookie = response => response.setCookie.split(';')[0]
  assert.throws(() => session.authenticate({ cookie: cookie(oldSession), host: '127.0.0.1:4321' }),
    { code: 'UNAUTHORIZED' })
  assert.deepEqual(session.authenticate({ cookie: cookie(middleSession), host: '127.0.0.1:4321' }),
    { dataDomainRef: 'domain-a', generation: 'generation-a' })
  assert.deepEqual(session.authenticate({ cookie: cookie(newestSession), host: '127.0.0.1:4321' }),
    { dataDomainRef: 'domain-a', generation: 'generation-a' })
  const expiring = session.issueBootstrap()
  clock += 10
  session.issueBootstrap() // prunes expired grant before admission
  assert.throws(() => redeem(expiring.credential), { code: 'UNAUTHORIZED' })
})
