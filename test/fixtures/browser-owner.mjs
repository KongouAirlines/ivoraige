// Existing UI behavior tests run after a successful owner session exchange.
// Pairing failure and anonymous rendering have separate security tests.
export function mockOwnerSession(window) {
  window.Headers = globalThis.Headers
  const fetchBusiness = window.fetch
  window.fetch = (url, options) => String(url) === '/api/host/session'
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({
      csrfToken: 'a'.repeat(43), dataDomainRef: 'test-domain', generation: 'test-generation',
    }) })
    : fetchBusiness(url, options)
}
