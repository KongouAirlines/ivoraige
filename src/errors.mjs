export class KernelError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'KernelError'
    this.code = code
    this.details = details
  }
}
