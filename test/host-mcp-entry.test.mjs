import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { runMcpOwnerStdio } from '../src/mcp.mjs'

test('attached stdio MCP forwards tools and resources without exiting its owner', async () => {
  const stdin = new PassThrough(), stdout = new PassThrough()
  const requests = []
  let output = ''
  stdout.on('data', chunk => { output += chunk })
  const client = { async request(action, params) {
    requests.push({ action, params })
    if (action === 'mcp.describe') return {
      tools: [{ name: 'ivoraige_capabilities', description: 'Capabilities',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false } }],
      resources: [{ name: 'Document', template: 'ivoraige://docs/{docId}', metadata: { mimeType: 'text/markdown' } }],
    }
    if (action === 'mcp.call') return { apiVersion: '2.0', features: ['documents'] }
    if (action === 'mcp.read') return { contents: [{ uri: params.uri, text: '# Document' }] }
    throw new Error(`Unexpected owner action: ${action}`)
  } }
  const running = runMcpOwnerStdio(client, { stdin, stdout })
  const until = async id => {
    for (let i = 0; i < 100; i++) {
      const frame = output.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(message => message.id === id)
      if (frame) return frame
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error(`MCP response ${id} did not arrive`)
  }
  const send = (id, method, params) => stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  try {
    send(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    assert.ok((await until(1)).result)
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
    send(2, 'tools/list', {})
    assert.deepEqual((await until(2)).result.tools.map(tool => tool.name), ['ivoraige_capabilities'])
    send(3, 'tools/call', { name: 'ivoraige_capabilities', arguments: {} })
    assert.deepEqual((await until(3)).result.structuredContent.features, ['documents'])
    send(4, 'resources/templates/list', {})
    assert.equal((await until(4)).result.resourceTemplates[0].uriTemplate, 'ivoraige://docs/{docId}')
    send(5, 'resources/read', { uri: 'ivoraige://docs/doc-1' })
    assert.equal((await until(5)).result.contents[0].text, '# Document')
    assert.ok(requests.some(request => request.action === 'mcp.read' && request.params.name === 'Document' &&
      request.params.variables.docId === 'doc-1'))
  } finally { stdin.end(); await running; stdout.destroy() }
  assert.ok(!requests.some(request => request.action === 'exit' || request.action === 'drain'))
})
