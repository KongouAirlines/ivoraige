import { randomUUID } from 'node:crypto'

// Keep diagnostic stacks on stderr, never in protocol responses. Do not inspect
// arbitrary error properties (SDK request objects may contain credentials).
export function reportFailure(error, context = {}) {
  const traceId = randomUUID()
  const seen = new Set()
  const parts = []
  for (let current = error; current && !seen.has(current); current = current.cause) {
    seen.add(current)
    parts.push(typeof current.stack === 'string' ? current.stack : String(current.message ?? current))
  }
  let diagnostic = parts.join('\nCaused by: ')
  for (const [name, value] of Object.entries(process.env)) {
    if (/key|token|secret|password/i.test(name) && value?.length >= 8) diagnostic = diagnostic.replaceAll(value, '[redacted]')
  }
  diagnostic = diagnostic.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]')
  console.error(`ivoraige failure traceId=${traceId}${context.taskId ? ` taskId=${context.taskId}` : ''}\n${diagnostic}`)
  return traceId
}
