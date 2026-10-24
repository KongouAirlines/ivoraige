// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { IVORAIGE_DSH_COMMIT } from '../dist/dsh.mjs'
import { KernelError } from './errors.mjs'
import { documentRequiresRetention, importRequiresRetention } from './retention-payload.mjs'

const unitName = 'ivoraige_records'
// This small adapter touches the private layout of exactly this DSH build.
const supportedPin = '639ed015397290b3745d163aafe02ffee4aa3f84'

function layoutError() {
  return new KernelError('PRECONDITION_FAILED', 'Pinned DSH SQLite layout is incompatible or damaged')
}

function verifyPin() {
  if (IVORAIGE_DSH_COMMIT !== supportedPin) throw layoutError()
}

function versionError(version) {
  return new KernelError('PRECONDITION_FAILED', 'Records storage domain version is unsupported', { version })
}

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
}

function isStrictTable(db, name) {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.sql
  return typeof sql === 'string' && /\)\s*STRICT\s*$/i.test(sql)
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info("${table}")`).all().map(row =>
    [row.name, row.type, row.notnull, row.pk])
}

function verifyLayout(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version
  const tables = ['units', 'unit_globals', 'u_ivoraige_records_documents', 'u_ivoraige_records_imports']
  const present = tables.map(name => hasTable(db, name))
  const userTables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
  if (version === 0 && userTables.length === 0) return 'new'
  if (version !== 1 || !present[0] || !present[1]) throw layoutError()
  const expected = [
    [['name', 'TEXT', 1, 1], ['version', 'INTEGER', 1, 0]],
    [['unit', 'TEXT', 1, 1], ['value', 'TEXT', 1, 0]],
    [['key', 'TEXT', 1, 1], ['value', 'TEXT', 1, 0]],
    [['key', 'TEXT', 1, 1], ['value', 'TEXT', 1, 0]],
  ]
  for (let i = 0; i < tables.length; i++) {
    if (present[i] && (!isStrictTable(db, tables[i]) ||
        JSON.stringify(columns(db, tables[i])) !== JSON.stringify(expected[i]))) throw layoutError()
  }
  const row = db.prepare('SELECT version FROM units WHERE name = ?').get(unitName)
  if (!row && (present[2] || present[3]) || row && (!present[2] || !present[3])) throw layoutError()
  return row ? row.version : 'new-unit'
}

function hasRetentionRows(db) {
  let found = false
  for (const [table, isRetention] of [
    ['u_ivoraige_records_documents', documentRequiresRetention],
    ['u_ivoraige_records_imports', importRequiresRetention],
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
  verifyPin()
  const db = new DatabaseSync(storePath, { timeout: 1000 })
  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      const layoutVersion = verifyLayout(db)
      if (layoutVersion !== 1 && layoutVersion !== 2) throw versionError(layoutVersion)
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
  verifyPin()
  if (!existsSync(storePath)) return { version: 2, activateRetention() {} }
  const db = new DatabaseSync(storePath, { readOnly: true })
  let version, preexistingRetention
  try {
    version = verifyLayout(db)
    if (version === 'new' || version === 'new-unit') return { version: 2, activateRetention() {} }
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
