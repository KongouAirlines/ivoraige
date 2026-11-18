// Cross-platform tests of the JS broker with a deliberately unresponsive fake
// child. These are lifecycle fault injection, not native Windows acceptance.
import test from 'node:test'
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { EventEmitter, once } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { createWindowsPipeServer, connectWindowsPipe } from '../src/host-windows-pipe.mjs'
import { exchangeHostFrame } from '../src/host-transport.mjs'

const sid = 'S-1-5-21-1000'
const address = '\\\\.\\pipe\\ivoraige-abcdefghijklmnopqrstuv'
function helper(t, { killResult = true, holdWrites = false } = {}) {
  const child = new EventEmitter()
  child.pid = 123
  child.commands = []
  child.pendingWrites = []
  child.kills = 0
  child.stdin = new Writable({ write(chunk, encoding, callback) {
    const command = JSON.parse(chunk.toString())
    child.commands.push(command)
    if (holdWrites && command.type === 'write') child.pendingWrites.push(callback)
    else callback()
  } })
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = () => { child.kills++; return killResult }
  child.reply = message => child.stdout.write(`${JSON.stringify(message)}\n`)
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
  t.mock.method(childProcess, 'spawn', (executable, args) => {
    assert.ok(args.includes('-Command'))
    assert.ok(!args.includes('-File') && !args.includes('-ExecutionPolicy'))
    assert.match(args.at(-1), /Add-Type -LiteralPath '[^\n]+HostPipe\.cs'/)
    assert.match(args.at(-1), /LanguageMode -ne 'FullLanguage'/)
    return child
  })
  syncBuiltinESMExports()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    child.emit('exit', 1, null)
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy()
    t.mock.timers.reset()
    t.mock.restoreAll()
    syncBuiltinESMExports()
    Object.defineProperty(process, 'platform', platform)
  })
  return child
}
function start(child) {
  const server = createWindowsPipeServer(() => {})
  server.listen(address, () => {})
  child.reply({ type: 'ready', sid })
  return server
}
const close = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))

test('listen acknowledgment expires even after helper startup succeeded', async t => {
  const child = helper(t, { killResult: false })
  const server = start(child)
  const failed = once(server, 'error')
  t.mock.timers.tick(24_999)
  assert.equal(child.kills, 0)
  t.mock.timers.tick(1)
  assert.equal((await failed)[0].code, 'PRECONDITION_FAILED')
  assert.equal(child.kills, 1)
  await assert.rejects(close(server), { code: 'PRECONDITION_FAILED' })
  // A denied/unsuccessful termination request is never treated as closure.
  assert.equal(server.owner.exited, false)
})

test('missing close acknowledgment fails owned channels until actual helper exit is observed', async t => {
  const child = helper(t)
  const server = start(child)
  child.reply({ type: 'listening', id: server.id, sid })
  const client = connectWindowsPipe(address)
  const connect = child.commands.find(command => command.type === 'connect')
  child.reply({ type: 'connected', id: connect.id, peerSid: sid })
  const closing = close(server)
  const rejected = assert.rejects(closing, { code: 'PRECONDITION_FAILED' })
  t.mock.timers.tick(1999)
  assert.equal(child.kills, 0)
  t.mock.timers.tick(1)
  await rejected
  assert.equal(child.kills, 1)
  assert.equal(client.destroyed, true)
  // Even kill() returning true only acknowledges the request, not OS exit.
  await assert.rejects(close(server), { code: 'PRECONDITION_FAILED' })
  child.emit('exit', 1, null)
  await close(server)
})

test('native close acknowledgment completes without terminating a healthy helper', async t => {
  const child = helper(t)
  const server = start(child)
  child.reply({ type: 'listening', id: server.id, sid })
  const closing = close(server)
  child.reply({ type: 'serverClosed', id: server.id })
  await closing
  assert.equal(child.kills, 0)
  assert.equal(server.verifiedClosed, true)
  await close(server)
})

