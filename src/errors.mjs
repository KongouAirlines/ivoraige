export class KernelError extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message, options)
    this.name = 'KernelError'
    this.code = code
    this.details = details
  }
}

export const ERROR_STATUSES = Object.freeze({
  INVALID_ARGUMENT: 400, UNAUTHORIZED: 401, FORBIDDEN_HOST: 403, NOT_FOUND: 404,
  CONFLICT: 409, PRECONDITION_FAILED: 412, UPSTREAM_FAILURE: 502,
  COMPONENT_MISSING: 503, INTERNAL: 500,
})

// INTERNAL intentionally hides details at the protocol boundary. Partial-save
// responses need a public code so clients can see their recovery marker.
export const isPublicErrorCode = code => Object.hasOwn(ERROR_STATUSES, code) && code !== 'INTERNAL'
