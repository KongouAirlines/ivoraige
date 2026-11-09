import test from 'node:test'
import assert from 'node:assert/strict'
import { createHostSession } from '../src/host-session.mjs'

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
  assert.match(browser.setCookie, /^ivoraige_owner=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Strict$/)
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
  const refreshed = session.refreshCsrf({ cookie, host: '127.0.0.1:4321' })
  assert.notEqual(refreshed.csrfToken, browser.csrfToken)
  assert.throws(() => session.authenticate({ cookie, host: '127.0.0.1:4321', method: 'POST',
    requestOrigin: origin, csrfToken: browser.csrfToken }), { code: 'FORBIDDEN_HOST' })
  assert.deepEqual(session.authenticate({ cookie, host: '127.0.0.1:4321', method: 'POST',
    requestOrigin: origin, csrfToken: refreshed.csrfToken }), { dataDomainRef: 'domain-a', generation: 'generation-a' })
  session.revokeAll()
  assert.throws(() => session.authenticate({ cookie, host: '127.0.0.1:4321' }), { code: 'UNAUTHORIZED' })
  assert.throws(() => session.issueBootstrap(), { code: 'CONFLICT' })
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
    host: '127.0.0.1:4321' }), { code: 'CONFLICT' })
})

test('HTTPS cookie is Secure and untrusted origins are rejected', () => {
  const session = make({ origin: 'https://example.test' })
  const bootstrap = session.issueBootstrap()
  const browser = session.exchange({ credential: bootstrap.credential,
    requestOrigin: session.origin, host: 'example.test' })
  assert.match(browser.setCookie, /^__Host-ivoraige_owner=.*; Path=\/; HttpOnly; SameSite=Strict; Secure$/)
  assert.throws(() => make({ origin: 'http://example.test' }), { code: 'FORBIDDEN_HOST' })
  assert.throws(() => make({ origin: 'http://127.0.0.1:4321/path' }), { code: 'FORBIDDEN_HOST' })
})
