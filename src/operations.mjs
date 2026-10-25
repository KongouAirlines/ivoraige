import { Service } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'
import { API_VERSION } from './protocol.mjs'

// Stable facade for existing callers. Handlers and schemas live in the catalog.
export class Operations extends Service {
  static inject = ['ivoraige.operationCatalog']
  constructor(ctx, config = {}) {
    super(ctx, 'ivoraige.operations')
    this.catalog = ctx.get('ivoraige.operationCatalog')
    this.modelAdmission = Promise.resolve()
    this.dataDirectory = config.dataDirectory
  }
  withModelAdmission(callback) {
    const pending = this.modelAdmission.then(callback)
    this.modelAdmission = pending.catch(() => {})
    return pending
  }
  assertNoActiveTranslations() {
    if (this.ctx.get('ivoraige.records')?.listTasks().some(task => task.kind === 'translate' &&
        ['queued', 'running'].includes(task.state))) {
      throw new KernelError('CONFLICT', 'Pause active translation tasks before changing model settings or credentials')
    }
  }
  async changeModel(callback) {
    return this.withModelAdmission(async () => {
      this.assertNoActiveTranslations()
      return callback()
    })
  }
  subscribe(listener) {
    const events = this.ctx.get('ivoraige.events')
    if (events) return events.subscribeLegacy(listener)
    const tasks = this.ctx.get('ivoraige.tasks')
    if (!tasks) throw new KernelError('COMPONENT_MISSING', 'Task events are unavailable')
    return tasks.subscribe(listener)
  }
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
  artifact(artifactId, options) {
    const resources = this.ctx.get('ivoraige.resources')
    if (!resources) throw new KernelError('COMPONENT_MISSING', 'Resource access is unavailable')
    return resources.artifact(artifactId, options)
  }
  removeOwnedFile(path, fileDigest) {
    const resources = this.ctx.get('ivoraige.resources')
    if (!resources || !this.ctx.get('ivoraige.export'))
      throw new KernelError('COMPONENT_MISSING', 'Managed artifact deletion requires resource access and export ownership')
    return resources.removeOwnedFile(path, fileDigest)
  }
  async waitTask(taskId, seconds, signal) {
    // Records is optional at facade construction. Resolve it per request and
    // keep this wait bound to the same store through its terminal reread.
    const records = this.ctx.get('ivoraige.records')
    if (!records) throw new KernelError('COMPONENT_MISSING', 'Task records are unavailable')
    const task = records.getTask(taskId)
    if (signal?.aborted || !seconds || !['queued', 'running'].includes(task.state)) return task
    return new Promise(resolve => {
      let timer
      const done = () => {
        clearTimeout(timer); unsubscribe(); signal?.removeEventListener('abort', done)
        resolve(records.getTask(taskId))
      }
      const unsubscribe = this.subscribe(event => {
        if (event.data.taskId === taskId && ['task.succeeded', 'task.failed', 'task.paused', 'task.canceled', 'task.abandoned'].includes(event.type)) done()
      })
      timer = setTimeout(done, seconds * 1000)
      signal?.addEventListener('abort', done, { once: true })
      if (signal?.aborted || !['queued', 'running'].includes(records.getTask(taskId).state)) done()
    })
  }
  async invoke(name, input = {}, options = {}) {
    // The facade owns wire metadata, even if a validated business payload names it.
    return { ...await this.catalog.invoke(name, input, options), apiVersion: API_VERSION }
  }
}
