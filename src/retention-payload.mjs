// Keep the boot-time version gate and Records' write-time gate in agreement.
export function documentRequiresRetention(record) {
  return record.schemaVersion === 3 || (record.artifactCleanup?.length ?? 0) > 0 ||
    record.artifacts?.some(artifact => artifact.managedFile) ||
    record.tasks?.some(task => task.state === 'abandoned') ||
    record.operationTasks?.some(task => task.state === 'abandoned')
}

export function importRequiresRetention(task) {
  return task.schemaVersion === 3 || task.state === 'abandoned'
}
