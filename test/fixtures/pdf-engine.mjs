import { createInterface } from 'node:readline'
import { readFile, writeFile, access } from 'node:fs/promises'

const [mode = 'normal', marker] = process.argv.slice(2)
const send = value => process.stdout.write(JSON.stringify(value) + '\n')
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const sourceText = 'The result <b1> is reproducible.'
const units = [0, 1].map(order => ({
  order, kind: 'body', sourceText,
  locator: { page: order + 1, bbox: [10, 20, 100, 40] }, translatable: true,
}))
const records = units.map(unit => ({
  order: unit.order, requestText: sourceText, page: unit.locator.page,
  placeholders: [{ token: '<b1>', text: 'E = mc²' }],
}))
if (mode === 'unresolved-mapping') records[0].placeholders[0].text = null

for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line)
  if (method === 'handshake') {
    reply(id, { protocolVersion: 1, capabilities: { parse: ['pdf'], rebuild: ['pdf'] } })
  } else if (method === 'configure') {
    reply(id, {})
  } else if (method === 'parse') {
    if (mode === 'hang-parse' && marker) { await writeFile(marker, 'entered'); continue }
    if (mode === 'fail-parse') {
      send({ jsonrpc: '2.0', id, error: { code: -32001, message: 'fixture parse failure' } })
      continue
    }
    const bytes = await readFile(params.path)
    if (!bytes.includes(Buffer.from('%PDF-'))) throw new Error('expected managed PDF source')
    reply(id, { doc: { format: 'pdf', title: 'Fixture paper', units, chapters: [], resources: [],
      sourceBinding: { adapterId: 'babeldoc', records } } })
  } else if (method === 'rebuild') {
    if (mode === 'hang-once-rebuild' && marker) {
      let exists = true
      try { await access(marker) } catch { exists = false }
      if (!exists) { await writeFile(marker, 'entered'); continue }
    }
    const source = JSON.parse(await readFile(params.docRef, 'utf8'))
    const frozen = JSON.parse(await readFile(params.revisionsRef, 'utf8'))
    const body = JSON.stringify({ snapshotId: frozen.snapshot.id,
      sourceDigest: source.sourceBinding.sourceDigest,
      units: frozen.units.map(({ unit, text }) => ({ order: unit.order, page: unit.locator.page, text })) })
    // Deliberately fake PDF bytes: this fixture tests transport and frozen data flow.
    await writeFile(params.out, `%PDF-FAKE-TEST\n${body}\n`)
    reply(id, { path: params.out })
  } else if (method === 'shutdown') {
    reply(id, {})
    process.exit(0)
  }
}