test('broker failure after a business frame is submitted reports unknown outcome', async t => {
  const child = helper(t)
  const frame = { interfaceVersion: 'HostControl@1', minor: 0, requestId: 'broker-outcome',
    expectedGeneration: 'generation', action: 'business', params: { method: 'write', input: {} } }
  const exchange = exchangeHostFrame(address, frame, { createSocket: connectWindowsPipe })
  const rejected = assert.rejects(exchange, { code: 'CONFLICT', details: { reason: 'outcome-unknown' } })
  child.reply({ type: 'ready', sid })
  const connect = child.commands.find(command => command.type === 'connect')
  child.reply({ type: 'connected', id: connect.id, peerSid: sid })
  await new Promise(resolve => setImmediate(resolve))
  const submitted = child.commands.find(command => command.type === 'write')
  assert.deepEqual(JSON.parse(Buffer.from(submitted.data, 'base64')), frame)
  // The native operation may have run before the helper loses its channel.
  child.emit('error', new Error('injected helper channel failure'))
  await rejected
  assert.equal(child.kills, 1)
})

test('pipe write callbacks wait for native write ACK, not broker stdin flush', async t => {
  const child = helper(t, { holdWrites: true })
  const server = start(child)
  child.reply({ type: 'listening', id: server.id, sid })
  const client = connectWindowsPipe(address)
  const connect = child.commands.find(command => command.type === 'connect')
  child.reply({ type: 'connected', id: connect.id, peerSid: sid })
  const chunk = Buffer.alloc(700 * 1024, 0x61)
  const completed = []
  client.write(chunk, () => completed.push(1))
  client.write(chunk, () => completed.push(2))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(child.commands.filter(command => command.type === 'write').length, 1)
  assert.deepEqual(completed, [])
  child.pendingWrites.shift()()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(child.commands.filter(command => command.type === 'write').length, 1)
  assert.deepEqual(completed, [])
  const first = child.commands.find(command => command.type === 'write')
  child.reply({ type: 'written', id: client.id, seq: first.seq })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(child.commands.filter(command => command.type === 'write').length, 2)
  assert.deepEqual(completed, [1])
  child.pendingWrites.shift()()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(completed, [1])
  const second = child.commands.filter(command => command.type === 'write')[1]
  child.reply({ type: 'written', id: client.id, seq: second.seq })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(completed, [1, 2])
  client.destroy()
  child.reply({ type: 'serverClosed', id: server.id })
  await close(server)
})

test('native peer closure rejects pending write without waiting for an ACK', async t => {
  const child = helper(t)
  const server = start(child)
  child.reply({ type: 'listening', id: server.id, sid })
  const client = connectWindowsPipe(address)
  const connect = child.commands.find(command => command.type === 'connect')
  child.reply({ type: 'connected', id: connect.id, peerSid: sid })
  const error = new Promise(resolve => client.once('error', resolve))
  client.write('pending\n')
  await new Promise(resolve => setImmediate(resolve))
  child.reply({ type: 'closed', id: client.id })
  assert.equal((await error).code, 'PRECONDITION_FAILED')
  child.reply({ type: 'serverClosed', id: server.id })
  await close(server)
})

test('public pipe write queue stays bounded while native ACK is withheld', async t => {
  const child = helper(t, { holdWrites: true })
  const server = start(child)
  child.reply({ type: 'listening', id: server.id, sid })
  const client = connectWindowsPipe(address)
  const connect = child.commands.find(command => command.type === 'connect')
  child.reply({ type: 'connected', id: connect.id, peerSid: sid })
  const failure = once(client, 'error')
  for (let i = 0; i < 10 && !client.destroyed; i++) client.write(Buffer.alloc(1024 * 1024, 0x61))
  assert.equal((await failure)[0].code, 'PRECONDITION_FAILED')
  assert.equal(client.destroyed, true)
  child.reply({ type: 'serverClosed', id: server.id })
  await close(server)
})
