// Renderers receive only resolved frozen data, never a Cordis context or service.
const supports = binding => binding?.adapterId === 'txt'

export const markdown = {
  id: 'md',
  supports,
  rebuild({ snapshot, document, units }) {
    const title = document.title.replace(/[\r\n]+/g, ' ')
    return `<!-- ivoraige snapshot:${snapshot.id} revisions:${snapshot.revisionSetHash} -->\n\n` +
      `# ${title}\n\n` + units.map(item => item.text).join('\n\n') + '\n'
  },
}

export const json = {
  id: 'json',
  supports,
  rebuild({ snapshot, document, units }) {
    return JSON.stringify({
      snapshotId: snapshot.id,
      revisionSetHash: snapshot.revisionSetHash,
      document: {
        id: document.id, sourceId: document.sourceId, title: document.title,
        sourceLang: document.language, targetLang: snapshot.targetLang,
      },
      units: units.map(({ unit, decision, text }) => ({
        id: unit.id, order: unit.order, kind: unit.kind, locator: unit.locator,
        sourceText: unit.sourceText, text, decision,
      })),
    }, null, 2) + '\n'
  },
}

export function TextOutputs(ctx) {
  for (const adapter of [markdown, json]) {
    ctx.effect(() => ctx.get('ivoraige.outputs').register(adapter))
  }
}
TextOutputs.inject = ['ivoraige.outputs']
