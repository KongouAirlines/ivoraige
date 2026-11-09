import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { Duplex } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { KernelError } from './errors.mjs'

const MAX_BYTES = 1024 * 1024
const MAX_LINE = 2 * MAX_BYTES
const unavailable = () => new KernelError('PRECONDITION_FAILED',
  'The Windows owner transport could not verify its OS security boundary',
  { reason: 'owner-permissions-unverified' })
let broker
let sequence = 0

// A single helper per Node process prevents a PowerShell/compiler launch per
// request. It has no listening TCP port, files with secrets, or shell commands
// derived from a received frame. EOF on inherited stdin ends all owned handles.
class Broker {
  constructor() {
    this.endpoints = new Map()
    this.waiting = []
    this.waitingBytes = 0
    this.stopped = false
    this.ready = false
    const systemRoot = process.env.SystemRoot || 'C:\\Windows'
    this.child = spawn(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./windows/host-pipe.ps1', import.meta.url))],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stderr.resume() // never forward raw helper/compiler exceptions
    this.child.on('error', () => this.fail())
    this.child.on('exit', () => this.fail())
    this.child.stdin.on('error', () => this.fail())
    this.startup = setTimeout(() => this.fail(), 20_000)
    let buffered = Buffer.alloc(0)
    this.child.stdout.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk])
      for (;;) {
        const end = buffered.indexOf(10)
        if (end < 0) { if (buffered.length > MAX_LINE) this.fail(); return }
        if (end > MAX_LINE) { this.fail(); return }
        const line = buffered.subarray(0, end).toString('utf8').replace(/\r$/, '')
        buffered = buffered.subarray(end + 1)
        try { this.receive(JSON.parse(line)) } catch { this.fail(); return }
      }
    })
  }
  add(endpoint) {
    clearTimeout(this.idle)
    this.endpoints.set(endpoint.id, endpoint)
  }
  remove(endpoint) {
    this.endpoints.delete(endpoint.id)
    if (!this.endpoints.size && !this.stopped) this.idle = setTimeout(() => {
      if (broker === this) broker = undefined
      this.stopped = true
      clearTimeout(this.startup)
      this.child.stdin.end()
      // A helper blocked on an OS operation must not outlive its owner.
      const timer = setTimeout(() => this.child.kill(), 1500)
      this.child.once('exit', () => clearTimeout(timer))
    }, 250)
  }
  send(message) {
    if (this.stopped) return
    const line = `${JSON.stringify(message)}\n`
    const size = Buffer.byteLength(line)
    if (size > MAX_LINE) { this.fail(); return }
    if (!this.ready) {
      if (this.waiting.length >= 256 || this.waitingBytes + size > 8 * MAX_BYTES) { this.fail(); return }
      this.waiting.push(line)
      this.waitingBytes += size
      return
    }
    this.sendLine(line)
  }
  sendLine(line) {
    if (this.child.stdin.writableLength + Buffer.byteLength(line) > 8 * MAX_BYTES) { this.fail(); return }
    this.child.stdin.write(line)
  }
  fail() {
    if (this.stopped) return
    this.stopped = true
    clearTimeout(this.startup)
    clearTimeout(this.idle)
    if (broker === this) broker = undefined
    this.child.kill()
    for (const endpoint of [...this.endpoints.values()]) endpoint.failed()
    this.endpoints.clear()
    this.waiting.length = 0
  }
  receive(message) {
    if (this.stopped) return
    if (message.type === 'ready') {
      if (this.ready || !/^S-1-[0-9-]+$/.test(message.sid)) throw unavailable()
      this.sid = message.sid
      this.ready = true
      clearTimeout(this.startup)
      for (const pending of this.waiting) this.sendLine(pending)
      this.waiting.length = 0
      this.waitingBytes = 0
      return
    }
    if (message.type === 'connection') {
      const server = this.endpoints.get(message.server)
      if (message.peerSid !== this.sid || this.endpoints.has(message.id)) throw unavailable()
      if (!(server instanceof PipeServer)) { this.send({ type: 'destroy', id: message.id }); return }
      const socket = new PipeSocket(this, message.id)
      socket.peerSid = message.peerSid
      socket.peerPid = message.peerPid
      server.emit('connection', socket)
      return
    }
    const endpoint = this.endpoints.get(message.id)
    if (!endpoint) return // a bounded late reply to a locally closed socket
    endpoint.receive(message)
  }
}

class PipeSocket extends Duplex {
  constructor(owner, id = `c${++sequence}`) {
    super({ allowHalfOpen: false })
    this.owner = owner
    this.id = id
    owner.add(this)
    // A peer disconnect is ordinary. Keep asynchronous native failures from
    // becoming an unhandled EventEmitter error during application cleanup.
    this.on('error', () => {})
  }
  _read() {}
  _write(chunk, encoding, callback) {
    if (chunk.length > MAX_BYTES) { callback(unavailable()); return }
    this.owner.send({ type: 'write', id: this.id, data: chunk.toString('base64') })
    callback()
  }
  _final(callback) {
    this.owner.send({ type: 'end', id: this.id, data: '' })
    callback()
  }
  _destroy(error, callback) {
    clearTimeout(this.connectTimer)
    this.owner.send({ type: 'destroy', id: this.id })
    this.owner.remove(this)
    callback(error)
  }
  failed() { this.destroy(unavailable()) }
  receive(message) {
    if (message.type === 'connected') {
      if (message.peerSid !== this.owner.sid) { this.failed(); return }
      clearTimeout(this.connectTimer)
      this.peerSid = message.peerSid
      this.emit('connect')
    } else if (message.type === 'data') {
      if (typeof message.data !== 'string' || message.data.length > 87384 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data)) { this.owner.fail(); return }
      const bytes = Buffer.from(message.data, 'base64')
      if (this.readableLength + bytes.length > MAX_BYTES) { this.destroy(unavailable()); return }
      this.push(bytes)
    } else if (message.type === 'end') this.push(null)
    else if (message.type === 'closed') {
      this.once('end', () => this.destroy())
      this.push(null)
      this.resume()
    }
    else if (message.type === 'error') this.failed()
    else this.owner.fail()
  }
}

class PipeServer extends EventEmitter {
  constructor(onConnection) {
    super()
    this.id = `s${++sequence}`
    this.on('error', () => {})
    this.on('connection', onConnection)
  }
  listen(address, callback) {
    this.owner = getBroker()
    this.owner.add(this)
    this.once('listening', callback)
    this.owner.send({ type: 'listen', id: this.id, address })
    return this
  }
  close(callback) {
    if (!this.owner || this.closed || this.owner.stopped) { queueMicrotask(callback); return this }
    this.once('close', callback)
    this.owner.send({ type: 'closeServer', id: this.id })
    return this
  }
  failed() {
    this.closed = true
    this.emit('error', unavailable())
    this.emit('close')
  }
  receive(message) {
    if (message.type === 'listening' && message.sid === this.owner.sid) this.emit('listening')
    else if (message.type === 'serverClosed') {
      this.closed = true
      this.owner.remove(this)
      this.emit('close')
    } else if (message.type === 'error') {
      this.owner.remove(this)
      this.failed()
    } else this.owner.fail()
  }
}

function getBroker() {
  if (process.platform !== 'win32') throw unavailable()
  return broker ??= new Broker()
}

export function createWindowsPipeServer(onConnection) { return new PipeServer(onConnection) }
export function connectWindowsPipe(address) {
  const owner = getBroker()
  const socket = new PipeSocket(owner)
  socket.connectTimer = setTimeout(() => socket.failed(), 25_000)
  owner.send({ type: 'connect', id: socket.id, address })
  return socket
}
