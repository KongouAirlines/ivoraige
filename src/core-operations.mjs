import { KernelError } from './errors.mjs'
import { parameters, results, paginate, taskView } from './protocol.mjs'
import { resourcePolicy } from './resource-policy.mjs'

function capabilityHandlers(ctx, ops) {
  return {
    capabilities: async () => {
      const parser = ctx.get('ivoraige.parse')
      const settingsPages = ctx.get('ivoraige.settingsPages')?.list() ?? []
      const hasRecords = Boolean(ctx.get('ivoraige.records'))
      const hasTasks = Boolean(ctx.get('ivoraige.tasks'))
      const components = parser?.componentStatus() ?? {}
      return { features: [
        ...(hasRecords ? ['documents', 'workbench'] : []),
        ...(hasTasks ? ['tasks'] : []),
        ...(ctx.get('ivoraige.components') ? ['component-installation'] : []),
        ...(settingsPages.length ? ['settings'] : []),
      ], settingsPages,
      inputFormats: (parser?.listFormats() ?? []).map(format => format === 'markdown' ? 'md' : format)
        .filter((format, index, formats) => formats.indexOf(format) === index),
      outputFormats: ctx.get('ivoraige.outputs').listFormats(), components,
      capabilities: ctx.get('ivoraige.capabilities')?.list() ?? [],
      operations: ctx.get('ivoraige.operationCatalog').list().map(({ id, requires, longRunning, cancellable }) =>
        ({ id, requires, longRunning, cancellable, available: ctx.get('ivoraige.operationCatalog').available({ id, requires }) })),
      resourceLimits: { ...resourcePolicy, maxArtifactBytes: ctx.get('ivoraige.resources')?.maxArtifactBytes ?? null },
      ...(ops.dataDirectory ? { dataDirectory: ops.dataDirectory } : {}) }
    },
  }
}

function recordHandlers(ctx, ops) {
  const records = () => ctx.get('ivoraige.records')
  const tasks = () => ctx.get('ivoraige.tasks')
  return {
    importDocument: async p => {
      const { language, origin, sourceId, externalRef, ...file } = p
      return tasks().importDocument(file, { language, origin, sourceId, externalRef },
        { waitForQueued: false, legacyWire: true })
    },
    listDocuments: async p => paginate(records().listDocuments().filter(item =>
      (!p.origin || item.origin === p.origin) && (!p.format || item.format === p.format)), p),
    getDocument: async p => ({ document: records().getDocument(p.docId) }),
    listUnits: async p => paginate(records().listUnits(p.docId, p).filter(item => p.filter === 'all' ||
      (p.filter === 'accepted' && item.acceptedRevisionId) || (p.filter === 'draft' && item.draftRevisionId) ||
      (p.filter === 'untranslated' && item.translatable && !item.acceptedRevisionId && !item.draftRevisionId)), p),
    getUnit: async p => records().getUnit(p.unitId, p),
    listRevisions: async p => paginate(records().listRevisions(p.unitId, p), p),
    writeRevision: async p => ({ revision: await records().writeRevision(p.unitId, { ...p, origin: 'human' }) }),
    acceptRevision: async p => ({ accepted: await records().acceptRevision(p.revisionId, p) }),
    unaccept: async p => records().unaccept(p.unitId, p),
    translate: async p => ops.withModelAdmission(() => tasks().submit(p.docId, p)),
    exportDocument: async p => tasks().exportDocument(p.docId, p),
    listArtifacts: async p => paginate(records().listArtifacts(p.docId), p),
    listArtifactCleanup: async p => paginate(records().listArtifactCleanup(p.docId), p),
    deleteArtifact: async p => {
      const candidate = records().artifactCandidate(p.docId, p.artifactId)
      if (p.fileAction === 'delete-owned') {
        if (candidate.managedFile !== true)
          throw new KernelError('PRECONDITION_FAILED', 'Artifact file is not managed')
        if (!ctx.get('ivoraige.resources') || !ctx.get('ivoraige.export'))
          throw new KernelError('COMPONENT_MISSING', 'Managed artifact deletion requires resource access and export ownership')
      }
      return records().deleteArtifact(p.docId, p.artifactId, { deleteOwned: p.fileAction === 'delete-owned',
        ...(p.fileAction === 'delete-owned' ? { unlinkFile: (path, digest) => ops.removeOwnedFile(path, digest) } : {}) })
    },
    listSnapshots: async p => paginate(records().listSnapshots(p.docId, p), p),
    getSnapshot: async p => ({ snapshot: records().getSnapshot(p.docId, p.snapshotId) }),
    deleteSnapshot: async p => { await records().deleteSnapshot(p.docId, p.snapshotId); return { deleted: true } },
    listTasks: async p => paginate(records().listTasks(p).filter(task =>
      (!p.kind || p.kind === task.kind) && (!p.state || p.state === task.state))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(taskView), p),
    getTask: async (p, { signal }) => ({ task: taskView(await ops.waitTask(p.taskId, p.waitSeconds, signal)) }),
    pauseTask: async p => ({ task: taskView(await tasks().pause(p.taskId)) }),
    resumeTask: async p => ({ task: taskView(await ops.withModelAdmission(() => tasks().resume(p.taskId))) }),
    cancelTask: async p => ({ task: taskView(await tasks().cancel(p.taskId)) }),
    abandonTask: async p => ({ task: taskView(await tasks().abandon(p.taskId)) }),
  }
}

