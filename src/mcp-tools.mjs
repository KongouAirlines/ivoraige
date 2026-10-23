import { parameters } from './protocol.mjs'

// Existing public tool names remain stable. Newly contributed operations get
// a namespaced fallback name; no second plugin registers either set.
const aliases = {
  capabilities: ['capabilities', 'List installed kernel capabilities and data directory.'],
  importDocument: ['import', 'Import a document using an installed input adapter.'],
  listDocuments: ['documents_list', 'List imported documents.'],
  getDocument: ['document_get', 'Read document metadata and available output formats.'],
  listUnits: ['units_list', 'List source units, drafts and accepted revisions.'],
  getUnit: ['unit_get', 'Read one unit before editing or accepting a revision.'],
  listRevisions: ['revisions_list', 'Read revision history for a unit.'],
  writeRevision: ['unit_update', 'Save a human revision using its baseRevisionId.'],
  acceptRevision: ['revision_accept', 'Accept a revision using expectedAcceptedRevisionId.'],
  unaccept: ['unit_unaccept', 'Remove acceptance using expectedAcceptedRevisionId.'],
  translate: ['translate', 'Start translation with the configured DSH model; may incur model usage.'],
  exportDocument: ['export', 'Export from a frozen snapshot; this never invokes a translation model.'],
  listArtifacts: ['artifacts_list', 'List saved artifacts.'],
  listArtifactCleanup: ['artifact_cleanup_list', 'List pending or failed managed-file cleanups.'],
  deleteArtifact: ['artifact_delete', 'Delete an artifact record; delete-owned explicitly removes managed bytes.'],
  listSnapshots: ['snapshots_list', 'List frozen export snapshots.'],
  getSnapshot: ['snapshot_get', 'Read a frozen export snapshot.'],
  deleteSnapshot: ['snapshot_delete', 'Delete an unreferenced snapshot.'],
  listTasks: ['tasks_list', 'List persistent document tasks.'],
  getTask: ['task_status', 'Read a persistent task, optionally waiting for completion.'],
  pauseTask: ['task_pause', 'Pause a translation or export task.'],
  resumeTask: ['task_resume', 'Resume a paused task; translation may incur model usage.'],
  cancelTask: ['task_cancel', 'Explicitly cancel a persistent task.'],
  abandonTask: ['task_abandon', 'Explicitly abandon a failed persistent task and release its snapshot reference.'],
  getSettings: ['settings_get', 'Read model settings without credential values.'],
  updateSettings: ['settings_update', 'Update model settings using optimistic lock fields.'],
  setCredential: ['credential_set', 'Store a user-authorized model credential through DSH.'],
  componentStatus: ['component_status', 'Read optional component status.'],
  componentCatalog: ['component_catalog', 'Query the configured release catalog.'],
  componentCredential: ['component_credential', 'Save a user-provided component token.'],
  componentCredentialClear: ['component_credential_clear', 'Remove the component token.'],
  componentInstall: ['component_install', 'Install the official PDF component; requires explicit user intent.'],
  componentLocal: ['component_local', 'Install the official PDF component from a local manifest.'],
  componentTask: ['component_task', 'Read a component installation task.'],
  componentCancel: ['component_cancel', 'Cancel a component installation task.'],
}

export const OperationTools = {
  inject: ['ivoraige.mcp', 'ivoraige.operationCatalog', 'ivoraige.operations'],
  apply(ctx) {
    const registry = ctx.get('ivoraige.mcp')
    const catalog = ctx.get('ivoraige.operationCatalog')
    const operations = ctx.get('ivoraige.operations')
    const active = new Map()
    const sync = () => {
      const wanted = new Map(catalog.list({ availableOnly: true }).map(entry => {
        const [alias, description] = aliases[entry.id] ?? [`op_${entry.id}`, entry.description || `Run ${entry.id}.`]
        return [`ivoraige_${alias}`, { entry, description }]
      }))
      for (const [name, item] of active) if (wanted.get(name)?.entry !== item.entry) {
        item.dispose(); active.delete(name)
      }
      for (const [name, { entry, description }] of wanted) if (!active.has(name)) {
        active.set(name, { entry, dispose: registry.registerTool(name, {
          description, inputSchema: entry.inputSchema,
          invoke: (input, context) => operations.invoke(entry.id, input, { signal: context.signal }),
        }) })
      }
    }
    const unsubscribe = catalog.subscribeChanges(sync)
    ctx.effect(() => () => {
      unsubscribe()
      for (const item of active.values()) item.dispose()
      active.clear()
    })
    sync()
  },
}

// Operation bridge shared by capability plugins; definitions remain with their owners.
export function registerTools(ctx, definitions) {
  const registry = ctx.get('ivoraige.mcp')
  const operations = ctx.get('ivoraige.operations')
  for (const [name, [operation, description]] of Object.entries(definitions)) {
    ctx.effect(() => registry.registerTool(`ivoraige_${name}`, { description, inputSchema: parameters[operation],
      invoke: (input, context) => operations.invoke(operation, input, { signal: context.signal }) }))
  }
}
