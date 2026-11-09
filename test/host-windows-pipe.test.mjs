import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createWindowsPipeServer, connectWindowsPipe } from '../src/host-windows-pipe.mjs'

const windows = { skip: process.platform !== 'win32', timeout: 60_000 }
const ps = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const probe = fileURLToPath(new URL('./fixtures/windows-pipe-probe.cs', import.meta.url))
const quote = value => `'${value.replaceAll("'", "''")}'`
const script = code => `$ErrorActionPreference = 'Stop'; Add-Type -Path ${quote(probe)} -ReferencedAssemblies System,System.Core; ${code}`
const address = () => `\\\\.\\pipe\\ivoraige-${randomBytes(16).toString('base64url')}`
const execute = code => promisify(execFile)(ps, ['-NoProfile', '-NonInteractive', '-Command', script(code)],
  { windowsHide: true, timeout: 40_000, maxBuffer: 8192 })
async function listen(onConnection = socket => socket.once('data', () => socket.end('accepted\n')), endpoint = address()) {
  const server = createWindowsPipeServer(onConnection)
  server.listen(endpoint, () => {})
  await once(server, 'listening')
  return { server, endpoint, close: () => new Promise(resolve => server.close(resolve)) }
}

test('Windows pipe has exact native owner DACL and authenticates an actual same-user peer', windows, async () => {
  let peerSid
  const host = await listen(socket => {
    peerSid = socket.peerSid
    assert.ok(Number.isInteger(socket.peerPid) && socket.peerPid > 0)
    socket.once('data', () => socket.end('accepted\n'))
  })
  try {
    const { stdout } = await execute(`[WindowsPipeProbe]::Inspect(${quote(host.endpoint)})`)
    assert.equal(stdout.trim(), peerSid)
    assert.match(peerSid, /^S-1-/)
  } finally { await host.close() }
})

test('Windows native DACL rejects a different anonymous TokenUser before Node dispatch', windows, async () => {
  let calls = 0
  const host = await listen(() => calls++)
  try {
    const { stdout } = await execute(`[WindowsPipeProbe]::AnonymousDenied(${quote(host.endpoint)})`)
    assert.equal(stdout.trim(), 'S-1-5-7:ERROR_ACCESS_DENIED')
    assert.equal(calls, 0)
  } finally { await host.close() }
})

test('Windows client rejects a permissive pipe before sending any frame', windows, async () => {
  const endpoint = address()
  const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-Command',
    script(`[WindowsPipeProbe]::RejectInsecureServer(${quote(endpoint)})`)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = '', errors = ''
  child.stderr.on('data', chunk => { errors += chunk })
  const completed = once(child, 'exit')
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('ready')) resolve() })
    child.once('error', reject)
    child.once('exit', () => reject(new Error(`Probe exited before ready: ${errors}`)))
  })
  let client
  try {
    await ready
    client = connectWindowsPipe(endpoint)
    client.once('connect', () => client.write('must-not-be-transmitted\n'))
    await assert.rejects(once(client, 'connect'), { code: 'PRECONDITION_FAILED' })
    assert.equal((await completed)[0], 0, errors)
    assert.match(output, /no-data/)
  } finally { client?.destroy(); child.kill() }
})

test('Windows first-instance creation refuses a preexisting native pipe', windows, async () => {
  const first = await listen()
  const duplicate = createWindowsPipeServer(() => assert.fail('Duplicate listener accepted a peer'))
  try {
    duplicate.listen(first.endpoint, () => assert.fail('Duplicate listener became ready'))
    await assert.rejects(once(duplicate, 'listening'), { code: 'PRECONDITION_FAILED' })
  } finally { await new Promise(resolve => duplicate.close(resolve)); await first.close() }
})

test('Windows preserves multiple frames and fails closed when the helper terminates', windows, async () => {
  const sockets = []
  const host = await listen(socket => {
    sockets.push(socket)
    socket.once('data', () => { if (sockets.length === 1) { socket.write('accepted\n'); socket.end('finalized\n') } })
  })
  const client = connectWindowsPipe(host.endpoint)
  try {
    await once(client, 'connect')
    const chunks = []
    client.on('data', chunk => chunks.push(chunk))
    const ended = once(client, 'end')
    client.write('synthetic\n')
    await ended
    assert.equal(Buffer.concat(chunks).toString(), 'accepted\nfinalized\n')
    const live = connectWindowsPipe(host.endpoint)
    await once(live, 'connect')
    const accepted = once(host.server, 'connection')
    live.write('hold-open\n')
    await accepted
    const liveClosed = new Promise(resolve => live.once('close', resolve))
    const failed = once(host.server, 'error')
    host.server.owner.child.kill()
    assert.equal((await failed)[0].code, 'PRECONDITION_FAILED')
    await liveClosed
    assert.ok(sockets.every(socket => socket.destroyed))
  } finally { client.destroy(); for (const socket of sockets) socket.destroy(); await host.close() }
})

test('Windows same-SID native transport does not need SeImpersonatePrivilege', windows, async () => {
  const runner = fileURLToPath(new URL('./fixtures/windows-pipe-unprivileged.mjs', import.meta.url))
  const { stdout } = await execute(`$result = [WindowsPipeProbe]::WithoutImpersonationPrivilege(${quote(process.execPath)}, ${quote(runner)}); if ($result -ne 0) { throw 'Reduced-token exchange failed' }`)
  assert.match(stdout, /same-SID-without-SeImpersonatePrivilege/)
})


test('Windows helper startup queue is bounded before serializing native traffic', windows, async () => {
  const client = connectWindowsPipe(address())
  const failure = once(client, 'error')
  for (let i = 0; i < 10 && !client.destroyed; i++) client.write(Buffer.alloc(1024 * 1024, 120))
  assert.equal((await failure)[0].code, 'PRECONDITION_FAILED')
  assert.equal(client.destroyed, true)
})
