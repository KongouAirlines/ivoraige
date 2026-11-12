import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'

const workflow = parse(await readFile(new URL('../.github/workflows/kernel-smoke.yml', import.meta.url), 'utf8'))

test('CI validates PRs and integration candidates without duplicating every feature push', () => {
  assert.deepEqual(workflow.on.push.branches, ['main', 'release/**'])
  assert.deepEqual(workflow.on.push.tags, ['v*'])
  assert.ok(Object.hasOwn(workflow.on, 'pull_request'))
  assert.deepEqual(workflow.on.merge_group.types, ['checks_requested'])
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'))
  assert.equal(workflow.on.pull_request?.branches, undefined, 'stacked PRs need non-main bases')
  assert.equal(workflow.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}")
  assert.match(workflow.concurrency.group, /pull_request.number \|\| github.run_id/)
})

test('CI retains native three-platform regression and isolated installation coverage', async () => {
  const job = workflow.jobs['package-smoke']
  assert.deepEqual(job.strategy.matrix.os, ['ubuntu-latest', 'windows-latest', 'macos-latest'])
  assert.equal(job.strategy['fail-fast'], false)
  assert.equal(job['timeout-minutes'], 25)
  const steps = job.steps.filter(step => step.run)
  for (const step of steps) assert.ok(step['timeout-minutes'] > 0 && step['timeout-minutes'] <= 10)
  assert.equal(steps.filter(step => step.run === 'npm run build').length, 1)
  assert.equal(steps.filter(step => step.run === 'npm run test:ci').length, 1)
  assert.equal(steps.filter(step => step.run === 'npm run smoke:package').length, 1)
  assert.equal(steps.filter(step => step.run.startsWith('python -m unittest')).length, 3)
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(pkg.scripts['test:ci'], /--test-timeout=120000/)
  assert.match(pkg.scripts['test:ci'], /test\/\*\.test\.mjs/)
})
