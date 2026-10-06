import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile, symlink, link, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp } from '../src/app.mjs'

const appUrl = pathToFileURL(resolve(fileURLToPath(new URL('../src/app.mjs', import.meta.url)))).href
const ownerScript = `
  import { createApp } from ${JSON.stringify(appUrl)};
  const app = await createApp({ store: process.argv[1] });
  process.stdout.write('ready\\n');
  process.stdin.resume();
  process.stdin.on('end', async () => { await app.dispose(); process.exit(0) });
`

async function childOwner(store) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', ownerScript, store],
    { stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  await new Promise((resolveReady, rejectReady) => {
    child.once('error', rejectReady)
    child.once('exit', code => rejectReady(new Error(`Owner exited ${code}: ${stderr}`)))
    child.stdout.once('data', chunk => chunk.toString().includes('ready')
      ? resolveReady() : rejectReady(new Error(`Unexpected owner output: ${chunk}`)))
  })
  return child
}

async function exited(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise(resolveExit => child.once('exit', resolveExit))
}

test('another process cannot boot the same store; release permits reopening', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-owner-'))
  const store = join(directory, 'records.sqlite')
  let child
  t.after(async () => {
    if (child) { child.kill(); await exited(child) }
    await rm(directory, { recursive: true, force: true })
  })
  child = await childOwner(store)
  const canonicalStore = await realpath(store)
  await assert.rejects(createApp({ store }), error =>
    error.code === 'CONFLICT' && error.message.includes('--url') && error.details.store === canonicalStore)
  child.stdin.end()
  await exited(child)
  const app = await createApp({ store })
  await app.dispose()
})

test('a crashed owner releases the OS lock without stale-file takeover', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-crash-'))
  const store = join(directory, 'records.sqlite')
  const child = await childOwner(store)
  t.after(async () => { child.kill(); await exited(child); await rm(directory, { recursive: true, force: true }) })
  child.kill('SIGKILL')
  await exited(child)
  const app = await createApp({ store })
  await app.dispose()
})

test('a directory symlink resolves to the same store owner', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-alias-'))
  const real = join(directory, 'real')
  const alias = join(directory, 'alias')
  await mkdir(real)
  t.after(() => rm(directory, { recursive: true, force: true }))
  try { await symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (error.code === 'EPERM') { t.skip('Directory symlinks are blocked'); return } throw error }
  const app = await createApp({ store: join(real, 'records.sqlite') })
  try {
    await assert.rejects(createApp({ store: join(alias, 'records.sqlite') }), { code: 'CONFLICT' })
  } finally { await app.dispose() }
})

test('normalized path aliases resolve to the same owner', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-path-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = join(directory, 'records.sqlite')
  const app = await createApp({ store })
  try {
    await assert.rejects(createApp({ store: relative(process.cwd(), store) }),
      { code: 'CONFLICT' })
  } finally { await app.dispose() }
})

test('hard-linked store aliases are rejected', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-hardlink-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = join(directory, 'records.sqlite')
  const alias = join(directory, 'alias.sqlite')
  const first = await createApp({ store })
  await first.dispose()
  try { await link(store, alias) }
  catch (error) { if (error.code === 'EPERM') { t.skip('Hard links are blocked'); return } throw error }
  await assert.rejects(createApp({ store: alias }), error =>
    error.code === 'CONFLICT' && error.message.includes('hard-linked'))
})

test('boot failure releases ownership', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ivoraige-boot-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = join(directory, 'records.sqlite')
  const settingsDir = join(directory, 'settings-file')
  await writeFile(settingsDir, 'not a directory')
  await assert.rejects(createApp({ store, settingsDir }))
  const app = await createApp({ store })
  await app.dispose()
})
