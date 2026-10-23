import { basename } from 'node:path'
import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'
import { API_VERSION, validate, paginate, taskView } from './protocol.mjs'

// The entry layers share this business facade and its parameter/response contract.
export class Operations extends Service {
  static inject = ['ivoraige.records', 'ivoraige.tasks']
  constructor(ctx, config = {}) {
    super(ctx, 'ivoraige.operations')
    this.records = ctx.get('ivoraige.records')
    this.tasks = ctx.get('ivoraige.tasks')
    this.modelAdmission = Promise.resolve()
    this.dataDirectory = config.dataDirectory
  }
  withModelAdmission(callback) {
    const pending = this.modelAdmission.then(callback)
    this.modelAdmission = pending.catch(() => {})
    return pending
  }
  async changeModel(callback) {
    return this.withModelAdmission(async () => {
      if (this.records.listTasks().some(task => task.kind === 'translate' && ['queued', 'running'].includes(task.state))) {
        throw new KernelError('CONFLICT', 'Pause active translation tasks before changing model settings or credentials')
      }
      return callback()
    })
  }
  subscribe(listener) { return this.tasks.subscribe(listener) }
  settings() {
    const service = this.ctx.get('ivoraige.modelSettings')
    if (!service) throw new KernelError('COMPONENT_MISSING', 'Start with a settings directory to configure models')
    return service
  }
  components() {
    const service = this.ctx.get('ivoraige.components')
    if (!service) throw new KernelError('COMPONENT_MISSING', 'Component installation is not enabled for this kernel')
    return service
  }
  artifact(artifactId) {
    const docId = typeof artifactId === 'string' ? artifactId.split('.')[0] : ''
    const artifact = this.records.listArtifacts(docId).find(item => item.id === artifactId)
    if (!artifact) throw new KernelError('NOT_FOUND', 'Artifact not found', { artifactId })
    return { path: artifact.path, filename: basename(artifact.path),
      contentType: artifact.format === 'json' ? 'application/json; charset=utf-8' :
        artifact.format === 'md' ? 'text/markdown; charset=utf-8' :
          artifact.format === 'pdf' ? 'application/pdf' : 'application/octet-stream' }
  }
  async waitTask(taskId, seconds, signal) {
    const task = this.records.getTask(taskId)
    if (signal?.aborted || !seconds || !['queued', 'running'].includes(task.state)) return task
    return new Promise(resolve => {
      let timer
      const done = () => {
        clearTimeout(timer); unsubscribe(); signal?.removeEventListener('abort', done)
        resolve(this.records.getTask(taskId))
      }
      const unsubscribe = this.subscribe(event => {
        if (event.data.taskId === taskId && ['task.succeeded', 'task.failed', 'task.paused', 'task.canceled'].includes(event.type)) done()
      })
      timer = setTimeout(done, seconds * 1000)
      signal?.addEventListener('abort', done, { once: true })
      if (signal?.aborted) done()
    })
  }
  async invoke(name, input = {}, { signal } = {}) {
    const p = validate(name, input)
    const r = this.records
    let result
    switch (name) {
      case 'componentStatus': result = await this.components().status(); break
      case 'componentCatalog': result = { catalog: await this.components().catalog() }; break
      case 'componentCredential': result = await this.components().setToken(p.token); break
      case 'componentCredentialClear': result = await this.components().clearToken(); break
      case 'componentInstall': result = await this.components().install(p); break
      case 'componentLocal': result = await this.components().installLocal({ manifestPath: p.path }); break
      case 'componentTask': result = { task: await this.components().getTask(p.taskId) }; break
      case 'componentCancel': result = { task: await this.components().cancel(p.taskId) }; break
      case 'capabilities': {
        const parser = this.ctx.get('ivoraige.parse')
        const components = parser.componentStatus()
        const settingsPages = this.ctx.get('ivoraige.settingsPages')?.list() ?? []
        result = { features: ['documents', 'workbench', 'tasks',
          ...(this.ctx.get('ivoraige.components') ? ['component-installation'] : []),
          ...(settingsPages.length ? ['settings'] : [])], settingsPages,
          inputFormats: parser.listFormats().map(format => format === 'markdown' ? 'md' : format)
            .filter((format, index, formats) => formats.indexOf(format) === index),
          outputFormats: this.ctx.get('ivoraige.outputs').listFormats(),
          components, dataDirectory: this.dataDirectory }
        break
      }
      case 'importDocument': {
        if ((p.path === undefined) === (p.contentBase64 === undefined)) throw new KernelError('INVALID_ARGUMENT', 'Specify path or contentBase64, exclusively')
        const sourceAdapters = [...this.ctx.get('ivoraige.parse').adapters.values()]
        const matching = sourceAdapters.filter(adapter =>
          (p.adapterId === undefined || adapter.id === p.adapterId) &&
          (p.format ? (adapter.formats ?? [adapter.id]).includes(p.format) :
            adapter.match({ path: p.path }) > 0))
        const candidates = matching.filter(adapter => p.adapterId !== undefined ||
          adapter.status?.().state !== 'unavailable')
        // Preserve the 0.1.0 queued PDF wire response when its optional
        // component is absent; installed adapters use their own descriptor.
        const legacyPdf = p.adapterId === undefined && !matching.length &&
          (p.format === 'pdf' || /\.pdf$/i.test(p.path ?? ''))
        let content
        if (p.contentBase64 !== undefined) {
          if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(p.contentBase64)) {
            throw new KernelError('INVALID_ARGUMENT', 'contentBase64 is not valid base64')
          }
          const bytes = Buffer.from(p.contentBase64, 'base64')
          let decoded
          try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch {}
          const text = candidates.filter(adapter => !adapter.inputKinds || adapter.inputKinds.includes('text'))
          const binary = candidates.filter(adapter => !adapter.inputKinds || adapter.inputKinds.includes('bytes'))
          const binaryOnly = binary.filter(adapter => adapter.inputKinds && !adapter.inputKinds.includes('text'))
          if (decoded !== undefined && text.length) content = decoded
          else if (binaryOnly.length || (decoded !== undefined && binary.length) || legacyPdf) {
            content = bytes
          }
          else if (decoded !== undefined) content = decoded
          else throw new KernelError('INVALID_ARGUMENT', 'Input must be UTF-8 text')
        }
        result = await this.tasks.importDocument({ ...(p.path ? { path: p.path } : { content }),
          ...(p.format ? { format: p.format } : {}), ...(p.adapterId ? { adapterId: p.adapterId } : {}),
          ...(p.title ? { title: p.title } : {}) },
        { language: p.language, origin: p.origin, ...(p.sourceId ? { sourceId: p.sourceId } : {}),
          ...(p.externalRef ? { externalRef: p.externalRef } : {}) },
        { waitForQueued: false, deferSelection: legacyPdf })
        break
      }
      case 'listDocuments': result = paginate(r.listDocuments().filter(item =>
        (!p.origin || item.origin === p.origin) && (!p.format || item.format === p.format)), p); break
      case 'getDocument': result = { document: r.getDocument(p.docId) }; break
      case 'listUnits': result = paginate(r.listUnits(p.docId, p).filter(item => p.filter === 'all' ||
        (p.filter === 'accepted' && item.acceptedRevisionId) || (p.filter === 'draft' && item.draftRevisionId) ||
        (p.filter === 'untranslated' && item.translatable && !item.acceptedRevisionId && !item.draftRevisionId)), p); break
      case 'getUnit': result = r.getUnit(p.unitId, p); break
      case 'listRevisions': result = paginate(r.listRevisions(p.unitId, p), p); break
      case 'writeRevision': result = { revision: await r.writeRevision(p.unitId, { ...p, origin: 'human' }) }; break
      case 'acceptRevision': result = { accepted: await r.acceptRevision(p.revisionId, p) }; break
      case 'unaccept': result = await r.unaccept(p.unitId, p); break
      case 'translate': result = await this.withModelAdmission(() => this.tasks.submit(p.docId, p)); break
      case 'exportDocument': result = await this.tasks.exportDocument(p.docId, p); break
      case 'listArtifacts': result = paginate(r.listArtifacts(p.docId), p); break
      case 'listSnapshots': result = paginate(r.listSnapshots(p.docId, p), p); break
      case 'getSnapshot': result = { snapshot: r.getSnapshot(p.docId, p.snapshotId) }; break
      case 'deleteSnapshot': await r.deleteSnapshot(p.docId, p.snapshotId); result = { deleted: true }; break
      case 'listTasks': result = paginate(r.listTasks(p).filter(task =>
        (!p.kind || p.kind === task.kind) && (!p.state || p.state === task.state))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(taskView), p); break
      case 'getTask': result = { task: taskView(await this.waitTask(p.taskId, p.waitSeconds, signal)) }; break
      case 'pauseTask': result = { task: taskView(await this.tasks.pause(p.taskId)) }; break
      case 'resumeTask': result = { task: taskView(await this.withModelAdmission(() => this.tasks.resume(p.taskId))) }; break
      case 'cancelTask': result = { task: taskView(await this.tasks.cancel(p.taskId)) }; break
      case 'getSettings': result = { settings: await this.settings().get() }; break
      case 'updateSettings': result = { settings: await this.changeModel(() => this.settings().update(p)) }; break
      case 'setCredential': result = await this.changeModel(() => this.settings().setCredential(p)); break
    }
    return { apiVersion: API_VERSION, ...result }
  }
}
