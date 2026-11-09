const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');

const TYPES = ['bug', 'enhancement', 'documentation', 'question'];
const MARKER = '<!-- ivoraige-codex-triage-v1 -->';
const fingerprint = issue => createHash('sha256').update(JSON.stringify([issue.title, issue.body ?? ''])).digest('hex');

function issueNumber(context) {
  const raw = context.eventName === 'workflow_dispatch' ? context.payload.inputs?.issue_number : context.payload.issue?.number;
  if (!/^[1-9]\d*$/.test(String(raw)) || !Number.isSafeInteger(Number(raw))) throw new Error('Invalid issue number');
  return Number(raw);
}

function validate(raw, snapshot) {
  if (typeof raw !== 'string' || raw.length > 16000) throw new Error('Invalid output size');
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'duplicates,labels,reason' ||
      !Array.isArray(value.labels) || value.labels.length > 1 ||
      value.labels.some(label => !TYPES.includes(label) || !snapshot.labels.includes(label)) ||
      !Array.isArray(value.duplicates) || value.duplicates.length > 5 ||
      value.duplicates.some(n => !Number.isSafeInteger(n) || n === snapshot.number || !snapshot.candidates.includes(n)) ||
      typeof value.reason !== 'string' || value.reason.length > 4000) throw new Error('Invalid triage result');
  return {...value, duplicates: [...new Set(value.duplicates)]};
}

async function prepare({github, context, core}) {
  const repo = context.repo;
  let access;
  try {
    ({data: access} = await github.rest.repos.getCollaboratorPermissionLevel({...repo, username: context.actor}));
  } catch (error) {
    if (error.status !== 404) throw error;
    access = {permission: 'none'};
  }
  if (!['admin', 'maintain', 'write'].includes(access.permission) && !access.user?.permissions?.push) {
    core.info('No API call: only repository writers may trigger paid analysis. A maintainer can use Run workflow.');
    core.setOutput('allowed', 'false');
    return;
  }
  const number = issueNumber(context);
  const {data: target} = await github.rest.issues.get({...repo, issue_number: number});
  if (target.pull_request || target.state !== 'open') throw new Error('Select an open issue, not a pull request');
  const labels = await github.paginate(github.rest.issues.listLabelsForRepo, {...repo, per_page: 100});
  const allowed = TYPES.filter(name => labels.some(label => label.name === name));
  // Two bounded pages of issues + PRs; never an unbounded crawl or a second model pass.
  const recent = [];
  for (let page = 1; page <= 2; page++) {
    const {data} = await github.rest.issues.listForRepo({...repo, state: 'all', sort: 'created', direction: 'desc', per_page: 100, page});
    recent.push(...data.filter(issue => !issue.pull_request && issue.number !== number));
    if (data.length < 100) break;
  }
  const candidates = recent.slice(0, 100);
  const clip = issue => ({number: issue.number, title: issue.title.slice(0, 300), body: (issue.body ?? '').slice(0, 2000), state: issue.state});
  await fs.mkdir('.triage', {recursive: true});
  await fs.writeFile('.triage/input.json', JSON.stringify({target: {...clip(target), body: (target.body ?? '').slice(0, 8000)}, candidates: candidates.map(clip), allowed_labels: allowed}));
  core.setOutput('snapshot', JSON.stringify({number, fingerprint: fingerprint(target), labels: allowed, candidates: candidates.map(issue => issue.number)}));
  core.setOutput('allowed', 'true');
  core.info(`Prepared issue #${number} with ${candidates.length} bounded candidates.`);
}

async function apply({github, context, core}) {
  const snapshot = JSON.parse(process.env.TRIAGE_SNAPSHOT);
  const number = issueNumber(context);
  if (snapshot.number !== number) throw new Error('Issue snapshot mismatch');
  const result = validate(process.env.TRIAGE_RESULT, snapshot);
  const repo = context.repo;
  const {data: target} = await github.rest.issues.get({...repo, issue_number: number});
  if (target.pull_request || target.state !== 'open' || fingerprint(target) !== snapshot.fingerprint) {
    core.info('Issue was changed or closed during analysis; skipping writes. Run again if needed.');
    return;
  }
  const available = await github.paginate(github.rest.issues.listLabelsForRepo, {...repo, per_page: 100});
  const hasType = target.labels.some(label => TYPES.includes(typeof label === 'string' ? label : label.name));
  const labels = hasType ? [] : result.labels.filter(name => available.some(label => label.name === name));
  // Re-fetch candidates: model output cannot reference another repository, a PR, or an unseen issue.
  for (const candidate of result.duplicates) {
    const {data} = await github.rest.issues.get({...repo, issue_number: candidate});
    if (data.pull_request) throw new Error('Duplicate candidate is a pull request');
  }
  core.summary.addHeading(`Issue #${number} triage`).addCodeBlock(JSON.stringify({...result, labels_to_add: labels}, null, 2), 'json');
  const dryRun = context.eventName === 'workflow_dispatch' && String(context.payload.inputs?.dry_run ?? 'true') !== 'false';
  core.summary.addRaw(dryRun ? '\nPreview only: no issue changes.\n' : '\nApplying validated suggestions.\n');
  await core.summary.write();
  if (dryRun) return;
  if (labels.length) await github.rest.issues.addLabels({...repo, issue_number: number, labels});
  if (!result.duplicates.length) return;
  const comments = await github.paginate(github.rest.issues.listComments, {...repo, issue_number: number, per_page: 100});
  if (comments.some(comment => comment.user?.login === 'github-actions[bot]' && comment.body?.includes(MARKER))) {
    core.info('A duplicate suggestion comment already exists; not posting again.');
    return;
  }
  await github.rest.issues.createComment({...repo, issue_number: number, body: [
    MARKER,
    'Codex 找到了以下可能重复的 issue，请维护者核实是否为同一个问题：',
    '', ...result.duplicates.map(n => `- #${n}`), '',
    '这只是自动初筛；相关规划、子任务和后续扩展可以分别保留。本次检查不会自动关闭 issue。',
    '', '*由 [Codex Action](https://github.com/openai/codex-action) 提供分析。*',
  ].join('\n')});
}

module.exports = {prepare, apply, validate, fingerprint, issueNumber};
