import { performance } from 'node:perf_hooks'
import { KernelError } from './errors.mjs'

export class HostDeadline {
  constructor(budgetMs, now = () => performance.now()) {
    // A monotonic deadline is also used by internal service disposal. Its
    // budget is not a HostControl request and may be zero, fractional or
    // longer than the public request's two-minute maximum.
    if (typeof budgetMs !== 'number' || !Number.isFinite(budgetMs) ||
        budgetMs < 0 || budgetMs > Number.MAX_SAFE_INTEGER)
      throw new RangeError('Deadline budget must be a finite nonnegative number of milliseconds')
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
  // Attach a rejection observer before checking the budget. An already
  // expired caller still owns and may retry/join the underlying operation.
  const work = Promise.resolve(promise)
  work.catch(() => {})
  if (deadline.expired()) throw deadlineExceeded()
  let timer
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      const check = () => {
        if (deadline.expired()) reject(deadlineExceeded())
        else timer = setTimeout(check, Math.min(deadline.remainingMs(), 2_147_483_647))
      }
      // Node otherwise clamps an oversized timer to 1 ms. Recheck long
      // internal budgets in bounded chunks without shortening the deadline.
      timer = setTimeout(check, Math.min(deadline.remainingMs(), 2_147_483_647))
    })])
  } finally { clearTimeout(timer) }
}
