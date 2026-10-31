import { createInterface } from 'node:readline'
const send = value => process.stdout.write(JSON.stringify(value) + '\n')
let release
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params = {} } = JSON.parse(line)
  const reply = result => send({ jsonrpc: '2.0', id, result })
  if (method === 'test.release') { release?.(); release = undefined; continue }
  if (method === 'handshake') { reply({ protocolVersion: 1 }); continue }
  if (method === 'configure' || method === 'success') { reply({ ok: true }); continue }
  if (method === 'shutdown') { reply({}); break }
  if (method === 'exit') {
    release = () => process.stderr.write('private terminal diagnostic\n', () => process.exit(3))
    send({ method: 'progress', params: { stage: 'exit-ready' } })
    continue
  }
  if (method === 'hang') { process.stderr.write('private timeout diagnostic\n'); continue }
  const diagnostic = params.diagnostic
  const respond = () => send({ jsonrpc: '2.0', id, error: {
    code: -32003, message: 'rebuild failed', data: { code: 'UPSTREAM_FAILURE' },
    ...(diagnostic === undefined ? {} : { diagnostic }),
  } })
  if (params.order === 'stderr-first') {
    release = respond
    process.stderr.write(diagnostic)
  } else {
    release = () => process.stderr.write(diagnostic ?? 'legacy private diagnostic\n')
    respond()
  }
}
