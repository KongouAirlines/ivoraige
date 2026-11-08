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
if (mode === 'empty-structure') {
  units.push({ order: 2, kind: 'body', sourceText: '', translatable: false,
    locator: { page: 2, bbox: [110, 20, 130, 40], key: 'empty-layout' } })
  records.push({ order: 2, requestText: '', sourceUnicode: '', rawSourceUnicode: null,
    page: 2, callback: false, placeholders: [] })
}
if (mode === 'coverage-summary') {
  units.push({ order: 2, kind: 'body', sourceText: 'Invented audit line', translatable: false,
    locator: { page: 2, bbox: [110, 20, 130, 40], key: 'audit' } })
  records.push({ order: 2, requestText: 'Invented audit line', sourceUnicode: 'Invented audit line',
    page: 2, callback: false, layoutLabel: 'unmapped_pdf_text', placeholders: [] })
}
if (mode === 'markdown-structure') {
  units.splice(0, units.length,
    { order: 0, kind: 'heading', sourceText: 'Results_2026 <b1>',
      locator: { page: 1 }, translatable: true },
    { order: 1, kind: 'body', sourceText: '1. Metric_Total = x\\alpha & 5 < 7; <b2> &lt; 1.',
      locator: { page: 1 }, translatable: true },
    { order: 2, kind: 'caption', sourceText: 'Figure_1: *literal* caption.',
      locator: { page: 2 }, translatable: false },
    { order: 3, kind: 'formula', sourceText: 'α_<f1> end',
      locator: { page: 2 }, translatable: false })
  records.splice(0, records.length,
    { order: 0, requestText: units[0].sourceText, placeholders: [{ token: '<b1>', text: 'a<b' }] },
    { order: 1, requestText: units[1].sourceText, placeholders: [] },
    { order: 2, requestText: units[2].sourceText, placeholders: [] },
    { order: 3, requestText: units[3].sourceText, placeholderPayloads: [
      { type: 'formula', placeholder: '<f1>', formula_chars: 'x_1 < y' } ] })
}
if (mode === 'markdown-setext') {
  units.splice(0, units.length, ...[0, 1, 2, 3, 4].map(order => ({
    order, kind: 'body', sourceText: `Line ${order}\n${' '.repeat(order)}===`,
    locator: { page: 1 }, translatable: false,
  })))
  records.splice(0, records.length, ...units.map(unit => ({
    order: unit.order, requestText: unit.sourceText, placeholders: [],
  })))
}
if (mode === 'markdown-indent') {
  const prefixes = [' ', '  ', '   ', '    ', '\t', ' \t', '  \t', '   \t',
    '\t ', ' \t ', '    \t', '     ', '\t\t', '  \t  ']
  units.splice(0, units.length, ...prefixes.map((prefix, order) => ({
    order, kind: 'body', sourceText: `${prefix}Metric_Total <note> &lt;`,
    locator: { page: 1 }, translatable: false,
  })))
  records.splice(0, records.length, ...units.map(unit => ({
    order: unit.order, requestText: unit.sourceText, placeholders: [],
  })))
}
if (mode === 'markdown-url') {
  const sources = [
    'Source https://example.com/a-b_c?key_name=1&x=2',
    'Entity https://example.com/a?x=&copy;',
    'Enclosed (https://example.com/a_(b)).',
    'Angle <https://example.com/a-b>',
    'Email user-name_test@example.com',
    'Web www.example.com/a-b_c',
    'FTP ftp://example.com/a-b_c',
    'Quote "https://example.com/a-b"',
    'Bracket https://example.com/a[b](test)',
    'Backslash https://example.com/a\\b',
    'Suffix https://example.com/a_',
    'Invalid https://[bad',
    'Spacing\n \thttps://example.com/a-b',
    'Invalid nested https://[bad:https://example.com',
    'Invalid nested www https://[badwww.example.com',
    'Invalid mail https://[bad/user-name@example.com',
    'Punctuation https://example.com/a-b;',
    'Reference_https://example.com/a-b',
    'Referencehttps://example.com/a-b_c?x=1&y=2',
    '123https://example.com/a-b',
    "Contact 'help@example.com'.",
    "Contact 'o'connor@example.com'.",
    "Contact o'connor@example.com.",
    'IPv6 https://[2001:db8::1]/a',
    'IPv6 port https://[::1]:8080/a-b?x=1&y=2',
    'IPv6 FTP ftp://[2001:db8::1]/a_b',
    'IPv6 path https://[2001:db8::1]/a[b]',
    'Adjacent invalid Reference_https://[bad/a-b',
  ]
  units.splice(0, units.length, ...sources.map((sourceText, order) => ({
    order, kind: 'body', sourceText, locator: { page: 1 }, translatable: false,
  })))
  records.splice(0, records.length, ...units.map(unit => ({
    order: unit.order, requestText: unit.sourceText, placeholders: [],
  })))
}

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
    const chinese = params.options.language.startsWith('zh')
    const parsedUnits = units.map(unit => ({ ...unit,
      sourceText: chinese && unit.translatable ? '中文 <b1> 结果。' : unit.sourceText }))
    const parsedRecords = records.map(record => ({ ...record,
      requestText: chinese && record.callback !== false ? '中文 <b1> 结果。' : record.requestText }))
    reply(id, { doc: { format: 'pdf', title: 'Fixture paper', units: parsedUnits, chapters: [], resources: [],
      ...(mode === 'coverage-summary' ? { sourceCoverage: { called: 2,
        uncalled: [{ key: 'audit', sourceUnicode: 'Invented audit line', called: false }],
        summary: { unitCount: 3, callbackCount: 2, uncalledCount: 1,
          auditOnlyLineCount: 1, emptyUnitCount: 0 } } } : {}),
      sourceBinding: { adapterId: 'babeldoc', captureConfig: params.options.language === 'en'
        ? {} : { sourceLanguage: params.options.language }, records: parsedRecords } } })
  } else if (method === 'rebuild') {
    if (mode === 'hang-once-rebuild' && marker) {
      let exists = true
      try { await access(marker) } catch { exists = false }
      if (!exists) { await writeFile(marker, 'entered'); continue }
    }
    const source = JSON.parse(await readFile(params.docRef, 'utf8'))
    const frozen = JSON.parse(await readFile(params.revisionsRef, 'utf8'))
    const body = JSON.stringify({ snapshotId: frozen.snapshot.id,
      sourceLanguage: source.document.language, targetLanguage: frozen.snapshot.targetLang,
      captureLanguage: source.sourceBinding.captureConfig?.sourceLanguage ?? 'en',
      sourceDigest: source.sourceBinding.sourceDigest,
      units: frozen.units.map(({ unit, text }) => ({ order: unit.order, page: unit.locator.page, text })) })
    // Deliberately fake PDF bytes: this fixture tests transport and frozen data flow.
    await writeFile(params.out, `%PDF-FAKE-TEST\n${body}\n`)
    reply(id, { path: params.out, ...(mode === 'warning-rebuild' ? {
      evidence: { warnings: ['PDF text extraction did not verify formula on page 1'] },
    } : {}) })
  } else if (method === 'shutdown') {
    reply(id, {})
    process.exit(0)
  }
}
