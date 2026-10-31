import { readFile } from 'node:fs/promises'
import { registerTools } from './mcp-tools.mjs'
import { KernelError } from './errors.mjs'

const tools = {
  capabilities: ['capabilities', 'List installed kernel capabilities and data directory.'],
  import: ['importDocument', 'Import a document using an installed input adapter. Use path on the server or contentBase64. Returns a persistent task; some input adapters import asynchronously.'],
  documents_list: ['listDocuments', 'List imported documents.'],
  document_get: ['getDocument', 'Read document metadata and available output formats.'],
  units_list: ['listUnits', 'List source units, drafts and accepted revisions for a target language.'],
  unit_get: ['getUnit', 'Read one unit before editing or accepting a revision.'],
  revisions_list: ['listRevisions', 'Read revision history for a unit and target language.'],
  unit_update: ['writeRevision', 'Save a human revision. Supply the latest baseRevisionId (null only when none exists); re-read after CONFLICT.'],
  revision_accept: ['acceptRevision', 'Accept a revision using the current expectedAcceptedRevisionId (nullable).'],
  unit_unaccept: ['unaccept', 'Remove acceptance using the current expectedAcceptedRevisionId.'],
  translate: ['translate', 'Start translation using configured DSH model settings; may incur model usage. Returns taskId.'],
  export: ['exportDocument', 'Start export with contentMode source (no targetLang or accepted revisions needed) or accepted-translation (targetLang required), optionally from a matching saved snapshotId. Never invokes a translation model; outputs share a frozen snapshot.'],
  artifacts_list: ['listArtifacts', 'List saved artifacts; read bytes via ivoraige://artifacts/{artifactId}.'],
  artifact_cleanup_list: ['listArtifactCleanup', 'List pending or failed managed-file cleanups; retry with artifact_delete.'],
  artifact_delete: ['deleteArtifact', 'Delete an artifact record, retaining file bytes by default. fileAction=delete-owned explicitly removes a managed file.'],
  snapshots_list: ['listSnapshots', 'List frozen export snapshots.'],
  snapshot_get: ['getSnapshot', 'Read one frozen snapshot.'],
  snapshot_delete: ['deleteSnapshot', 'Delete an unreferenced snapshot; in-use snapshots are protected by the kernel.'],
  tasks_list: ['listTasks', 'List persistent document tasks.'],
  task_status: ['getTask', 'Read a persistent task, optionally waitSeconds up to 60. Use result/artifacts after success.'],
  task_pause: ['pauseTask', 'Pause a translation/export task according to kernel lifecycle rules.'],
  task_resume: ['resumeTask', 'Resume a paused persistent task. Translation can incur model usage.'],
  task_cancel: ['cancelTask', 'Explicitly cancel a persistent task. Disconnecting HTTP does not cancel it.'],
  task_abandon: ['abandonTask', 'Explicitly abandon a failed persistent task and release its resumable snapshot reference.'],

}


export const inject = ['ivoraige.mcp', 'ivoraige.operations']
export function apply(ctx) {
  registerTools(ctx, tools)
  const registry = ctx.get('ivoraige.mcp')
  const app = { operations: ctx.get('ivoraige.operations') }
  const resource = (name, template, operation, args, description) => ctx.effect(() => registry.registerResource(name,
    { template, metadata: { mimeType: 'text/markdown', ...(description ? { description } : {}) }, read: async (uri, variables) => {
      const body = await app.operations.invoke(operation, args(variables))
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: `# ${name}\n\n\u0060\u0060\u0060json\n${JSON.stringify(body, null, 2)}\n\u0060\u0060\u0060\n` }] }
    } }))
  resource('Document', 'ivoraige://docs/{docId}', 'getDocument', ({ docId }) => ({ docId }))
  resource('Unit', 'ivoraige://docs/{docId}/units/{unitId}{?targetLang}', 'getUnit', ({ docId, unitId, targetLang }) => {
    // Unit ids carry document identity; do not return a unit from a different URI document.
    if (!unitId.startsWith(`${docId}.`)) throw new KernelError('NOT_FOUND', 'Unit does not belong to this document')
    return { unitId, targetLang }
  }, 'Read one unit and its language-specific revisions. The targetLang query parameter is required (BCP-47 language tag).')
  resource('Task', 'ivoraige://tasks/{taskId}', 'getTask', ({ taskId }) => ({ taskId }))
  ctx.effect(() => registry.registerResource('Artifact', { template: 'ivoraige://artifacts/{artifactId}',
    metadata: { description: 'Read an existing export; this never regenerates or translates.' }, read: async (uri, { artifactId }) => {
      try {
        const artifact = await app.operations.artifact(artifactId, { retain: true })
        try {
          const bytes = await readFile(artifact.path)
          return { contents: [{ uri: uri.href, mimeType: artifact.contentType.split(';')[0], blob: bytes.toString('base64') }] }
        } finally { artifact.release?.() }
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(error.code)) error = new KernelError('NOT_FOUND', 'Artifact not found')
        throw error
      }
    } }))
}
