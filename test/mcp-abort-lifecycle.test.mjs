import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execute = promisify(execFile)
const fixture = fileURLToPath(new URL('./fixtures/mcp-abort-gc.mjs', import.meta.url))
for (const mode of ['http-entry', 'standalone']) {
  test(`MCP cancellation survives request-clone GC and isolates concurrent waits: ${mode}`, async () => {
    const { stdout } = await execute(process.execPath, ['--expose-gc', fixture, mode],
      { timeout: 15_000, maxBuffer: 128 * 1024 })
    const result = JSON.parse(stdout.trim())
    assert.equal(result.mode, mode)
    assert.equal(result.gcSweeps, 8)
    assert.equal(result.activeAfterOneAbort, 1)
    assert.equal(result.secondRequestNotCanceled, true)
    assert.equal(result.queuedTasksPreserved, true)
    assert.equal(result.terminal, 'succeeded')
    assert.equal(result.activeAtEnd, 0)
  })
}
