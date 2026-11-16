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
    try { server = await serve(app, { port: 0 }) }
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
    const control = (action, params = {}, token = csrfToken, generation = 'generation-a') =>
      request('/api/host-control', { method: 'POST', headers: { Cookie: cookie, Origin: origin,
        ...(token ? { 'X-Ivoraige-CSRF': token } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify({ interfaceVersion: 'HostControl@1', minor: 0, requestId: 'test-request',
          action, expectedGeneration: generation, params }) })
    const missingCsrf = await control('state', {}, null)
    assert.equal(missingCsrf.status, 403)
    assert.equal(missingCsrf.headers.get('X-Ivoraige-CSRF-Refresh'), 'required')
    const foreign = await request('/api/host-control', { method: 'POST',
      headers: { Cookie: cookie, Origin: 'http://localhost:55' }, body: '{}' })
    assert.equal(foreign.status, 403)
    assert.equal(foreign.headers.get('X-Ivoraige-CSRF-Refresh'), null)
    const state = await control('state')
    assert.equal(state.status, 200)
    assert.equal((await state.json()).requestId, 'test-request')
    assert.equal((await control('drain', { budgetMs: 100 })).status, 200)
    assert.equal((await control('state', {}, csrfToken, 'wrong')).status, 409)
    assert.equal((await request('/api/host/state', { headers: { Cookie: cookie } })).status, 404)
    assert.equal((await request('/api/instance', { headers: { Cookie: cookie } })).status, 404)
    assert.equal((await request('/api/host/session/refresh', { method: 'POST',
      headers: { Cookie: cookie } })).status, 403)
    assert.equal((await request('/api/host/session/refresh', { method: 'POST',
      headers: { Cookie: cookie, Origin: 'http://localhost:55' } })).status, 403)
    const refreshed = await request('/api/host/session/refresh', { method: 'POST',
      headers: { Cookie: cookie, Origin: origin } })
    assert.equal(refreshed.status, 200)
    const nextToken = (await refreshed.json()).csrfToken
    assert.notEqual(nextToken, csrfToken)
    assert.equal((await control('drain', { budgetMs: 100 })).status, 403)
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

test('independent browser pages recover rotating CSRF and re-pairing without replaying business failures', async t => {
  const app = ownerApp()
  let invocations = 0
  app.operations.invoke = async () => {
    invocations++
    return { ok: true }
  }
  let server
  try { server = await serve(app, { port: 0 }) }
  catch (error) {
    if (!process.env.CI && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('Local sandbox does not permit loopback listening'); return
    }
    throw error
  }
  const original = { fetch: globalThis.fetch, location: globalThis.location, window: globalThis.window }
  let cookie = '', lost = 0
  const origin = server.url
  const browserFetch = async (path, options = {}) => {
    const headers = new Headers(options.headers)
    headers.set('Origin', origin)
    if (cookie) headers.set('Cookie', cookie)
    const response = await original.fetch(new URL(path, origin), { ...options, headers })
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0]
    return response
  }
  globalThis.fetch = browserFetch
  globalThis.location = { origin }
  globalThis.window = { dispatchEvent() { lost++ } }
  try {
    // Distinct module instances model two independent page-memory contexts.
    const pageA = await import('../web/host-session.mjs?page=A')
    const pageB = await import('../web/host-session.mjs?page=B')
    const start = async (page, credential = null) => {
      const location = { hash: credential ? `#owner=${credential}` : '', pathname: '/', search: '' }
      return page.bootstrapOwnerSession({ location, history: { replaceState() { location.hash = '' } },
        fetchImpl: browserFetch })
    }
    assert.equal((await start(pageA, app.host.browserBootstrap().credential)).authorized, true)
    assert.equal((await start(pageB)).authorized, true)
    const write = page => page.ownerFetch('/api/components/catalog', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: '{}' })
    for (const page of [pageA, pageB, pageA, pageB]) assert.equal((await write(page)).status, 200)
    assert.equal(invocations, 4)
    // Launching a newly paired page changes the shared cookie as well.
    assert.equal((await start(pageB, app.host.browserBootstrap().credential)).authorized, true)
    assert.equal((await write(pageA)).status, 200)
    assert.equal((await write(pageB)).status, 200)
    assert.equal(invocations, 6)
    // Deliberately use the same public error reason from inside an operation:
    // only the HTTP authentication boundary adds the replay permission header.
    const { KernelError } = await import('../src/errors.mjs')
    app.operations.invoke = async () => { invocations++; throw new KernelError('FORBIDDEN_HOST',
      'Business denied', { reason: 'owner-csrf-stale' }) }
    assert.equal((await write(pageB)).status, 403)
    assert.equal(invocations, 7)
    assert.equal(lost, 0)
    app.state.storeOwnership = 'released'
    assert.equal((await write(pageB)).status, 401)
    assert.equal(lost, 1)
  } finally {
    Object.assign(globalThis, original)
    await server.close()
  }
})

test('browser retries pre-dispatch CSRF failure at most once and preserves editor on a second race', async () => {
  const page = await import('../web/host-session.mjs?page=race')
  await page.bootstrapOwnerSession({ location: { hash: '', pathname: '/', search: '' }, history: {},
    fetchImpl: async () => new Response(JSON.stringify({ csrfToken: 'a'.repeat(43) })) })
  const original = { fetch: globalThis.fetch, location: globalThis.location, window: globalThis.window }
  let writes = 0, refreshes = 0, lost = 0
  globalThis.location = { origin: 'http://127.0.0.1:1234' }
  globalThis.window = { dispatchEvent() { lost++ } }
  globalThis.fetch = async path => {
    if (path.endsWith('/refresh')) {
      refreshes++
      return new Response(JSON.stringify({ csrfToken: 'b'.repeat(43) }))
    }
    writes++
    return new Response('{}', { status: 403, headers: { 'X-Ivoraige-CSRF-Refresh': 'required' } })
  }
  try {
    assert.equal((await page.ownerFetch('/api/example', { method: 'POST', body: '{}' })).status, 403)
    assert.equal(writes, 2)
    assert.equal(refreshes, 1)
    assert.equal(lost, 0)
  } finally { Object.assign(globalThis, original) }
})
