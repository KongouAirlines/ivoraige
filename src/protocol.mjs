import { reportFailure } from './diagnostics.mjs'
import { z } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'

export const API_VERSION = '2.0'
const id = z.string().min(1)
const lang = z.string().regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/).refine(value => value !== 'auto')
const document = { docId: id }
const unit = { unitId: id, targetLang: lang }
const page = { cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }
const lock = id.nullable()
const shape = fields => z.object(fields).strict()
export const parameters = {
  capabilities: shape({}),
  importDocument: shape({ path: id.optional(), contentBase64: z.string().optional(), format: z.enum(['txt', 'md']).optional(),
    title: z.string().optional(), language: lang, sourceId: id.optional(), externalRef: z.string().optional(),
    origin: z.enum(['manual', 'cli', 'mcp', 'zotero']).default('manual') }),
  listDocuments: shape({ ...page, origin: z.string().optional(), format: z.string().optional() }),
  getDocument: shape(document),
  listUnits: shape({ ...document, targetLang: lang, ...page, filter: z.enum(['all', 'untranslated', 'draft', 'accepted']).default('all') }),
  getUnit: shape(unit), listRevisions: shape({ ...unit, ...page }),
  writeRevision: shape({ ...unit, baseRevisionId: lock, text: z.string().min(1) }),
  acceptRevision: shape({ revisionId: id, expectedAcceptedRevisionId: lock }),
  unaccept: shape({ ...unit, expectedAcceptedRevisionId: lock }),
  translate: shape({ ...document, targetLang: lang, mode: z.enum(['fast', 'careful']).default('fast'),
    unitIds: z.array(id).optional() }),
  exportDocument: shape({ ...document, targetLang: lang, outputs: z.array(shape({ format: z.string().regex(/^[a-z][a-z0-9-]*$/), out: id.optional() })).min(1),
    snapshotId: id.optional(), onMissingAccepted: z.enum(['fail', 'skip']).optional() }),
  listArtifacts: shape({ ...document, ...page }), listSnapshots: shape({ ...document, ...page, targetLang: lang.optional() }),
  getSnapshot: shape({ ...document, snapshotId: id }), deleteSnapshot: shape({ ...document, snapshotId: id }),
  listTasks: shape({ ...page, docId: id.optional(), state: z.enum(['queued', 'running', 'paused', 'succeeded', 'failed', 'canceled']).optional(),
    kind: z.enum(['import', 'translate', 'export']).optional() }),
  getTask: shape({ taskId: id, waitSeconds: z.coerce.number().min(0).max(60).optional() }),
  pauseTask: shape({ taskId: id }), resumeTask: shape({ taskId: id }), cancelTask: shape({ taskId: id }),
  getSettings: shape({}), updateSettings: z.record(z.string(), z.unknown()),
  setCredential: shape({ ref: id, value: z.string().min(1) }),
}

export function validate(name, value) {
  if (!parameters[name]) throw new KernelError('NOT_FOUND', 'Operation not found', { operation: name })
  const result = parameters[name].safeParse(value)
  if (!result.success) throw new KernelError('INVALID_ARGUMENT', 'Invalid operation parameters', {
    issues: result.error.issues.map(issue => ({ path: issue.path, message: issue.message })),
  })
  return result.data
}
export const serialize = value => JSON.stringify(value)
export function errorEnvelope(error) {
  const statuses = { INVALID_ARGUMENT: 400, UNAUTHORIZED: 401, FORBIDDEN_HOST: 403, NOT_FOUND: 404,
    CONFLICT: 409, PRECONDITION_FAILED: 412, UPSTREAM_FAILURE: 502, COMPONENT_MISSING: 503, INTERNAL: 500 }
  const code = error instanceof KernelError && statuses[error.code] ? error.code : 'INTERNAL'
  const canceled = error?.details?.canceled === true
  const traceId = code === 'INTERNAL' ? reportFailure(error) : undefined
  const details = traceId ? { traceId, ...(canceled ? { canceled: true } : {}) } : error?.details ?? {}
  const status = statuses[code]
  return { status, body: { apiVersion: API_VERSION, error: { code,
    message: code === 'INTERNAL' ? 'Internal operation failed' : error.message, details } },
    exitCode: details.canceled ? 5 : status < 404 ? 2 : status < 500 || status === 503 ? 3 : 4 }
}

export function paginate(items, { cursor, limit = 100 }) {
  let start = 0
  if (cursor !== undefined) {
    try {
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
      if (!Number.isSafeInteger(value.offset) || value.offset < 0) throw new Error()
      start = value.offset
    } catch { throw new KernelError('INVALID_ARGUMENT', 'Invalid pagination cursor') }
  }
  const next = start + limit
  return { items: items.slice(start, next), ...(next < items.length ?
    { nextCursor: Buffer.from(JSON.stringify({ offset: next })).toString('base64url') } : {}) }
}

export function taskView(task) {
  const { mode, unitIds, checkpoints, profileId, outputs, ...view } = task
  return view
}
