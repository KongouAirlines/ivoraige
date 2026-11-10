import test from 'node:test'
import assert from 'node:assert/strict'
import { serve } from '../src/http.mjs'
import { createHostSession } from '../src/host-session.mjs'
import { bootstrapOwnerSession, clearOwnerSession } from '../web/host-session.mjs'

function ownerApp() {
  let session
  const state = { dataDomainRef: 'domain-a', generation: 'generation-a', lifetime: 'resident',
    state: 'ready', storeOwnership: 'held', acceptingBusiness: true }
  const host = { lifetime: 'resident', generation: 'generation-a', dataDomainRef: 'domain-a',
    get session() { return session },
    bindHttp(origin) { session = createHostSession({ dataDomainRef: 'domain-a', generation: 'generation-a',
      lifetime: 'resident', origin, isOwnerHeld: () => state.storeOwnership === 'held' }) },
    browserBootstrap() { return session.issueBootstrap() },
    handleControl(action, params) { return action === 'state' ? state : { accepted: true,
      generation: 'generation-a', operationId: 'op-a', action, params } } }
  return { host, operations: { invoke: async () => ({ ok: true }) }, state }
}

test('HTTP refuses ephemeral and anonymous caller-owned facades before listen', async () => {
  await assert.rejects(serve({ operations: {} }, { port: 0 }), { code: 'UNAUTHORIZED' })
  await assert.rejects(serve({ host: { lifetime: 'ephemeral' } }, { port: 0 }), { code: 'CONFLICT' })
})

test('browser removes owner fragment before exchange and keeps CSRF in memory', async () => {
  const token = 'a'.repeat(43)
  const location = { hash: `#owner=${token}`, pathname: '/', search: '?view=1' }
  const history = { state: { screen: 1 }, replaceState(state, title, url) {
    assert.deepEqual(state, { screen: 1 })
    assert.equal(url, '/?view=1')
    location.hash = ''
  } }
  const calls = []
  const result = await bootstrapOwnerSession({ location, history,
    fetchImpl: async (path, options) => {
      assert.equal(location.hash, '')
      calls.push({ path, options })
      return { ok: true, json: async () => ({ csrfToken: 'b'.repeat(43),
        dataDomainRef: 'domain-a', generation: 'generation-a' }) }
    } })
  assert.equal(result.authorized, true)
  assert.equal(calls[0].path, '/api/host/session')
  assert.equal(JSON.parse(calls[0].options.body).credential, token)
  assert.equal(calls[0].options.credentials, 'same-origin')
  clearOwnerSession()
})

test('HTTP private routes require paired owner cookie and CSRF', async t => {
  const app = ownerApp()
  let server
  try {
    try { server = await serve(app, { port: 0, instance: { id: 'public-id' } }) }
    catch (error) {
      if (!process.env.CI && ['EPERM', 'EACCES'].includes(error.code)) {
        t.skip('Local sandbox does not permit loopback listening'); return
      }
      throw error
    }
    const origin = server.url
    const request = (path, options = {}) => fetch(`${origin}${path}`, { cache: 'no-store', ...options })
    for (const path of ['/api/instance', '/api/host/state?expectedGeneration=generation-a',
      '/api/events', '/api/events/state', '/api/state', '/api/operations',
      '/api/artifacts/one/download', '/mcp']) {
      assert.equal((await request(path)).status, 401, path)
    }
    for (const path of ['/api/components/install', '/api/components/local',
      '/api/operations/componentInstall', '/api/host-control']) {
      assert.equal((await request(path, { method: 'POST', headers: { Origin: origin,
        'Content-Type': 'application/json' }, body: '{}' })).status, 401, path)
    }
    const credential = app.host.browserBootstrap().credential
    assert.equal((await request('/api/host/session', { method: 'POST', headers: { Origin: 'http://localhost:55',
      'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) })).status, 403)
    const exchanged = await request('/api/host/session', { method: 'POST', headers: { Origin: origin,
      'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) })
    assert.equal(exchanged.status, 200)
    const cookie = exchanged.headers.get('set-cookie').split(';')[0]
    const { csrfToken } = await exchanged.json()
    assert.equal((await request('/api/host/session', { method: 'POST', headers: { Origin: origin,
      'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) })).status, 401)
    assert.equal((await request('/api/host/state?expectedGeneration=generation-a',
      { headers: { Cookie: cookie } })).status, 200)
    assert.equal((await request('/api/instance', { headers: { Cookie: cookie } })).status, 200)
    assert.equal((await request('/api/host/drain', { method: 'POST', headers: { Cookie: cookie, Origin: origin,
      'Content-Type': 'application/json' }, body: JSON.stringify({ expectedGeneration: 'generation-a',
      budgetMs: 100 }) })).status, 403)
    assert.equal((await request('/api/host/drain', { method: 'POST', headers: { Cookie: cookie, Origin: origin,
      'X-Ivoraige-CSRF': csrfToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedGeneration: 'generation-a', budgetMs: 100 }) })).status, 200)
    assert.equal((await request('/api/host/state?expectedGeneration=wrong',
      { headers: { Cookie: cookie } })).status, 409)
    assert.equal((await request('/api/host/session/refresh', { method: 'POST',
      headers: { Cookie: cookie } })).status, 403)
    assert.equal((await request('/api/host/session/refresh', { method: 'POST',
      headers: { Cookie: cookie, Origin: 'http://localhost:55' } })).status, 403)
    const refreshed = await request('/api/host/session/refresh', { method: 'POST',
      headers: { Cookie: cookie, Origin: origin } })
    assert.equal(refreshed.status, 200)
    const nextToken = (await refreshed.json()).csrfToken
    assert.notEqual(nextToken, csrfToken)
    assert.equal((await request('/api/host/drain', { method: 'POST', headers: { Cookie: cookie, Origin: origin,
      'X-Ivoraige-CSRF': csrfToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedGeneration: 'generation-a', budgetMs: 100 }) })).status, 403)
    app.state.storeOwnership = 'released'
    assert.equal((await request('/api/instance', { headers: { Cookie: cookie } })).status, 401)
  } finally { await server?.close() }
})

test('browser reload refreshes CSRF using same-origin POST rather than cookie-only GET', async () => {
  let calls = 0
  const result = await bootstrapOwnerSession({ location: { hash: '', pathname: '/', search: '' },
    history: {}, fetchImpl: async (path, options) => {
      calls++
      assert.equal(path, '/api/host/session/refresh')
      assert.equal(options.method, 'POST')
      assert.equal(options.credentials, 'same-origin')
      return { ok: true, json: async () => ({ csrfToken: 'c'.repeat(43), dataDomainRef: 'd', generation: 'g' }) }
    } })
  assert.equal(calls, 1)
  assert.equal(result.authorized, true)
  clearOwnerSession()
})
