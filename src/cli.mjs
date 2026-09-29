#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createApp } from './app.mjs'
import { resolveBasis } from './terms.mjs'

const help = `ivoraige M2 text CLI
node src/cli.mjs <command> [arguments] --store <directory> [--config <JSON>]
import <text-file> [--id <document>] [--source en|zh] [--target zh|en] [--title <title>]
show <document>
source-edit <document> <unit> <text-file>
target <document> <changes-JSON-file>
libraries <document> <library-id>...
translate <document> [--review] [--force]
check <document> [<unit>]
confirm <document> <unit> <revision> [--actor <name>]
edit <document> <unit> <revision> <translation-file> [--actor <name>]
export <document> [--md <file>] [--json <file>]
terms create <library> [--scope shared|project]
terms list [<library>]
terms add <library> <entry-JSON-file>
terms confirm <library> <entry> [<changes-JSON-file>]
terms merge <library> <keep-entry> <remove-entry>
terms import <library-JSON-file>
terms export <library> <file>
build <library> <source-text-file> [--source-ref <description>]
Only translate/build mount model services. Generated text is a draft until confirm/edit.
`
function parse(argv) {
  const positional = [], flags = {}
  const booleans = new Set(['review', 'force', 'help'])
  const values = new Set(['store', 'config', 'id', 'source', 'target', 'title', 'scope', 'md', 'json', 'source-ref', 'actor'])
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (!arg.startsWith('--')) { positional.push(arg); continue }
    const key = arg.slice(2)
    if (booleans.has(key)) flags[key] = true
    else if (values.has(key)) {
      if (argv[index + 1] === undefined || argv[index + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`)
      flags[key] = argv[++index]
    } else throw new Error(`Unknown option: ${arg}`)
  }
  return { positional, flags }
}
const textFile = path => readFile(path, 'utf8')
const jsonFile = async path => JSON.parse(await textFile(path))
function requireArgs(args, count, command) { if (args.length < count) throw new Error(`Missing arguments for ${command}; use --help`) }
async function saveJson(path, data) { await mkdir(dirname(resolve(path)), { recursive: true }); await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8'); return { path: resolve(path) } }

export async function main(argv = process.argv.slice(2)) {
  const { positional: [command, ...args], flags } = parse(argv)
  if (!command || flags.help) { process.stdout.write(help); return }
  const config = flags.config ? await jsonFile(flags.config) : {}
  const store = flags.store ?? config.store
  if (!store) throw new Error('Explicit --store or config.store is required')
  const needsModel = command === 'translate' || command === 'build'
  if (needsModel && !config.model) throw new Error(`${command} requires config.model`)
  const app = await createApp({ store: resolve(store), terms: config.terms ?? true, builder: config.builder ?? true, ...(needsModel ? { model: config.model } : {}) })
  let result
  try {
    switch (command) {
      case 'import': requireArgs(args, 1, command); result = await app.records.importText({ text: await textFile(args[0]), documentId: flags.id, sourceLanguage: flags.source ?? 'en', targetLanguage: flags.target ?? 'zh', title: flags.title ?? args[0] }); break
      case 'show': requireArgs(args, 1, command); result = app.records.getDocument(args[0]); break
      case 'source-edit': requireArgs(args, 3, command); result = await app.records.updateSource(args[0], args[1], await textFile(args[2])); break
      case 'target': requireArgs(args, 2, command); result = await app.records.updateTarget(args[0], await jsonFile(args[1])); break
      case 'libraries': requireArgs(args, 1, command); result = await app.records.selectLibraries(args[0], args.slice(1)); break
      case 'translate': {
        requireArgs(args, 1, command)
        const run = app.task.start(args[0], { review: !!flags.review, force: !!flags.force, onProgress: item => process.stderr.write(JSON.stringify({ unitId: item.unitId, status: item.status, error: item.error }) + '\n') })
        const cancel = () => run.cancel()
        process.on('SIGINT', cancel)
        try { result = await run.done } finally { process.off('SIGINT', cancel) }
        if (result.status === 'failed') process.exitCode = 1
        if (result.status === 'cancelled') process.exitCode = 130
        break
      }
      case 'check': {
        requireArgs(args, 1, command)
        const doc = app.records.getDocument(args[0]); const units = args[1] ? doc.units.filter(u => u.id === args[1]) : doc.units
        if (!units.length) throw new Error('Unknown unit')
        result = []
        for (const unit of units) { const resolved = resolveBasis(app.records, app.terms, doc.id, unit.id); result.push({ unitId: unit.id, ...await app.records.recordCheck(doc.id, unit.id, resolved.basis), conflicts: resolved.conflicts }) }
        break
      }
      case 'confirm': case 'edit': {
        requireArgs(args, command === 'edit' ? 4 : 3, command)
        const [docId, unitId, revisionId] = args; const doc = app.records.getDocument(docId); const unit = doc.units.find(u => u.id === unitId)
        if (!unit) throw new Error('Unknown unit')
        const { basis } = resolveBasis(app.records, app.terms, docId, unitId)
        result = await app.records.accept(docId, unitId, revisionId, basis, { expectedAcceptedId: unit.acceptedId, actor: flags.actor ?? 'user', ...(command === 'edit' ? { text: await textFile(args[3]) } : {}) })
        break
      }
      case 'export': {
        requireArgs(args, 1, command)
        const outputs = ['md', 'json'].filter(format => flags[format]).map(format => ({ format, path: resolve(flags[format]) }))
        if (!outputs.length) throw new Error('export requires --md or --json')
        result = await app.exporter.write(args[0], outputs); break
      }
      case 'terms': {
        if (!app.terms) throw new Error('terms commands require ivoraige.terms')
        const [action, ...rest] = args
        if (action === 'create') { requireArgs(rest, 1, 'terms create'); result = await app.terms.createLibrary(rest[0], flags.scope ?? 'shared') }
        else if (action === 'list') result = rest[0] ? app.terms.exportLibrary(rest[0]) : Object.values(app.records.snapshot().libraries)
        else if (action === 'add') { requireArgs(rest, 2, 'terms add'); result = await app.terms.put(rest[0], await jsonFile(rest[1])) }
        else if (action === 'confirm') { requireArgs(rest, 2, 'terms confirm'); result = await app.terms.confirm(rest[0], rest[1], rest[2] ? await jsonFile(rest[2]) : {}) }
        else if (action === 'merge') { requireArgs(rest, 3, 'terms merge'); result = await app.terms.merge(...rest.slice(0, 3)) }
        else if (action === 'import') { requireArgs(rest, 1, 'terms import'); result = await app.terms.importLibrary(await jsonFile(rest[0])) }
        else if (action === 'export') { requireArgs(rest, 2, 'terms export'); result = await saveJson(rest[1], app.terms.exportLibrary(rest[0])) }
        else throw new Error('Unknown terms command; use --help')
        break
      }
      case 'build': {
        requireArgs(args, 2, command)
        if (!app.termBuilder) throw new Error('build requires ivoraige.termBuilder and ivoraige.terms')
        const controller = new AbortController(); const cancel = () => controller.abort('user cancellation')
        process.on('SIGINT', cancel)
        try { result = await app.termBuilder.build(args[0], await textFile(args[1]), flags['source-ref'] ?? args[1], controller.signal) }
        finally { process.off('SIGINT', cancel) }
        break
      }
      default: throw new Error('Unknown command; use --help')
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return result
  } finally { await app.dispose() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = error.name === 'AbortError' ? 130 : 1 })
}
