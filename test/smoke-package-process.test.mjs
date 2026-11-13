import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startServer, stopLiveServers } from '../scripts/smoke-package-process.mjs'

async function fixture(source, run) {
  const dir = await mkdtemp(join(tmpdir(), 'package-server-test-'))
  const cli = join(dir, 'server.mjs')
  const pidFile = join(dir, 'pid')
  await writeFile(cli, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n${source}`)
  try { await run({ dir, cli, pidFile }) }
  finally {
    await stopLiveServers()
    await rm(dir, { recursive: true, force: true })
  }
}

function assertStopped(pid) {
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
}

test('normal close waits for packaged server exit', async () => {
  await fixture("console.log('http://127.0.0.1:12345'); setInterval(() => {}, 1000)", async ({ dir, cli, pidFile }) => {
    const server = await startServer(cli, dir, 'store', 'settings')
    assert.equal(server.url, 'http://127.0.0.1:12345')
    const pid = Number(await readFile(pidFile, 'utf8'))
    await server.close()
    assertStopped(pid)
  })
})

test('startup timeout reaps an unresponsive packaged server', async () => {
  await fixture('setInterval(() => {}, 1000)', async ({ dir, cli, pidFile }) => {
    await assert.rejects(startServer(cli, dir, 'store', 'settings', 2_000), /timed out/)
    // Under heavy load the timeout may fire before the child executes JS.
    const pid = await readFile(pidFile, 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
    if (pid !== null) assertStopped(Number(pid))
  })
})

test('startup exit reports failure without leaving a child', async () => {
  await fixture("console.error('startup failed'); process.exit(7)", async ({ dir, cli, pidFile }) => {
    await assert.rejects(startServer(cli, dir, 'store', 'settings'), /exited 7: startup failed/)
    assertStopped(Number(await readFile(pidFile, 'utf8')))
  })
})

test('close escalates to SIGKILL if SIGTERM is ignored', async () => {
  await fixture("process.on('SIGTERM', () => {}); console.log('http://127.0.0.1:12345'); setInterval(() => {}, 1000)", async ({ dir, cli, pidFile }) => {
    const server = await startServer(cli, dir, 'store', 'settings')
    const pid = Number(await readFile(pidFile, 'utf8'))
    await server.close(100)
    assertStopped(pid)
  })
})
