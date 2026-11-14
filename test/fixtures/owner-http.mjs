import { serve as listen } from '../../src/http.mjs'

// Legacy business-protocol fixtures run under an explicit trusted owner
// controller. This bypass is test-only: production's HTTP entry never has an
// anonymous fallback. host-http-auth.test.mjs covers the real pairing path.
export function serve(app, options = {}) {
  const authorized = new Proxy(app, {
    get(target, key, receiver) {
      if (key === 'host') return undefined
      return Reflect.get(target, key, receiver)
    },
  })
  return listen(authorized, { mcp: true, authorizeOwner: () => true, ...options })
}
