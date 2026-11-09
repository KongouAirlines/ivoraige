// Run only as a child of windows-pipe-probe.cs after that disposable process
// removes SeImpersonatePrivilege. This is same-SID testing, not a second user.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { createWindowsPipeServer, connectWindowsPipe } from '../../src/host-windows-pipe.mjs'
const address = `\\\\.\\pipe\\ivoraige-${randomBytes(16).toString('base64url')}`
const server = createWindowsPipeServer(socket => socket.once('data', () => socket.end('same-user\n')))
server.listen(address, () => {})
await once(server, 'listening')
const client = connectWindowsPipe(address)
try {
  await once(client, 'connect')
  const reply = once(client, 'data')
  client.write('synthetic\n')
  assert.equal((await reply)[0].toString(), 'same-user\n')
  console.log('same-SID-without-SeImpersonatePrivilege')
} finally { client.destroy(); await new Promise(resolve => server.close(resolve)) }
