// The pinned DSH notification adapters live here, beside the composition root.
// In particular domain/changed.value is private and must never be projected.
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined)
  .map(key => [key, value[key]]))
const taskFields = ['id', 'kind', 'docId', 'state', 'progress', 'cursor', 'updatedAt']
const documentFields = ['id', 'title', 'format', 'language', 'sourceAdapterId',
  'availableOutputs', 'unitCount', 'importedAt']
const taskEventFields = ['taskId', 'unitId', 'targetLang', 'kind', 'stage', 'done', 'total', 'cursor', 'reused']

export function installEventState(ctx) {
  const bridge = ctx.get('ivoraige.events')
  if (!bridge) throw new Error('Business event projection requires ivoraige.events')
  const disposers = []
  let closed = false
  const observe = (name, project) => disposers.push(ctx.on(name, (...args) => {
    if (closed) return
    try { project(...args) } catch { bridge.invalidateAll('source-notification-failed') }
  }))
  const read = (id, reader) => disposers.push(bridge.registerState(id, reader))

  read('documents', scope => {
    if (scope.componentId) return []
    const records = ctx.get('ivoraige.records')
    if (!records) return []
    let documents = records.listDocuments()
    if (scope.docId) documents = documents.filter(row => row.id === scope.docId)
    if (scope.taskId) {
      const task = records.listTasks().find(row => row.id === scope.taskId)
      documents = documents.filter(row => row.id === task?.docId)
    }
    return documents.map(row => pick(row, documentFields))
  })
  read('tasks', scope => {
    if (scope.componentId) return []
    const records = ctx.get('ivoraige.records')
    if (!records) return []
    return records.listTasks().filter(row => (!scope.docId || row.docId === scope.docId) &&
      (!scope.taskId || row.id === scope.taskId)).map(row => pick(row, taskFields))
  })
  read('settingsPages', () => ctx.get('ivoraige.settingsPages')?.list() ?? [])
  read('capabilities', () => ({
    capabilities: ctx.get('ivoraige.capabilities')?.list() ?? [],
    inputFormats: ctx.get('ivoraige.parse')?.listFormats() ?? [],
    outputFormats: ctx.get('ivoraige.outputs')?.listFormats() ?? [],
    operations: ctx.get('ivoraige.operationCatalog')?.list().map(({ id, requires }) =>
      ({ id, available: ctx.get('ivoraige.operationCatalog').available({ id, requires }) })) ?? [],
  }))
  read('settings', () => ctx.get('settings')?.describe({ redactSecrets: true })
    .map(row => ({ namespace: row.ns, revision: row.revision })) ?? [])
  read('components', scope => {
    const components = ctx.get('ivoraige.components')
    if (!components || (scope.componentId && scope.componentId !== 'babeldoc')) return []
    return [...components.tasks.keys()].filter(id => !scope.taskId || scope.taskId === id)
      .map(id => pick(components.getTask(id), ['taskId', 'state', 'restartRequired']))
  })

  observe('domain/changed', change => {
    if (change?.domain !== 'ivoraige_records') return
    const scope = change.table === 'documents' && typeof change.key === 'string' ? { docId: change.key } : {}
    bridge.publish('records.changed', { scope, data: { table: change.table, operation: change.operation } })
  })
  observe('settings/document-updated', (namespace, revision) => bridge.publish('settings.changed', {
    data: { namespace, revision },
  }))
  observe('ivoraige/settings-changed', () => bridge.publish('settings.changed'))
  observe('ivoraige/capabilities-changed', () => bridge.publish('capabilities.changed'))
  let detachCatalog
  const observeCatalog = () => {
    detachCatalog?.()
    detachCatalog = ctx.get('ivoraige.operationCatalog')?.subscribeChanges(
      () => bridge.publish('capabilities.changed'))
  }
  observeCatalog()
  disposers.push(() => detachCatalog?.())
  observe('internal/service', name => {
    if (name === 'ivoraige.operationCatalog') observeCatalog()
    const capabilities = ctx.get('ivoraige.capabilities')?.list() ?? []
    const operations = ctx.get('ivoraige.operationCatalog')?.list() ?? []
    if (['ivoraige.capabilities', 'ivoraige.operationCatalog', 'ivoraige.records', 'ivoraige.parse',
      'ivoraige.outputs', 'ivoraige.settingsPages', 'settings', 'ivoraige.components'].includes(name) ||
      [...capabilities, ...operations].some(item => item.requires.includes(name)))
      bridge.publish('capabilities.changed')
  })
  observe('ivoraige/settings-pages-changed', data => bridge.publish('settings.pages.changed', {
    data, legacyData: data,
  }))
  observe('ivoraige/task-event', event => {
    const data = pick(event.data, taskEventFields)
    const scope = pick(event.data, ['docId', 'taskId'])
    bridge.publish(event.type, { scope, data, legacyData: event.data })
  })
  observe('ivoraige/component-event', event => bridge.publish(event.type ?? 'component.changed', {
    scope: pick(event.data, ['componentId', 'taskId']),
    data: pick(event.data, ['componentId', 'taskId', 'state', 'restartRequired']),
  }))

  return () => {
    if (closed) return
    closed = true
    for (const dispose of disposers.reverse()) dispose()
  }
}
