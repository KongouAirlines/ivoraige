import { basename } from 'node:path'
import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'
import { API_VERSION, validate, paginate, taskView } from './protocol.mjs'

// The entry layers share this business facade and its parameter/response contract.
export class Operations extends Service {
  static inject = ['ivoraige.records', 'ivoraige.tasks']
  constructor(ctx) {
    super(ctx, 'ivoraige.operations')
    this.records = ctx.get('ivoraige.records')
    this.tasks = ctx.get('ivoraige.tasks')
    this.modelAdmission = Promise.resolve()
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
  artifact(artifactId) {
    const docId = typeof artifactId === 'string' ? artifactId.split('.')[0] : ''
    const artifact = this.records.listArtifacts(docId).find(item => item.id === artifactId)
    if (!artifact) throw new KernelError('NOT_FOUND', 'Artifact not found', { artifactId })
    return { path: artifact.path, filename: basename(artifact.path),
      contentType: artifact.format === 'json' ? 'application/json; charset=utf-8' :
        artifact.format === 'md' ? 'text/markdown; charset=utf-8' : 'application/octet-stream' }
  }
  async waitTask(taskId, seconds) {
    const task = this.records.getTask(taskId)
    if (!seconds || !['queued', 'running'].includes(task.state)) return task
    return new Promise(resolve => {
      let timer
      const done = () => { clearTimeout(timer); unsubscribe(); resolve(this.records.getTask(taskId)) }
      const unsubscribe = this.subscribe(event => {
        if (event.data.taskId === taskId && ['task.succeeded', 'task.failed', 'task.paused', 'task.canceled'].includes(event.type)) done()
      })
      timer = setTimeout(done, seconds * 1000)
    })
  }
  async invoke(name, input = {}) {
    const p = validate(name, input)
    const r = this.records
    let result
    switch (name) {
      case 'capabilities': result = { features: ['documents', 'workbench', 'tasks',
        ...(this.ctx.get('ivoraige.modelSettings') ? ['settings'] : [])],
        inputFormats: this.ctx.get('ivoraige.parse').listAdapters().map(id => id === 'markdown' ? 'md' : id),
        outputFormats: this.ctx.get('ivoraige.outputs').listAdapters() }; break
      case 'importDocument': {
        if ((p.path === undefined) === (p.contentBase64 === undefined)) throw new KernelError('INVALID_ARGUMENT', 'Specify path or contentBase64, exclusively')
        let content
        if (p.contentBase64 !== undefined) {
          if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(p.contentBase64)) {
            throw new KernelError('INVALID_ARGUMENT', 'contentBase64 is not valid base64')
          }
          try { content = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(p.contentBase64, 'base64')) }
          catch { throw new KernelError('INVALID_ARGUMENT', 'Input must be UTF-8 text') }
        }
        result = await this.tasks.importDocument({ ...(p.path ? { path: p.path } : { content }),
          ...(p.format ? { format: p.format } : {}), ...(p.title ? { title: p.title } : {}) },
        { language: p.language, origin: p.origin, ...(p.sourceId ? { sourceId: p.sourceId } : {}),
          ...(p.externalRef ? { externalRef: p.externalRef } : {}) })
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
      case 'getTask': result = { task: taskView(await this.waitTask(p.taskId, p.waitSeconds)) }; break
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
