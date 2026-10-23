import { KernelError } from './errors.mjs'

const terminal = new Set(['completed', 'failed', 'killed'])

// A provider's per-call wait timeout is not a total deadline. Bound both
// repeated nonterminal replies and a provider that never answers at all.
export async function waitForJob(jobs, taskId, timeoutMs = 30_000) {
  const deadline = performance.now() + timeoutMs
  const controller = new AbortController()
  let timer
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new KernelError('UPSTREAM_FAILURE', 'Background job did not settle before the wait deadline', { taskId }))
    }, timeoutMs)
  })
  const waiting = async () => {
    while (!controller.signal.aborted) {
      const remaining = deadline - performance.now()
      if (remaining <= 0) throw new KernelError('UPSTREAM_FAILURE', 'Background job did not settle before the wait deadline', { taskId })
      const job = await jobs.wait(taskId, remaining, undefined, controller.signal)
      if (terminal.has(job.status)) return job
      // Yield even if a broken provider answers nonterminal synchronously.
      await new Promise(resolve => setTimeout(resolve, Math.min(10, remaining)))
    }
  }
  try { return await Promise.race([expired, waiting()]) }
  finally { clearTimeout(timer); controller.abort() }
}
