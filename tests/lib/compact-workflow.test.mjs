import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { readState, writeState } from '../../scripts/lib/state-loader.mjs';
import { readPlan, validatePlan, recordReview, describeReviews } from '../../scripts/lib/execution-plan.mjs';
import { createRecoverySummary } from '../../scripts/lib/change-recovery.mjs';

function setup(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'ssf-compact-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.test');
  fs.writeFileSync(join(root, '.gitignore'), 'changes/\n'); git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD'); git('switch', '-c', 'feature');
  const dir = join(root, 'changes/demo'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'proposal.md'), '# Need\nDeliver a working addition, within the requested scope.\n');
  fs.writeFileSync(join(dir, 'tasks.md'), '- [ ] 1 Add behavior; prove using tests\n');
  const cli = (...args) => spawnSync(process.execPath, ['scripts/spec-superflow.mjs', ...args], { encoding: 'utf8' });
  const start = (...args) => cli('workflow', 'start', dir, '--path', 'planned', '--confirm', '--reason', 'User approved this plan', ...args);
  const commit = body => { fs.writeFileSync(join(root, 'code.txt'), body); git('add', 'code.txt'); git('commit', '-qm', body); return git('rev-parse', 'HEAD'); };
  return { root, dir, git, base, cli, start, commit };
}

test('planned start is one operation without contract or recommendation, and retry is idempotent', t => {
  const f = setup(t), result = f.start();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readState(f.dir).state, 'executing');
  const plan = readPlan(f.dir);
  assert.equal(plan.mode, 'inline'); assert.equal(plan.review_policy, 'final');
  assert.equal(plan.recommendation_receipt, undefined);
  assert.equal(fs.existsSync(join(f.dir, 'execution-contract.md')), false);
  assert.equal(validatePlan(f.dir, plan).valid, true);
  assert.equal(f.start().status, 0);
  assert.deepEqual(readPlan(f.dir), plan);
  const state = readState(f.dir); state.execution_mode = 'stale-cache'; state.execution_plan_hash = 'old'; writeState(f.dir, state);
  assert.equal(validatePlan(f.dir, plan).valid, true, 'derived state must not veto authoritative plan');
});

test('planned start needs one real approval and refuses missing tasks without partial state', t => {
  const f = setup(t);
  assert.notEqual(f.cli('workflow', 'start', f.dir, '--path', 'planned').status, 0);
  fs.rmSync(join(f.dir, 'tasks.md'));
  assert.notEqual(f.start().status, 0);
  assert.equal(fs.existsSync(join(f.dir, '.spec-superflow.yaml')), false);
});

test('direct start requires no planning pack or recommendation questionnaire', t => {
  const f = setup(t); fs.rmSync(join(f.dir, 'tasks.md')); fs.rmSync(join(f.dir, 'proposal.md'));
  const result = f.cli('workflow', 'start', f.dir, '--path', 'direct', '--scope', 'Fix the requested typo');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readState(f.dir).state, 'executing'); assert.equal(readPlan(f.dir), null);
  const complete = f.cli('workflow', 'complete', f.dir, '--verification-command', 'node -e "process.exit(0)"');
  assert.equal(complete.status, 0, complete.stderr);
  assert.equal(createRecoverySummary(f.dir).continuation.kind, 'terminal');
});

test('failure stays in execution; human accepted risk closes honestly without forging a pass', t => {
  const f = setup(t); assert.equal(f.start().status, 0);
  const result = f.cli('workflow', 'complete', f.dir, '--verification-command', 'node -e "process.exit(1)"');
  assert.notEqual(result.status, 0); assert.equal(readState(f.dir).state, 'executing');
  assert.match(readState(f.dir).test_result, /^fail/);
  assert.equal(createRecoverySummary(f.dir).next_action.skill, 'bug-investigator');
  assert.notEqual(f.cli('workflow', 'complete', f.dir, '--accept-risk', '--reason', 'Known issue').status, 0);
  const accepted = f.cli('workflow', 'complete', f.dir, '--accept-risk', '--confirm', '--reason', 'User accepts unfinished task and failed verification');
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(readState(f.dir).completion_outcome, 'accepted-risk');
  assert.match(readState(f.dir).test_result, /^fail/);
  assert.equal(createRecoverySummary(f.dir).continuation.kind, 'terminal');
  assert.notEqual(f.cli('finish', f.dir).status, 0);
});

test('planned completion requires current tasks, review and passing verification', t => {
  const f = setup(t); assert.equal(f.start().status, 0);
  const head = f.commit('implementation');
  const verify = () => f.cli('workflow', 'complete', f.dir, '--verification-command', 'node -e "process.exit(0)"');
  assert.notEqual(verify().status, 0);
  fs.writeFileSync(join(f.dir, 'tasks.md'), '- [x] 1 Add behavior; prove using tests\n');
  assert.notEqual(verify().status, 0);
  const report = join(f.dir, '.superpowers/sdd/reviews/final.md'); fs.writeFileSync(report, 'Scope and implementation reviewed.');
  recordReview(f.dir, 'final', { status: 'pass', base: f.base, head, report });
  assert.equal(verify().status, 0);
  assert.equal(readState(f.dir).completion_outcome, 'verified');
});

