import './fixtures/host-test-env.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { ownerMcp } from '../src/mcp.mjs'

test('owner MCP dispatch checks current entry availability and forwards tools/resources', async () => {
  let entry = {}
  const controller = new AbortController()
  const app = { ctx: { get: () => entry }, mcp: {
    tools: new Map([['echo', { description: 'echo', inputSchema: z.object({ text: z.string() }),
      invoke: (input, { signal }) => { assert.equal(signal, controller.signal); return input } }]]),
    resources: new Map([['item', { template: 'ivoraige://items/{id}',
      read: (uri, variables, { signal }) => {
        assert.equal(signal, controller.signal)
        return variables.id
      } }]])
  } }
  assert.equal((await ownerMcp(app, 'mcp.describe')).tools[0].name, 'echo')
  assert.deepEqual(await ownerMcp(app, 'mcp.call', { name: 'echo', input: { text: 'hello' } },
    { signal: controller.signal }), { text: 'hello' })
  assert.equal(await ownerMcp(app, 'mcp.read', { name: 'item', uri: 'ivoraige://items/one',
    variables: { id: 'untrusted' } }, { signal: controller.signal }), 'one')
  entry = { closing: true }
  for (const method of ['mcp.describe', 'mcp.call', 'mcp.read'])
    await assert.rejects(ownerMcp(app, method, {}), { code: 'COMPONENT_MISSING' })
  entry = null
  await assert.rejects(ownerMcp(app, 'mcp.describe'), { code: 'COMPONENT_MISSING' })
})
