// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

// Renderers receive only resolved frozen data, never a Cordis context or service.
const supports = binding => typeof binding?.adapterId === 'string' && !!binding.adapterId

export const markdown = {
  id: 'md',
  version: '0.1.0',
  formats: ['md'],
  requiredViews: ['readable-text', 'native-markdown'],
  supports,
  rebuild(data) {
    if (data.nativeMarkdown !== undefined) return data.nativeMarkdown
    const { snapshot, document, units } = data
    const title = document.title.replace(/[\r\n]+/g, ' ')
    return `<!-- ivoraige snapshot:${snapshot.id} revisions:${snapshot.revisionSetHash} -->\n\n` +
      `# ${title}\n\n` + units.map(item => item.readableText ?? item.text).join('\n\n') + '\n'
  },
}

export const json = {
  id: 'json',
  version: '0.1.0',
  formats: ['json'],
  requiredViews: ['readable-text'],
  supports,
  rebuild({ snapshot, document, units }) {
    return JSON.stringify({
      snapshotId: snapshot.id,
      contentMode: snapshot.contentMode ?? 'accepted-translation',
      revisionSetHash: snapshot.revisionSetHash,
      document: {
        id: document.id, sourceId: document.sourceId, title: document.title,
        sourceLang: document.language,
        ...(snapshot.targetLang ? { targetLang: snapshot.targetLang } : {}),
      },
      units: units.map(({ unit, decision, text, readableText }) => ({
        id: unit.id, order: unit.order, kind: unit.kind, locator: unit.locator,
        sourceText: unit.sourceText, text: readableText ?? text, decision,
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
