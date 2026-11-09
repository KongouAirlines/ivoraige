import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {validate, fingerprint, issueNumber, apply, prepare} = createRequire(import.meta.url)('../.github/scripts/issue-triage.cjs');

const target = {number: 71, title: '功能规划', body: '接入 DSH 界面', state: 'open', labels: []};
const snapshot = {number: 71, fingerprint: fingerprint(target), labels: ['bug', 'enhancement'], candidates: [23, 29]};
const result = {labels: ['enhancement'], duplicates: [23], reason: '同一个请求'};

test('reject arbitrary labels, unseen issues, self references and malformed output', () => {
  assert.deepEqual(validate(JSON.stringify(result), snapshot), result);
  for (const bad of [null, {}, {...result, labels: ['wontfix']}, {...result, duplicates: [999]}, {...result, duplicates: [71]}, {...result, duplicates: ['23']}, {...result, command: 'close'}, {...result, labels: ['bug', 'enhancement']}]) {
    assert.throws(() => validate(JSON.stringify(bad), snapshot));
  }
  assert.throws(() => issueNumber({eventName: 'workflow_dispatch', payload: {inputs: {issue_number: '71;echo hi'}}}));
});

function harness({issue = target, dryRun = 'false', comments = [], candidate = {number: 23}} = {}) {
  const writes = [];
  const listLabelsForRepo = () => {};
  const listComments = () => {};
  const github = {rest: {issues: {
    get: async ({issue_number}) => ({data: issue_number === 71 ? issue : candidate}),
    listLabelsForRepo, listComments,
    addLabels: async value => writes.push(['labels', value]),
    createComment: async value => writes.push(['comment', value]),
  }}, paginate: async method => method === listLabelsForRepo ? snapshot.labels.map(name => ({name})) : comments};
  const summary = {addHeading() {return this;}, addCodeBlock() {return this;}, addRaw() {return this;}, async write() {}};
  const context = {repo: {owner: 'KongouAirlines', repo: 'ivoraige'}, eventName: 'workflow_dispatch', payload: {inputs: {issue_number: '71', dry_run: dryRun}}};
  process.env.TRIAGE_RESULT = JSON.stringify(result);
  process.env.TRIAGE_SNAPSHOT = JSON.stringify(snapshot);
  return {github, context, core: {info() {}, summary}, writes};
}

test('dry run never mutates an issue', async () => {
  const h = harness({dryRun: 'true'});
  await apply(h);
  assert.deepEqual(h.writes, []);
});

test('apply adds an allowed label and a fixed candidate comment', async () => {
  const h = harness();
  await apply(h);
  assert.equal(h.writes.length, 2);
  assert.deepEqual(h.writes[0][1].labels, ['enhancement']);
  assert.match(h.writes[1][1].body, /- #23/);
  assert.ok(!h.writes[1][1].body.includes(result.reason));
});

test('preserve existing human classification and suppress repeated bot comments', async () => {
  const h = harness({issue: {...target, labels: [{name: 'bug'}]}, comments: [{user: {login: 'github-actions[bot]'}, body: '<!-- ivoraige-codex-triage-v1 -->'}]});
  await apply(h);
  assert.deepEqual(h.writes, []);
});

test('changed, closed and PR targets cannot be written', async () => {
  for (const issue of [{...target, body: 'changed'}, {...target, state: 'closed'}, {...target, pull_request: {}}]) {
    const h = harness({issue});
    await apply(h);
    assert.deepEqual(h.writes, []);
  }
});

test('PR candidate rejects the entire write before labels are added', async () => {
  const h = harness({candidate: {number: 23, pull_request: {}}});
  await assert.rejects(apply(h), /pull request/);
  assert.deepEqual(h.writes, []);
});

test('outsider is skipped before reading issue context or invoking the model', async () => {
  const outputs = {};
  await prepare({github: {rest: {repos: {getCollaboratorPermissionLevel: async () => ({data: {permission: 'read'}})}}}, context: {repo: {}, actor: 'visitor'}, core: {info() {}, setOutput(key, value) {outputs[key] = value;}}});
  assert.equal(outputs.allowed, 'false');
});

test('non-collaborator 404 skips paid analysis; other permission errors fail', async () => {
  for (const status of [404, 403]) {
    const outputs = {};
    const h = {github: {rest: {repos: {getCollaboratorPermissionLevel: async () => {throw Object.assign(new Error('API error'), {status});}}}}, context: {repo: {}, actor: 'visitor'}, core: {info() {}, setOutput(key, value) {outputs[key] = value;}}};
    if (status === 404) {
      await prepare(h);
      assert.equal(outputs.allowed, 'false');
    } else await assert.rejects(prepare(h), /API error/);
  }
});
