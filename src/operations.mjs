import { basename, dirname, resolve } from 'node:path'
import { lstat, readFile, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'
import { API_VERSION, validate, paginate, taskView } from './protocol.mjs'
import { sameDirectory } from './managed-path.mjs'

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
  artifact(artifactId, { retain = false } = {}) {
    const docId = typeof artifactId === 'string' ? artifactId.split('.')[0] : ''
    const artifact = this.records.listArtifacts(docId).find(item => item.id === artifactId)
    if (!artifact) throw new KernelError('NOT_FOUND', 'Artifact not found', { artifactId })
    const release = retain ? this.records.retainArtifact(docId, artifactId) : undefined
    return { path: artifact.path, filename: basename(artifact.path), ...(release ? { release } : {}),
      contentType: artifact.format === 'json' ? 'application/json; charset=utf-8' :
        artifact.format === 'md' ? 'text/markdown; charset=utf-8' :
          artifact.format === 'pdf' ? 'application/pdf' : 'application/octet-stream' }
  }
  async removeOwnedFile(path, fileDigest) {
    let info
    try { info = await lstat(path) } catch (error) {
      // No filesystem unlink is needed. This also completes a durable cleanup
      // after a managed export directory has been moved or removed.
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return
      throw error
    }
    const root = this.ctx.get('ivoraige.export')?.root
    // Compare the directory itself: spelling, case and junction aliases can
    // differ while naming the same directory (including on macOS volumes).
    if (!await sameDirectory(dirname(resolve(path)), root))
      throw new KernelError('PRECONDITION_FAILED', 'Artifact path is outside the managed export directory', { path })
    if (!info.isFile() || info.isSymbolicLink())
      throw new KernelError('PRECONDITION_FAILED', 'Owned artifact path is not a regular file', { path })
    if (!fileDigest || createHash('sha256').update(await readFile(path)).digest('hex') !== fileDigest)
      throw new KernelError('PRECONDITION_FAILED', 'Owned artifact bytes changed; file retained', { path })
    await unlink(path)
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
        if (event.data.taskId === taskId && ['task.succeeded', 'task.failed', 'task.paused', 'task.canceled', 'task.abandoned'].includes(event.type)) done()
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
        const { language, origin, sourceId, externalRef, ...file } = p
        result = await this.tasks.importDocument(file, { language, origin, sourceId, externalRef },
          { waitForQueued: false, legacyWire: true })
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
      case 'listArtifactCleanup': result = paginate(r.listArtifactCleanup(p.docId), p); break
      case 'deleteArtifact': {
        const candidate = r.artifactCandidate(p.docId, p.artifactId)
        if (p.fileAction === 'delete-owned' && candidate.managedFile !== true)
          throw new KernelError('PRECONDITION_FAILED', 'Artifact file is not managed')
        if (p.fileAction === 'delete-owned' && !this.ctx.get('ivoraige.export'))
          throw new KernelError('COMPONENT_MISSING', 'Managed export directory is unavailable')
        result = await r.deleteArtifact(p.docId, p.artifactId, { deleteOwned: p.fileAction === 'delete-owned',
          ...(p.fileAction === 'delete-owned' ? { unlinkFile: (path, digest) => this.removeOwnedFile(path, digest) } : {}) })
        break
      }
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
      case 'abandonTask': result = { task: taskView(await this.tasks.abandon(p.taskId)) }; break
      case 'getSettings': result = { settings: await this.settings().get() }; break
      case 'updateSettings': result = { settings: await this.changeModel(() => this.settings().update(p)) }; break
      case 'setCredential': result = await this.changeModel(() => this.settings().setCredential(p)); break
    }
    return { apiVersion: API_VERSION, ...result }
  }
}
