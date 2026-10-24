import { reportFailure } from './diagnostics.mjs'
import { z } from '../dist/dsh.mjs'
import { ERROR_STATUSES, KernelError } from './errors.mjs'

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
  componentStatus: shape({}), componentCatalog: shape({}),
  componentCredential: shape({ token: id }), componentCredentialClear: shape({}),
  componentInstall: shape({ id: z.literal('babeldoc') }),
  componentLocal: shape({ path: id }),
  componentTask: shape({ taskId: id }), componentCancel: shape({ taskId: id }),
  importDocument: shape({ path: id.optional(), contentBase64: z.string().optional(), format: id.optional(),
    adapterId: id.optional(),
    title: z.string().optional(), language: lang, sourceId: id.optional(), externalRef: z.string().optional(),
    origin: z.enum(['manual', 'cli', 'mcp', 'zotero']).default('manual') }),
  listDocuments: shape({ ...page, origin: z.string().optional(), format: z.string().optional() }),
  getDocument: shape(document),
  listUnits: shape({ ...document, targetLang: lang, ...page, filter: z.enum(['all', 'untranslated', 'draft', 'accepted']).default('all') }),
  getUnit: shape({ ...unit, docId: id.optional() }), listRevisions: shape({ ...unit, ...page }),
  writeRevision: shape({ ...unit, baseRevisionId: lock, text: z.string().min(1) }),
  acceptRevision: shape({ revisionId: id, expectedAcceptedRevisionId: lock }),
  unaccept: shape({ ...unit, expectedAcceptedRevisionId: lock }),
  translate: shape({ ...document, targetLang: lang, mode: z.enum(['fast', 'careful']).default('fast'),
    unitIds: z.array(id).optional() }),
  exportDocument: shape({ ...document, contentMode: z.enum(['source', 'accepted-translation']).optional(),
    targetLang: lang.optional(), outputs: z.array(shape({ format: z.string().regex(/^[a-z][a-z0-9-]*$/),
      adapterId: id.optional(), out: id.optional() })).min(1),
    snapshotId: id.optional(), onMissingAccepted: z.enum(['fail', 'skip']).optional() })
    .refine(value => value.contentMode === 'source' ? value.targetLang === undefined : value.targetLang !== undefined,
      { path: ['targetLang'], message: 'targetLang is required for accepted translation and forbidden for source' }),
  listArtifacts: shape({ ...document, ...page }), listSnapshots: shape({ ...document, ...page, targetLang: lang.optional() }),
  listArtifactCleanup: shape({ ...document, ...page }),
  deleteArtifact: shape({ ...document, artifactId: id, fileAction: z.enum(['retain', 'delete-owned']).default('retain') }),
  getSnapshot: shape({ ...document, snapshotId: id }), deleteSnapshot: shape({ ...document, snapshotId: id }),
  listTasks: shape({ ...page, docId: id.optional(), state: z.enum(['queued', 'running', 'paused', 'succeeded', 'failed', 'canceled', 'abandoned']).optional(),
    kind: z.enum(['import', 'translate', 'export']).optional() }),
  getTask: shape({ taskId: id, waitSeconds: z.coerce.number().min(0).max(60).optional() }),
  pauseTask: shape({ taskId: id }), resumeTask: shape({ taskId: id }), cancelTask: shape({ taskId: id }),
  abandonTask: shape({ taskId: id }),
  getSettings: shape({}), updateSettings: shape({
    provider: id, model: id,
    api: z.string().nullable().optional(), baseURL: z.string().nullable().optional(),
    credentialRef: z.string().nullable().optional(), reasoning: z.string().nullable().optional(),
    contextWindow: z.number().int().positive().nullable().optional(),
    maxTokens: z.number().int().positive().nullable().optional(),
    compat: z.unknown().optional(), reasoningEfforts: z.unknown().optional(),
    timeoutMs: z.number().int().positive().optional(),
    select: z.boolean().optional(), selectOnly: z.boolean().optional(),
    routesRevision: z.number().int().min(0).optional(),
    selectedRevision: z.number().int().min(0).optional(),
  }),
  setCredential: shape({ ref: id, value: z.string().min(1) }),
}

// Result checks protect the shared entry boundary without changing the
// existing payloads. The catalog additionally rejects non-JSON values.
const result = fields => z.object(fields).passthrough()
const anyObject = result({})
const pageResult = result({ items: z.array(z.unknown()), nextCursor: z.string().optional() })
const taskResult = result({ task: z.object({ id: id, state: z.string() }).passthrough() })
const componentTaskResult = result({ task: z.object({ taskId: id, state: z.string() }).passthrough() })
export const results = {
  capabilities: result({ features: z.array(z.string()), settingsPages: z.array(z.unknown()),
    inputFormats: z.array(z.string()), outputFormats: z.array(z.string()) }),
  componentStatus: result({ installed: anyObject.nullable(), credentialConfigured: z.boolean() }),
  componentCatalog: result({ catalog: result({ components: z.array(z.unknown()) }) }),
  componentCredential: result({ configured: z.boolean() }), componentCredentialClear: result({ configured: z.boolean() }),
  componentInstall: result({ taskId: id }), componentLocal: result({ taskId: id }),
  componentTask: componentTaskResult, componentCancel: componentTaskResult,
  importDocument: result({ taskId: id }),
  listDocuments: pageResult, getDocument: result({ document: result({ id }) }),
  listUnits: pageResult, getUnit: result({ unit: z.object({ id }).passthrough() }), listRevisions: pageResult,
  writeRevision: result({ revision: result({ id }) }), acceptRevision: result({ accepted: result({ id }) }),
  unaccept: result({ accepted: z.null() }), translate: result({ taskId: id }),
  exportDocument: result({ taskId: id, snapshotId: id }),
  listArtifacts: pageResult, listArtifactCleanup: pageResult,
  deleteArtifact: result({ recordDeleted: z.boolean(), fileDeleted: z.boolean() }),
  listSnapshots: pageResult,
  getSnapshot: result({ snapshot: result({ id }) }), deleteSnapshot: result({ deleted: z.literal(true) }),
  listTasks: pageResult, getTask: taskResult, pauseTask: taskResult,
  resumeTask: taskResult, cancelTask: taskResult, abandonTask: taskResult,
  getSettings: result({ settings: anyObject }), updateSettings: result({ settings: anyObject }),
  setCredential: result({ configured: z.boolean() }),
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
  const code = error instanceof KernelError && Object.hasOwn(ERROR_STATUSES, error.code) ? error.code : 'INTERNAL'
  const canceled = error?.details?.canceled === true
  const traceId = code === 'INTERNAL' ? reportFailure(error) : undefined
  const details = traceId ? { traceId, ...(canceled ? { canceled: true } : {}) } : error?.details ?? {}
  const status = ERROR_STATUSES[code]
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
  const { mode, unitIds, checkpoints, profileId, outputs, preparedDocId, ...view } = task
  return view
}
