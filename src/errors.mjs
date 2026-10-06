export class KernelError extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message, options)
    this.name = 'KernelError'
    this.code = code
    this.details = details
  }
}
