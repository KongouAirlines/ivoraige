// Compare already-built, isolated 0.1.x runtime checkouts without changing either one.
// Usage: node scripts/probe-runtime-candidate.mjs <pinned-checkout> <candidate-checkout>
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const [baseline, candidate] = process.argv.slice(2).map(path => resolve(path))
if (!baseline || !candidate || baseline === candidate) {
  throw new Error('Pass distinct pinned and candidate checkout directories')
}

const tests = [
  'test/foundation-runtime.test.mjs',
  'test/model-presets.test.mjs',
  'test/model-settings.test.mjs',
  'test/settings-runtime.test.mjs',
  'test/components-entries.test.mjs',
  'test/store-lock.test.mjs',
]

for (const [name, cwd] of [['pin', baseline], ['candidate', candidate]]) {
  const evidence = JSON.parse(readFileSync(join(cwd, 'dist/build-evidence.json'), 'utf8'))
  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...tests], {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 120_000,
  })
  console.log(`${name}: DSH=${evidence.dshCommit} bundledInputs=${evidence.inputs.length} pi-ai=${pkg.dependencies['@earendil-works/pi-ai']} exit=${result.status ?? 'timeout'}`)
  const summary = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  for (const line of summary.split(/\r?\n/)) {
    if (/^(?:ℹ|#) (?:tests|pass|fail|duration_ms)|(?:failing tests|provider presets produce valid DSH routes|Missing bundled dependency)/.test(line)) {
      console.log(line)
    }
  }
  if (result.error) console.log(`${name}: ${result.error.message}`)
  if (name === 'pin' && result.status !== 0) process.exitCode = 1
  if (name === 'candidate' && result.status !== 0) process.exitCode = 1
}
