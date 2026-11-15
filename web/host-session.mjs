let csrfToken = null

function takeFragment(location, history) {
  if (!location.hash.startsWith('#owner=')) return null
  const credential = location.hash.slice('#owner='.length)
  // Remove the fragment before any request or UI initialization. It never
  // enters a query string, storage, Referer, diagnostic, or browser history.
  history.replaceState(history.state, '', `${location.pathname}${location.search}`)
  return /^[A-Za-z0-9_-]{43}$/.test(credential) ? credential : ''
}

export async function bootstrapOwnerSession({ location = globalThis.location,
  history = globalThis.history, fetchImpl = globalThis.fetch } = {}) {
  csrfToken = null
  let credential
  try {
    credential = takeFragment(location, history)
    if (credential === '') return { authorized: false }
    const response = credential !== null
      ? await fetchImpl('/api/host/session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }), credentials: 'same-origin', cache: 'no-store' })
      : await fetchImpl('/api/host/session/refresh', { method: 'POST', credentials: 'same-origin', cache: 'no-store' })
    credential = null
    if (!response.ok) return { authorized: false }
    const result = await response.json()
    if (typeof result.csrfToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.csrfToken))
      return { authorized: false }
    csrfToken = result.csrfToken
    return { authorized: true, dataDomainRef: result.dataDomainRef, generation: result.generation }
  } catch { return { authorized: false } }
}

export async function ownerFetch(url, options = {}) {
  const target = new URL(url, globalThis.location.origin)
  if (target.origin !== globalThis.location.origin || !target.pathname.startsWith('/api/'))
    throw new Error('Owner request must remain on this page origin')
  const method = options.method ?? 'GET'
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
  if (write && !csrfToken) throw new Error('本机管理会话未授权，请重新打开启动器提供的页面。')
  const headers = new Headers(options.headers)
  if (write) headers.set('X-Ivoraige-CSRF', csrfToken)
  const send = () => fetch(url, { ...options, method, headers, credentials: 'same-origin', cache: 'no-store' })
  let response = await send()
  // Another tab can refresh the shared session or pair a replacement cookie.
  // Retry once only when HTTP authentication rejected the request before any
  // business dispatch. Never retry a business failure or a consumed stream.
  if (write && response.status === 403 && response.headers.get('X-Ivoraige-CSRF-Refresh') === 'required' &&
      !(typeof ReadableStream !== 'undefined' && options.body instanceof ReadableStream)) {
    const refreshed = await fetch('/api/host/session/refresh', { method: 'POST',
      credentials: 'same-origin', cache: 'no-store', signal: options.signal })
    if (refreshed.ok) {
      const result = await refreshed.json()
      if (typeof result.csrfToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(result.csrfToken)) {
        csrfToken = result.csrfToken
        headers.set('X-Ivoraige-CSRF', csrfToken)
        response = await send()
      }
    } else if (refreshed.status === 401) response = refreshed
  }
  // A denied write is not proof that the cookie/owner is gone. Preserve the
  // mounted editor (and unsaved edits) even if a second refresh race occurs.
  if (response.status === 401) {
    csrfToken = null
    globalThis.window?.dispatchEvent(new Event('ivoraige:owner-lost'))
  }
  return response
}

export function clearOwnerSession() { csrfToken = null }