function settingsHandlers(ops) {
  return {
    getSettings: async () => ({ settings: await ops.settings().get() }),
    updateSettings: async p => ({ settings: await ops.changeModel(() => ops.settings().update(p)) }),
    setCredential: async p => ops.changeModel(() => ops.settings().setCredential(p)),
  }
}

function componentHandlers(ops) {
  return {
    componentStatus: async () => ops.components().status(),
    componentCatalog: async () => ({ catalog: await ops.components().catalog() }),
    componentCredential: async p => ops.components().setToken(p.token),
    componentCredentialClear: async () => ops.components().clearToken(),
    componentInstall: async p => ops.components().install(p),
    componentLocal: async p => ops.components().installLocal({ manifestPath: p.path }),
    componentTask: async p => ({ task: await ops.components().getTask(p.taskId) }),
    componentCancel: async p => ({ task: await ops.components().cancel(p.taskId) }),
  }
}

const documentOps = new Set(['listDocuments', 'getDocument', 'listUnits', 'getUnit', 'listRevisions',
  'writeRevision', 'acceptRevision', 'unaccept', 'listArtifacts', 'listArtifactCleanup',
  'deleteArtifact', 'listSnapshots', 'getSnapshot',
  'deleteSnapshot', 'listTasks'])
const taskOps = new Set(['importDocument', 'translate', 'exportDocument', 'getTask', 'pauseTask',
  'resumeTask', 'cancelTask', 'abandonTask'])
const taskAdmissions = new Set(['importDocument', 'translate', 'exportDocument', 'resumeTask',
  'componentInstall', 'componentLocal'])
const requestWaits = new Set(['getTask'])

export const inject = ['ivoraige.operationCatalog', 'ivoraige.operations']
export function apply(ctx) {
    const catalog = ctx.get('ivoraige.operationCatalog')
    const ops = ctx.get('ivoraige.operations')
    const handlers = { ...capabilityHandlers(ctx, ops), ...recordHandlers(ctx, ops),
      ...settingsHandlers(ops), ...componentHandlers(ops) }
    for (const [id, handler] of Object.entries(handlers)) {
      const requires = id === 'capabilities' ? ['ivoraige.outputs'] :
        id.startsWith('component') ? ['ivoraige.components'] :
          ['getSettings', 'updateSettings', 'setCredential'].includes(id) ? ['ivoraige.modelSettings'] :
            id === 'importDocument' ? ['ivoraige.records', 'ivoraige.tasks', 'ivoraige.parse', 'ivoraige.import'] :
            ['writeRevision', 'acceptRevision'].includes(id) ? ['ivoraige.records', 'ivoraige.parse'] :
            id === 'exportDocument' ? ['ivoraige.records', 'ivoraige.tasks', 'ivoraige.export', 'ivoraige.outputs'] :
            taskOps.has(id) ? ['ivoraige.records', 'ivoraige.tasks'] :
              documentOps.has(id) ? ['ivoraige.records'] : []
      ctx.effect(() => catalog.register({ id, inputSchema: parameters[id], resultSchema: results[id],
        requires, handler, longRunning: taskAdmissions.has(id),
        ...(id === 'exportDocument' ? { isAvailable: () =>
          ['source', 'accepted-translation'].some(contentMode =>
            ctx.get('ivoraige.outputs').listFormats({ contentMode }).length > 0) } : {}),
        ...(['updateSettings', 'setCredential'].includes(id) ? { preflight: () => ops.assertNoActiveTranslations() } : {}),
        cancellable: requestWaits.has(id) ? 'request' : taskAdmissions.has(id) ? 'task' : 'none' }))
    }
}
export const CoreOperations = { inject, apply }
