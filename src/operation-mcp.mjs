// Resource projection only; tools are contributed by OperationTools.
export const inject = ['ivoraige.mcp', 'ivoraige.operations', 'ivoraige.resources']
export function apply(ctx) {
  const registry = ctx.get('ivoraige.mcp')
  const operations = ctx.get('ivoraige.operations')
  const resource = (name, template, operation, args, description) => ctx.effect(() => registry.registerResource(name,
    { template, metadata: { mimeType: 'text/markdown', ...(description ? { description } : {}) }, read: async (uri, variables) => {
      const body = await operations.invoke(operation, args(variables))
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: `# ${name}\n\n\u0060\u0060\u0060json\n${JSON.stringify(body, null, 2)}\n\u0060\u0060\u0060\n` }] }
    } }))
  resource('Document', 'ivoraige://docs/{docId}', 'getDocument', ({ docId }) => ({ docId }))
  resource('Unit', 'ivoraige://docs/{docId}/units/{unitId}{?targetLang}', 'getUnit', ({ docId, unitId, targetLang }) =>
    ({ docId, unitId, targetLang }), 'Read a unit owned by this document. targetLang is required.')
  resource('Task', 'ivoraige://tasks/{taskId}', 'getTask', ({ taskId }) => ({ taskId }))
  ctx.effect(() => registry.registerResource('Artifact', { template: 'ivoraige://artifacts/{artifactId}',
    metadata: { description: 'Read an existing export; this never regenerates or translates.' }, read: async (uri, { artifactId }) => {
      const resource = await ctx.get('ivoraige.resources').readArtifact(artifactId)
      return { contents: [{ uri: uri.href, mimeType: resource.contentType.split(';')[0], blob: resource.bytes.toString('base64') }] }
    } }))
}