test('scope changes require reapproval; same-input retry never resets failed review history', t => {
  const f = setup(t); assert.equal(f.start().status, 0);
  const plan = readPlan(f.dir);
  fs.appendFileSync(join(f.dir, 'proposal.md'), '\nNew requested behavior\n');
  assert.equal(validatePlan(f.dir, plan).valid, false);
  assert.notEqual(f.cli('workflow', 'start', f.dir, '--path', 'planned').status, 0);
  assert.equal(f.start().status, 0);
  assert.equal(readPlan(f.dir).revision, plan.revision + 1);
});


test('repair budget counts the same issue, not unrelated findings', t => {
  const f = setup(t); assert.equal(f.start().status, 0);
  const report = join(f.dir, '.superpowers/sdd/reviews/final.md');
  const review = issue => {
    const head = f.commit(`repair ${issue} ${Date.now()}`);
    fs.writeFileSync(report, `Finding ${issue}`);
    return recordReview(f.dir, 'final', { status: 'fail', base: f.base, head, report, issue });
  };
  review('transaction'); review('authorization'); review('timeout');
  assert.equal(describeReviews(f.dir)[0].repair.status, 'repairing');
  review('timeout'); review('timeout');
  assert.equal(describeReviews(f.dir)[0].repair.status, 'adjudication-required');
  const before = readPlan(f.dir);
  assert.equal(f.start().status, 0);
  assert.deepEqual(readPlan(f.dir), before);
  assert.equal(describeReviews(f.dir)[0].repair.status, 'adjudication-required');
});

test('planned verification cannot certify dirty implementation outside the reviewed snapshot', t => {
  const f = setup(t); assert.equal(f.start().status, 0);
  const head = f.commit('implementation');
  fs.writeFileSync(join(f.dir, 'tasks.md'), '- [x] 1 Add behavior; prove using tests\n');
  const report = join(f.dir, '.superpowers/sdd/reviews/final.md'); fs.writeFileSync(report, 'Reviewed');
  recordReview(f.dir, 'final', { status: 'pass', base: f.base, head, report });
  const script = join(f.dir, 'mutate.cjs'); fs.writeFileSync(script, "require('fs').appendFileSync('code.txt', 'unreviewed');");
  const result = f.cli('workflow', 'complete', f.dir, '--verification-command', `node "${script}"`);
  assert.notEqual(result.status, 0); assert.equal(readState(f.dir).state, 'executing');
});


test('direct scope can expand into one explicitly approved plan without a state rewind', t => {
  const f = setup(t);
  assert.equal(f.cli('workflow', 'start', f.dir, '--path', 'direct', '--scope', 'Original small request').status, 0);
  assert.equal(f.start().status, 0);
  assert.equal(readState(f.dir).state, 'executing');
  assert.equal(readState(f.dir).workflow_variant, 'planned');
  assert.equal(validatePlan(f.dir, readPlan(f.dir)).valid, true);
});

test('missing authoritative plan cannot be mistaken for a new task', t => {
  const f = setup(t); assert.equal(f.start().status, 0);
  fs.rmSync(join(f.dir, '.superpowers/sdd/execution-plan.json'));
  assert.notEqual(f.start().status, 0);
});


test('JSON completion keeps command logs separate from the structured result', t => {
  const f = setup(t);
  assert.equal(f.cli('workflow', 'start', f.dir, '--path', 'direct', '--scope', 'Bounded request').status, 0);
  const result = f.cli('workflow', 'complete', f.dir, '--verification-command', 'node -e "console.log(123)"', '--json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).outcome, 'verified');
});


test('scope edits cannot hide a corrupt authoritative plan', t => {
  const f = setup(t); assert.equal(f.start().status, 0);
  const file = join(f.dir, '.superpowers/sdd/execution-plan.json');
  const plan = readPlan(f.dir); plan.rationale = 'tampered approval';
  fs.writeFileSync(file, JSON.stringify(plan));
  fs.appendFileSync(join(f.dir, 'proposal.md'), ' changed scope');
  assert.notEqual(f.start().status, 0);
  assert.equal(readPlan(f.dir).rationale, 'tampered approval', 'do not overwrite broken evidence');
});

test('identical failed review cannot burn another attempt without new evidence', t => {
  const f = setup(t); assert.equal(f.start().status, 0);
  const head = f.commit('implementation');
  const report = join(f.dir, '.superpowers/sdd/reviews/final.md'); fs.writeFileSync(report, 'One unresolved issue');
  const input = { status: 'fail', base: f.base, head, report, issue: 'transaction' };
  recordReview(f.dir, 'final', input);
  assert.throws(() => recordReview(f.dir, 'final', input), /new evidence/);
  assert.equal(describeReviews(f.dir)[0].repair.failure_count, 1);
});
