import { createInterface } from 'node:readline'
import { existsSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const [mode = 'normal', marker] = process.argv.slice(2)
const send = value => process.stdout.write(JSON.stringify(value) + '\n')
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })
let workDir

for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line)
  if (method === 'handshake') {
    if (mode === 'hang-handshake') { writeFileSync(marker, 'handshake'); continue }
    if (mode === 'bad-version') reply(id, { protocolVersion: 2 })
    else reply(id, { protocolVersion: 1, capabilities: { parse: ['pdf'] } })
    continue
  }
  if (method === 'configure') {
    if (mode === 'hang-configure') { writeFileSync(marker, 'configure'); continue }
    workDir = params.options?.workDir
    if (params.options?.workDir) writeFileSync(join(params.options.workDir, 'sidecar-owned'), 'configured')
    if (mode === 'missing-assets') fail(id, -32002, 'weights missing')
    else {
      reply(id, {})
    }
    continue
  }
  if (method === 'shutdown') {
    if (marker) writeFileSync(marker, 'shutdown')
    reply(id, {})
    process.exit(0)
  }
  if (mode === 'crash-always' || (mode === 'crash-once' && !existsSync(marker))) {
    if (marker) writeFileSync(marker, 'crashed')
    process.exit(3)
  }
  if (mode === 'malformed') { process.stdout.write('hello from sidecar\n'); continue }
  if (mode === 'hang') continue
  if (mode === 'hang-with-descendant') {
    const code = "const fs=require('node:fs'); const handle=fs.openSync(process.argv[1],'w'); fs.writeFileSync(process.argv[2],String(process.pid)); setInterval(()=>{},1000)"
    spawn(process.execPath, ['-e', code, join(workDir, 'held'), join(workDir, 'descendant.pid')],
      { stdio: 'ignore', windowsHide: true }).unref()
    continue
  }
  if (mode === 'remote-error') { fail(id, -32001, 'parse failed'); continue }
  if (mode === 'diagnostic-error') {
    const diagnostic = 'Python traceback: held PDF output\n'
    process.stderr.write(diagnostic)
    send({ jsonrpc: '2.0', id, error: { code: -32003, message: 'rebuild failed', diagnostic } })
    continue
  }
  if (mode === 'rebuild-error') { fail(id, -32003, 'rebuild failed'); continue }
  if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 80))
  send({ method: 'progress', params: { stage: method, done: 1, total: 2 } })
  reply(id, { method, params })
}
