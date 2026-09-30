// Engineering acceptance of source-checked R03 pages 2 and 4.
import { readFile, writeFile } from 'node:fs/promises'
import { createApp } from '../../src/app.mjs'
import { projectBabeldocText as projectPdfText } from '../../src/adapters/babeldoc-source.mjs'
import { resolveBasis } from '../../src/terms.mjs'

const root = new URL('../../', import.meta.url)
const at = name => new URL(name, root)
const draft = JSON.parse(await readFile(at('evaluation/runs/m3-4/pages24-draft.json')))
const store = at('evaluation/runs/m3-4/store').pathname.replace(/^\/(?=[A-Z]:)/, '')
const app = await createApp({ store })
const revisions = []
try {
  for (const item of draft.units) {
    const docId = item.unit_id.includes('-p02-') ? 'R03-p2' : 'R03-p4'
    const unit = app.records.getDocument(docId).units.find(value => value.id === item.unit_id)
    if (!unit) throw new Error(`Unknown source unit ${item.unit_id}`)
    let projection = item.engine_projection
    if (unit.id === 'R03-M3-2-p04-u004') projection = projection.replace('与 <b2>', '与<b2>').replace('0.1 T<b4>', '0.1 T <b4>')
    if (unit.id === 'R03-M3-2-p04-u007') projection = '其中 <b1> 是旋磁比（rad/(T·s)），<b2> 是无量纲阻尼参数，<b3>B<b4> 是有效场（T）。用户可以覆盖 <b6> 的默认值。<b5>B<b7> 包含以下分量：'
    if (unit.id === 'R03-M3-2-p04-u008') projection = '<b1> 外加磁场 矢量 B_ext'
    for (const [number, name] of [[9, 'demag'], [10, 'exch'], [11, 'dm'], [12, 'anis'], [13, 'therm']]) {
      if (unit.id.endsWith(`p04-u${String(number).padStart(3, '0')}`)) projection = projection.replace('<b1>', '<b1> ').replace(`B${name}`, `B_${name}`)
    }
    if (unit.id === 'R03-M3-2-p04-u017') projection = projection.replace('其中 <b1>', '其中<b1>')
    const readable = projectPdfText(projection, unit.placeholders, unit.placeholderDisplay, unit.placeholderOrder)
    if (readable !== item.readable_target) throw new Error(`Readable text differs from source-checked draft: ${unit.id}\n${readable}\n${item.readable_target}`)
    const { basis } = resolveBasis(app.records, app.terms, docId, unit.id)
    const modelDraft = unit.revisions.find(value => value.status === 'draft')
    const basisDraft = modelDraft ?? await app.records.saveDraft(docId, unit.id, { text: projection, basis,
      provenance: { kind: 'agent-source-reviewed-draft', modelAttempt: 'local hy-mt2-1.8b; malformed structure rejected where applicable' }, finish: { kind: 'stop' } })
    const accepted = await app.records.accept(docId, unit.id, basisDraft.id, basis, {
      expectedAcceptedId: null, actor: 'agent-engineering-review', text: projection,
    })
    revisions.push({ unitId: unit.id, revisionId: accepted.id, modelDraft: !!modelDraft, decision: item.decision, reason: item.reason ?? item.note ?? null })
  }
  const revise = async (unitId, text, reason) => {
    const docId = 'R03-p4'
    const unit = app.records.getDocument(docId).units.find(value => value.id === unitId)
    const { basis } = resolveBasis(app.records, app.terms, docId, unitId)
    const accepted = await app.records.accept(docId, unitId, unit.acceptedId, basis, {
      expectedAcceptedId: unit.acceptedId, actor: 'agent-engineering-review', ...(text ? { text } : {}),
    })
    const entry = revisions.find(value => value.unitId === unitId)
    entry.revisionId = accepted.id
    entry.reason = reason
    return accepted
  }
  await revise('R03-M3-2-p04-u002', 'analytical',
    'Chart legend stays in original English because its Chinese label overlapped the plotted curve.')
  const labels = [
    [8, '外加磁场', '<b1> 外加磁场 矢量 B_ext'],
    [9, '静磁场'], [10, '海森堡交换场'], [11, 'DMI 交换场', '<b1> DMI 交换场 <b2>B_dm（III D）'],
    [12, '磁晶各向异性场'], [13, '热场'],
  ]
  for (const [number, label, text] of labels) {
    const unitId = `R03-M3-2-p04-u${String(number).padStart(3, '0')}`
    const reason = number === 11
      ? 'Dzyaloshinskii–Moriya is abbreviated DMI to fit before the original B_dm vector glyph and reference.'
      : 'Keep the original B vector arrow, subscript and reference at their source positions; translate the label at left.'
    await app.records.correctSourceBinding('R03-p4', unitId, 'field', { label, reason })
    await revise(unitId, text, reason)
  }
  for (const [page, docId] of [[2, 'R03-p2'], [4, 'R03-p4']]) {
    const manifest = app.records.manifest(docId)
    await writeFile(at(`evaluation/runs/m3-4/frozen-page${page === 4 ? '4-dmi' : '2'}.json`), JSON.stringify(manifest, null, 2) + '\n')
  }
  await writeFile(at('evaluation/runs/m3-4/acceptance.json'), JSON.stringify({ status: 'agent_engineering_accepted_not_human_scientific_signoff', units: revisions,
    sourceNote: 'Page 2 original says indices between 0 and 256 while also naming a 256-element table; translated literally without inventing a corrected bound.' }, null, 2) + '\n')
  console.log(`Accepted ${revisions.length} page 2/4 units`)
} finally { await app.dispose() }
