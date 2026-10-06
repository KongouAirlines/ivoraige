#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const directory = 'docs/plan/follow-ups/'
const legacyPath = 'docs/plan/deferred.md'
const statuses = new Set(['待评估', '已安排', '处理中', '已解决', '暂缓', '无需处理', '重复'])
const fields = ['ID', '状态', '实施分支／PR']

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: false })
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('\r', ' ')
}

function parseRecord(source, filename, ref) {
  const metadata = new Map()
  for (const line of source.split(/\r?\n/)) {
    const match = /^- (ID|状态|实施分支／PR): (.*)$/.exec(line)
    if (!match) continue
    if (metadata.has(match[1])) throw new Error(`${ref}:${filename}: duplicate ${match[1]} metadata`)
    metadata.set(match[1], match[2].trim())
  }
  for (const field of fields) {
    if (!metadata.get(field)) throw new Error(`${ref}:${filename}: missing ${field} metadata`)
  }
  const id = metadata.get('ID')
  const slug = path.posix.basename(filename, '.md')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id !== slug) {
    throw new Error(`${ref}:${filename}: ID must match the lowercase kebab-case filename`)
  }
  if (!statuses.has(metadata.get('状态'))) {
    throw new Error(`${ref}:${filename}: invalid 状态 ${metadata.get('状态')}`)
  }
  const title = /^#\s+(.+?)\s*$/m.exec(source)?.[1]
  if (!title) throw new Error(`${ref}:${filename}: missing heading title`)
  return { id, title, status: metadata.get('状态'), implementation: metadata.get('实施分支／PR'), source }
}

function parseArgs(args) {
  if (args.includes('--help') || args.includes('-h')) return { help: true }
  if (args.length === 0) return { refs: ['HEAD'] }
  if (args[0] !== '--refs' || args.length < 2 || args.slice(1).some(arg => arg.startsWith('-'))) {
    throw new Error('usage: node scripts/followups.mjs [--refs REF [REF ...]]')
  }
  return { refs: args.slice(1) }
}

export function main(cwd = process.cwd(), args = []) {
  const parsed = parseArgs(args)
  if (parsed.help) {
    return 'Usage: npm run followups -- [--refs REF [REF ...]]\nCompare committed follow-up records across local Git refs (default: HEAD).\n'
  }

  // Resolve every ref before reading any tree. No fetch, checkout, or working-tree read is needed.
  const snapshots = parsed.refs.map(ref => {
    let commit
    try {
      commit = git(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim()
    } catch {
      throw new Error(`unknown local Git ref: ${ref}`)
    }
    return { ref, commit, records: new Map(), legacy: false }
  })

  for (const snapshot of snapshots) {
    const names = git(cwd, ['ls-tree', '-r', '--name-only', snapshot.commit, '--', directory])
      .split(/\r?\n/)
      .filter(name => name.startsWith(directory) && name !== `${directory}README.md` &&
        /^[^/]+\.md$/.test(name.slice(directory.length)))
      .sort()
    for (const name of names) {
      const source = git(cwd, ['show', `${snapshot.commit}:${name}`])
      const record = parseRecord(source, name, snapshot.ref)
      if (snapshot.records.has(record.id)) throw new Error(`${snapshot.ref}: duplicate ID ${record.id}`)
      snapshot.records.set(record.id, record)
    }
    try {
      snapshot.legacy = /^###\s+/m.test(git(cwd, ['show', `${snapshot.commit}:${legacyPath}`]))
    } catch {
      snapshot.legacy = false
    }
  }

  const ids = [...new Set(snapshots.flatMap(snapshot => [...snapshot.records.keys()]))].sort()
  const lines = [
    '# Follow-up records',
    '',
    'This report reads local committed Git snapshots only; uncommitted changes are excluded. It does not reconcile statuses or infer completion.',
    '',
    '| ID | Ref | Title | Status | Implementation branch / PR | Comparison |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  if (ids.length === 0) {
    for (const snapshot of snapshots) lines.push(`| — | ${escapeCell(snapshot.ref)} | No records | — | — | — |`)
  } else {
    for (const id of ids) {
      const present = snapshots.map(snapshot => snapshot.records.get(id)).filter(Boolean)
      const divergent = new Set(present.map(record => record.source)).size > 1
      for (const snapshot of snapshots) {
        const record = snapshot.records.get(id)
        const comparison = record ? (divergent ? '⚠ Content differs across refs' : '—') : '⚠ Missing in this ref'
        lines.push(`| ${escapeCell(id)} | ${escapeCell(snapshot.ref)} | ${record ? escapeCell(record.title) : '—'} | ${record ? escapeCell(record.status) : '—'} | ${record ? escapeCell(record.implementation) : '—'} | ${comparison} |`)
      }
    }
    for (const snapshot of snapshots.filter(item => item.records.size === 0)) {
      lines.push(`| — | ${escapeCell(snapshot.ref)} | No records | — | — | — |`)
    }
  }
  const legacy = snapshots.filter(snapshot => snapshot.legacy).map(snapshot => snapshot.ref)
  if (legacy.length) {
    lines.push('', `⚠ Legacy headings exist in ${legacy.map(escapeCell).join(', ')} at ${legacyPath}; they are not canonical follow-up records.`)
  }
  return `${lines.join('\n')}\n`
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(main(process.cwd(), process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`followups: ${error.message}\n`)
    process.exitCode = 1
  }
}
