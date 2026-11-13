// The parent PowerShell process sets Restricted for this disposable process
// tree only. The actual adapter child inherits it and supplies no override.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { createWindowsPipeServer, connectWindowsPipe } from '../../src/host-windows-pipe.mjs'
assert.equal(process.env.PSExecutionPolicyPreference, 'Restricted')
const address = `\\\\.\\pipe\\ivoraige-${randomBytes(16).toString('base64url')}`
const server = createWindowsPipeServer(socket => socket.once('data', () => socket.end('restricted-policy\n')))
server.listen(address, () => {})
await once(server, 'listening')
assert.ok(server.owner.child.spawnargs.includes('-Command'))
assert.ok(!server.owner.child.spawnargs.includes('-ExecutionPolicy'))
const client = connectWindowsPipe(address)
try {
  await once(client, 'connect')
  const reply = once(client, 'data')
  client.write('synthetic\n')
  assert.equal((await reply)[0].toString(), 'restricted-policy\n')
  console.log('actual-helper-under-Restricted')
} finally {
  client.destroy()
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
