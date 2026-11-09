import { performance } from 'node:perf_hooks'
import { KernelError } from './errors.mjs'

export class HostDeadline {
  constructor(budgetMs, now = () => performance.now()) {
    if (!Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > 120_000) {
      throw new KernelError('INVALID_ARGUMENT', 'budgetMs must be an integer from 1 to 120000',
        { reason: 'invalid-request' })
    }
    this.now = now
    this.endsAt = now() + budgetMs
  }

  remainingMs() { return Math.max(0, Math.ceil(this.endsAt - this.now())) }
  expired() { return this.endsAt <= this.now() }
}

export function deadlineExceeded() {
  return new KernelError('PRECONDITION_FAILED', 'Host operation deadline exceeded',
    { reason: 'deadline-exceeded' })
}

// Timing out a wait never cancels the underlying operation. Its owner must
// retain that promise and join it on retry before starting a dependent stage.
export async function waitForDeadline(promise, deadline) {
  if (!deadline) return promise
  if (deadline.expired()) throw deadlineExceeded()
  let timer
  try {
    return await Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
      timer = setTimeout(() => reject(deadlineExceeded()), deadline.remainingMs())
    })])
  } finally { clearTimeout(timer) }
}
