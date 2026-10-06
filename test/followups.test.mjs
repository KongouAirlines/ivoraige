import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { main } from '../scripts/followups.mjs'

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: false }).trim()
}

function fixture(run) {
  const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const cwd = mkdtempSync(path.join(workspace, '.followups-test-'))
  try {
    git(cwd, 'init', '-b', 'main')
    git(cwd, 'config', 'user.name', 'Test')
    git(cwd, 'config', 'user.email', 'test@example.invalid')
    mkdirSync(path.join(cwd, 'docs/plan/follow-ups'), { recursive: true })
    run(cwd)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

function record(cwd, { id = 'some-issue', status = '待评估', implementation = '—', title = 'Some issue' } = {}) {
  const filename = path.join(cwd, 'docs/plan/follow-ups', `${id}.md`)
  writeFileSync(filename, `# ${title}\n\n- ID: ${id}\n- 状态: ${status}\n- 实施分支／PR: ${implementation}\n`)
  return filename
}

function commit(cwd, message) {
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-m', message)
}

test('compares divergent committed records and excludes working-tree edits', () => fixture(cwd => {
  const filename = record(cwd)
  commit(cwd, 'initial')
  git(cwd, 'switch', '-c', 'implementation')
  record(cwd, { status: '处理中', implementation: 'implementation', title: 'Some issue' })
  commit(cwd, 'update')
  writeFileSync(filename, '# uncommitted edit\n')
  const before = git(cwd, 'status', '--porcelain')
  const report = main(cwd, ['--refs', 'main', 'implementation'])
  assert.match(report, /some-issue \| main \| Some issue \| 待评估/)
  assert.match(report, /some-issue \| implementation \| Some issue \| 处理中 \| implementation/)
  assert.match(report, /Content differs across refs/)
  assert.doesNotMatch(report, /uncommitted edit/)
  assert.equal(git(cwd, 'status', '--porcelain'), before)
  assert.equal(readFileSync(filename, 'utf8'), '# uncommitted edit\n')
}))

test('reports missing records, empty ref, and legacy headings without canonizing them', () => fixture(cwd => {
  mkdirSync(path.join(cwd, 'docs/plan'), { recursive: true })
  writeFileSync(path.join(cwd, 'docs/plan/deferred.md'), '# Deferred\n\n### Old concern\n')
  commit(cwd, 'legacy only')
  git(cwd, 'switch', '-c', 'with-record')
  record(cwd)
  commit(cwd, 'record')
  const report = main(cwd, ['--refs', 'main', 'with-record'])
  assert.match(report, /some-issue \| main \| — \| — \| — \| ⚠ Missing in this ref/)
  assert.match(report, /main \| No records/)
  assert.match(report, /Legacy headings exist in main, with-record/)
  assert.doesNotMatch(report, /old-concern/)
}))

test('rejects unknown refs and malformed metadata', () => fixture(cwd => {
  record(cwd)
  commit(cwd, 'valid')
  assert.throws(() => main(cwd, ['--refs', 'missing-ref']), /unknown local Git ref/)
  git(cwd, 'switch', '-c', 'invalid')
  record(cwd, { id: 'other-issue' })
  writeFileSync(path.join(cwd, 'docs/plan/follow-ups/other-issue.md'), '# Other\n- ID: wrong-id\n- 状态: 待评估\n- 实施分支／PR: —\n')
  commit(cwd, 'bad ID')
  assert.throws(() => main(cwd, ['--refs', 'invalid']), /ID must match/)
  writeFileSync(path.join(cwd, 'docs/plan/follow-ups/other-issue.md'), '# Other\n- ID: other-issue\n- 状态: 待评估\n- 状态: 已安排\n- 实施分支／PR: —\n')
  commit(cwd, 'duplicate field')
  assert.throws(() => main(cwd, ['--refs', 'invalid']), /duplicate 状态 metadata/)
  writeFileSync(path.join(cwd, 'docs/plan/follow-ups/other-issue.md'), '# Other\n- ID: other-issue\n- 状态: 待评估\n')
  commit(cwd, 'missing field')
  assert.throws(() => main(cwd, ['--refs', 'invalid']), /missing 实施分支／PR metadata/)
}))

test('defaults to HEAD and supports help', () => fixture(cwd => {
  record(cwd)
  commit(cwd, 'record')
  assert.match(main(cwd), /some-issue \| HEAD/)
  assert.match(main(cwd, ['--help']), /Usage: npm run followups/)
}))
