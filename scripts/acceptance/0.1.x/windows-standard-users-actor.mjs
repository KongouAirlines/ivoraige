// Invoked only by the one-time acceptance runner, never by npm test.
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWindowsPipeServer, connectWindowsPipe } from '../../../src/host-windows-pipe.mjs'

const sid = process.argv[2]
assert.equal(process.platform, 'win32')
assert.match(sid, /^S-1-5-21-[0-9-]+$/)
const ps = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const probe = fileURLToPath(new URL('./windows-standard-users-probe.cs', import.meta.url))
const quote = value => `'${value.replaceAll("'", "''")}'`
const bootstrap = `$ErrorActionPreference = 'Stop'; Add-Type -LiteralPath ${quote(probe)} -ReferencedAssemblies System,System.Core,System.Web.Extensions; `
const address = value => {
  assert.match(value, /^\\\\\.\\pipe\\ivoraige-[A-Za-z0-9_-]{22}$/)
  return quote(value)
}
const readProbe = async code => {
  const checked = `try { ${code} } catch { $cause = $_.Exception; while ($cause.InnerException) { $cause = $cause.InnerException }; $number = 0; if ($cause -is [System.ComponentModel.Win32Exception]) { $number = $cause.NativeErrorCode }; [Console]::Out.WriteLine('{"probeFailure":true,"win32Error":' + $number + '}'); exit 1 }`
  try {
    const { stdout } = await promisify(execFile)(ps, ['-NoProfile', '-NonInteractive', '-Command', bootstrap + checked],
      { windowsHide: true, timeout: 30_000, maxBuffer: 16_384 })
    return JSON.parse(stdout)
  } catch (error) {
    let diagnostic
    try { diagnostic = JSON.parse(error.stdout) } catch {}
    throw Object.assign(new Error('Native probe failed'), { code: 'NATIVE_PROBE_FAILED',
      win32Error: Number.isInteger(diagnostic?.win32Error) ? diagnostic.win32Error : 0 })
  }
}
const attest = pids => readProbe(`[StandardPipeProbe]::Tokens([int[]]@(${pids.join(',')}), ${quote(sid)})`)
const helpers = new Set(), sockets = new Set(), peers = []
let server, spoof
const track = endpoint => { helpers.add(endpoint.owner.child); return endpoint }
const closeServer = value => new Promise((resolve, reject) => value.close(error => error ? reject(error) : resolve()))
const bounded = async (promise, ms = 30_000) => {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Acceptance deadline')), ms) })]) }
  finally { clearTimeout(timer) }
}

async function command(message) {
  switch (message.type) {
    case 'attest': return { tokens: await attest([process.pid]) }
    case 'listen': {
      address(message.address)
      assert.equal(server, undefined)
      server = createWindowsPipeServer(socket => {
        const peer = { sid: socket.peerSid, pid: socket.peerPid, bytes: 0 }
        peers.push(peer); sockets.add(socket)
        socket.once('close', () => sockets.delete(socket))
        socket.once('data', chunk => { peer.bytes += chunk.length; socket.write('accepted\n') })
      })
      server.listen(message.address, () => {})
      track(server)
      await bounded(once(server, 'listening'))
      return { tokens: await attest([process.pid, server.owner.child.pid]), helperPid: server.owner.child.pid }
    }
    case 'exchange': {
      address(message.address)
      const client = track(connectWindowsPipe(message.address))
      sockets.add(client)
      try {
        await bounded(once(client, 'connect'))
        const response = new Promise((resolve, reject) => {
          let value = ''
          client.on('data', chunk => { value += chunk; if (value.includes('\n')) resolve(value) })
          client.once('error', reject)
        })
        client.write('synthetic-standard-user\n')
        assert.equal(await bounded(response), 'accepted\n')
        assert.equal(client.peerSid, sid)
        return { peerSid: client.peerSid, helperPid: client.owner.child.pid,
          tokens: await attest([process.pid, client.owner.child.pid]) }
      } finally { client.destroy(); sockets.delete(client) }
    }
    case 'inspect': return await readProbe(`[StandardPipeProbe]::Inspect(${address(message.address)}, ${quote(sid)})`)
    case 'deny': return await readProbe(`[StandardPipeProbe]::Denied(${address(message.address)}, ${quote(sid)})`)
    case 'snapshot': return { connections: peers.length, peers: [...peers] }
    case 'spoof': {
      address(message.address)
      assert.match(message.allowedSid, /^S-1-5-21-[0-9-]+$/)
      assert.notEqual(message.allowedSid, sid)
      assert.equal(spoof, undefined)
      const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-Command',
        bootstrap + `[StandardPipeProbe]::Spoof(${address(message.address)}, ${quote(sid)}, ${quote(message.allowedSid)})`],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      child.stderr.resume() // no raw exception/path output
      const lines = createInterface({ input: child.stdout })
      const first = once(lines, 'line')
      const completed = new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', code => code === 0 ? resolve() : reject(new Error('Spoof fixture failed')))
      })
      completed.catch(() => {})
      const outputs = []
      lines.on('line', line => outputs.push(JSON.parse(line)))
      spoof = { child, completed, outputs }
      const ready = JSON.parse((await bounded(first))[0])
      assert.equal(ready.ready, true)
      return ready
    }
    case 'listenRejected': {
      address(message.address)
      const duplicate = createWindowsPipeServer(() => assert.fail('Precreated pipe admitted a peer'))
      duplicate.listen(message.address, () => {})
      track(duplicate)
      try { await assert.rejects(bounded(once(duplicate, 'listening')), { code: 'PRECONDITION_FAILED' }) }
      finally { await closeServer(duplicate) }
      return { refusedPrecreatedPipe: true }
    }
    case 'rejectSpoof': {
      address(message.address)
      const client = track(connectWindowsPipe(message.address))
      try {
        client.once('connect', () => client.write('must-not-be-transmitted\n'))
        await assert.rejects(bounded(once(client, 'connect')), { code: 'PRECONDITION_FAILED' })
        return { rejectedBeforeConnect: true }
      } finally { client.destroy() }
    }
    case 'finishSpoof': {
      assert.ok(spoof)
      await bounded(spoof.completed)
      const result = spoof.outputs.at(-1)
      assert.equal(result.payloadBytes, 0)
      return result
    }
    case 'stop': {
      for (const socket of sockets) socket.destroy()
      if (server) await closeServer(server)
      if (spoof) await bounded(spoof.completed)
      for (const child of helpers) {
        if (child.exitCode === null && child.signalCode === null) await bounded(once(child, 'exit'), 10_000)
        assert.equal(child.exitCode, 0)
      }
      return { nativeHelpersExited: true }
    }
    default: throw new Error('Unknown acceptance command')
  }
}

// Do not start any helper until the credentialed process has been assigned to
// the runner-owned kill-on-close job and the runner sends its first command.
const input = createInterface({ input: process.stdin })
for await (const line of input) {
  let message
  try {
    assert.ok(Buffer.byteLength(line) <= 4096)
    message = JSON.parse(line)
    const result = await command(message)
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`)
    if (message.type === 'stop') { input.close(); process.stdin.destroy(); break }
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, stage: message?.type ?? 'input',
      code: typeof error.code === 'string' ? error.code : 'ACCEPTANCE_FAILED',
      win32Error: Number.isInteger(error.win32Error) ? error.win32Error : 0 })}\n`)
    input.close(); process.stdin.destroy(); process.exitCode = 1
    // The parent owns termination/cleanup of this disposable process tree.
    break
  }
}
