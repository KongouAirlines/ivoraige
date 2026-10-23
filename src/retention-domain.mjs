// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { KernelError } from './errors.mjs'

const unitName = 'ivoraige_records'

function versionError(version) {
  return new KernelError('PRECONDITION_FAILED', 'Records storage domain version is unsupported', { version })
}

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
}

function hasRetentionRows(db) {
  let found = false
  for (const [table, isRetention] of [
    ['u_ivoraige_records_documents', record => record.schemaVersion === 3 ||
      (record.artifactCleanup?.length ?? 0) > 0 ||
      record.artifacts?.some(artifact => artifact.managedFile) ||
      record.tasks?.some(task => task.state === 'abandoned') ||
      record.operationTasks?.some(task => task.state === 'abandoned')],
    ['u_ivoraige_records_imports', task => task.schemaVersion === 3 || task.state === 'abandoned'],
  ]) {
    if (!hasTable(db, table)) continue
    for (const { value } of db.prepare(`SELECT value FROM "${table}"`).all()) {
      let record
      try { record = JSON.parse(value) }
      catch { throw new KernelError('PRECONDITION_FAILED', 'Records payload cannot be inspected for storage gate') }
      if (!record || typeof record !== 'object' || Array.isArray(record))
        throw new KernelError('PRECONDITION_FAILED', 'Records payload cannot be inspected for storage gate')
      if (!isRetention(record)) continue
      if (table.endsWith('_documents') && (record.schemaVersion !== 3 ||
          (record.sourceIR && record.sourceIR.version !== 1)) ||
          table.endsWith('_imports') && record.schemaVersion !== 3) {
        throw new KernelError('PRECONDITION_FAILED', 'Retention payload version is unsupported')
      }
      found = true
    }
  }
  return found
}

// Only the DSH unit header is changed here. DSH still owns every table row and
// all record serialization; the store owner lock already excludes another app.
function promote(storePath) {
  const db = new DatabaseSync(storePath, { timeout: 1000 })
  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      const current = db.prepare('SELECT version FROM units WHERE name = ?').get(unitName)?.version
      if (current !== 1 && current !== 2) throw versionError(current)
      if (current === 1) {
        const result = db.prepare('UPDATE units SET version = 2 WHERE name = ? AND version = 1').run(unitName)
        if (result.changes !== 1) throw versionError(current)
      }
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  } finally { db.close() }
}

export function inspectRetentionDomain(storePath) {
  if (!existsSync(storePath)) return { version: 2, activateRetention() {} }
  const db = new DatabaseSync(storePath, { readOnly: true })
  let version, preexistingRetention
  try {
    if (!hasTable(db, 'units')) return { version: 2, activateRetention() {} }
    version = db.prepare('SELECT version FROM units WHERE name = ?').get(unitName)?.version
    if (version === undefined) return { version: 2, activateRetention() {} }
    if (version !== 1 && version !== 2) throw versionError(version)
    preexistingRetention = version === 1 && hasRetentionRows(db)
  } finally { db.close() }
  if (preexistingRetention) { promote(storePath); version = 2 }
  return {
    version,
    activateRetention() {
      if (version === 2) return
      promote(storePath)
      version = 2
    },
  }
}
