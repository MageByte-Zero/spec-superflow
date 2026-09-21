import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createPlan, writePlan, recordReview, describeReviews, adjudicateWave } from '../../scripts/lib/execution-plan.mjs';
import { createRecommendationReceipt } from '../../scripts/lib/execution-recommendation.mjs';
import { createRecoverySummary, resolveChangeTarget } from '../../scripts/lib/change-recovery.mjs';
import { checkExecutionReviewsPassed } from '../../scripts/guard/checks/execution-reviews-passed.mjs';
import { writeIsolationContext, readIsolationContext } from '../../scripts/lib/isolation-context.mjs';
import { run as finish } from '../../scripts/lib/cmd-finish.mjs';
import { SpecSuperflowPlugin } from '../../.opencode/plugins/spec-superflow.js';
import { generatePhaseGuard } from '../../scripts/lib/cmd-inject.mjs';
import { runGuard } from '../../scripts/guard/guard.mjs';
import { readState, writeState } from '../../scripts/lib/state-loader.mjs';
import { computeArtifactsHash, computeContractHash } from '../../scripts/lib/hash.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'ssf-boundary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.test');
  fs.writeFileSync(join(root, '.gitignore'), 'changes/\ndep.txt\nruns.txt\n');
  fs.writeFileSync(join(root, 'verify.cjs'), "const fs=require('fs');fs.appendFileSync('runs.txt','run\\n');if(fs.readFileSync('dep.txt','utf8')!=='good')process.exit(1);");
  git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD'); git('switch', '-c', 'feature');
  const commit = text => { fs.writeFileSync(join(root, 'code.txt'), text); git('add', '.'); git('commit', '-qm', text); return git('rev-parse', 'HEAD'); };
  const first = commit('first'), head = commit('second');
  const dir = join(root, 'changes', 'demo'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, '.spec-superflow.yaml'), 'state: executing\nworkflow: full\n');
  fs.writeFileSync(join(dir, 'tasks.md'), '- [x] 1 Done\n');
  fs.writeFileSync(join(dir, 'execution-contract.md'), 'Approved contract\n');
  const waves = [{ id: 'w1', strategy: 'serial', tasks: ['1'], depends_on: [] }];
  const recommendation = createRecommendationReceipt(dir, waves);
  const plan = createPlan(dir, { mode: 'inline', reviewPolicy: 'final', source: 'user-confirmed', rationale: 'bounded work', waves,
    recommendation: recommendation.recommendation, recommendationReceipt: recommendation,
    selection: { confirmed: true, followed_recommendation: true, acknowledged_non_recommendation: false } });
  writePlan(dir, plan);
  const report = join(dir, '.superpowers/sdd/reviews/report.md'); fs.writeFileSync(report, 'Review evidence\n');
  const review = (status, from, to) => recordReview(dir, 'final', { status, base: from, head: to, report });
  return { root, git, base, first, head, dir, commit, plan, review, report };
}

test('final review rejects HEAD~1 even when it is an ancestor of current HEAD', t => {
  const f = fixture(t);
  assert.throws(() => f.review('pass', f.first, f.head), /complete|merge-base|whole|target/i);
  assert.equal(checkExecutionReviewsPassed(f.dir).pass, false);
});

test('different commits with identical trees cannot certify a passing review', t => {
  const f = fixture(t);
  f.git('reset', '--hard', f.base); f.git('commit', '--allow-empty', '-qm', 'empty');
  assert.throws(() => f.review('pass', f.base, f.git('rev-parse', 'HEAD')), /non-empty|diff/i);
});

test('whole-range final repair passes and a fix-only receipt is rejected', t => {
  const f = fixture(t); f.review('fail', f.base, f.head);
  const fixed = f.commit('fixed');
  assert.throws(() => f.review('pass', f.head, fixed), /complete|merge-base|whole|target/i);
  f.review('pass', f.base, fixed);
  assert.equal(checkExecutionReviewsPassed(f.dir).pass, true);
  assert.equal(describeReviews(f.dir, f.plan)[0].repair.status, 'resolved');
});

test('final adjudication is a recovery blocker, then authorization resumes exactly one review', t => {
  const f = fixture(t); let head = f.head;
  for (let i = 0; i < 3; i++) { f.review('fail', f.base, head); if (i < 2) head = f.commit(`fix${i}`); }
  const summary = createRecoverySummary(f.dir);
  assert.equal(summary.ok, false);
  assert.equal(summary.continuation.kind, 'blocked');
  assert.ok(summary.blockers.some(b => b.code === 'REVIEW_ADJUDICATION_REQUIRED'));
  const state = readState(f.dir); state.state = 'debugging'; writeState(f.dir, state);
  assert.equal(createRecoverySummary(f.dir).continuation.kind, 'blocked');
  state.state = 'executing'; writeState(f.dir, state);
  adjudicateWave(f.dir, 'final', { decision: 'allow-review', confirmed: true, reason: 'new evidence reviewed' });
  assert.equal(createRecoverySummary(f.dir).continuation.kind, 'automatic');
  head = f.commit('authorized fix'); f.review('pass', f.base, head);
  assert.equal(checkExecutionReviewsPassed(f.dir).pass, true);
});

test('lost direct Hotfix receipt requests receipt repair without a legacy execution plan', t => {
  const f = fixture(t);
  fs.rmSync(join(f.dir, '.superpowers'), { recursive: true });
  fs.writeFileSync(join(f.dir, '.spec-superflow.yaml'), 'state: debugging\nworkflow: hotfix\nworkflow_variant: direct\n');
  const summary = createRecoverySummary(f.dir);
  assert.equal(summary.execution.required, false);
  assert.equal(summary.blockers[0].code, 'WORKFLOW_RECEIPT_REQUIRED');
  assert.equal(summary.continuation.kind, 'blocked');
});

test('OpenCode ordinary messages receive no unsolicited workflow context', async t => {
  const f = fixture(t);
  const plugin = await SpecSuperflowPlugin({ directory: f.root });
  const output = { messages: [{ info: { role: 'user' }, parts: [{ type: 'text', text: 'Explain array map' }] }] };
  await plugin['experimental.chat.messages.transform']({}, output);
  assert.equal(output.messages[0].parts.length, 1);
});

test('recovery uses the recorded worktree instead of the stale source change', t => {
  const f = fixture(t), wt = `${f.root}-wt`;
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  f.git('switch', 'main'); f.git('worktree', 'add', wt, 'feature');
  const change = join(wt, 'changes/demo'); fs.mkdirSync(change, { recursive: true });
  fs.writeFileSync(join(change, '.spec-superflow.yaml'), 'state: debugging\nworkflow: quick\n');
  writeIsolationContext(f.dir, { change_name: 'demo', change_relative_path: 'changes/demo', target_root: f.root,
    target_branch: 'main', isolation_root: wt, isolation_branch: 'feature', kind: 'worktree', setup_status: 'ready', finish_status: 'pending' });
  const target = resolveChangeTarget(f.dir);
  assert.equal(fs.realpathSync(target.path), fs.realpathSync(change));
  assert.equal(target.state, 'debugging');
  fs.rmSync(change, { recursive: true });
  assert.throws(() => resolveChangeTarget(f.dir), /isolation|worktree/i);
});

test('corrupt persisted state blocks recovery instead of restarting exploration', t => {
  const f = fixture(t); fs.writeFileSync(join(f.dir, '.spec-superflow.yaml'), 'state: broken\nworkflow: full\n');
  const s = createRecoverySummary(f.dir);
  assert.equal(s.ok, false); assert.equal(s.continuation.kind, 'blocked');
  assert.equal(s.blockers[0].code, 'STATE_RECOVERY_REQUIRED');
});

test('terminal recovery does not parse corrupt historical execution overlays', t => {
  const f = fixture(t); fs.writeFileSync(join(f.dir, '.spec-superflow.yaml'), 'state: abandoned\nworkflow: full\n');
  fs.writeFileSync(join(f.dir, '.superpowers/sdd/execution-plan.json'), '{corrupt');
  const s = createRecoverySummary(f.dir);
  assert.equal(s.continuation.kind, 'terminal'); assert.equal(s.next_action.skill, 'none');
});

test('generated closing instructions preserve physical finish recovery and scope applicability', () => {
  const guard = generatePhaseGuard({ state: 'closing', workflow: 'full', change_name: 'demo' });
  assert.match(guard, /finish/);
  assert.doesNotMatch(guard, /next skill 为 none/);
  assert.match(guard, /only|仅/);
});

test('initialization can resume inside the worktree without overwriting newer artifacts', t => {
  const f = fixture(t), wt = `${f.root}-wt`;
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  f.git('switch', 'main'); f.git('worktree', 'add', wt, 'feature');
  const change = join(wt, 'changes/demo'); fs.mkdirSync(change, { recursive: true });
  fs.writeFileSync(join(change, 'tasks.md'), 'newer worktree notes');
  writeIsolationContext(f.dir, { change_name: 'demo', change_relative_path: 'changes/demo', target_root: f.root,
    target_branch: 'main', isolation_root: wt, isolation_branch: 'feature', kind: 'worktree', setup_status: 'initializing', finish_status: 'pending' });
  const result = spawnSync(process.execPath, ['scripts/ensure-branch.mjs', change], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readIsolationContext(change).setup_status, 'ready');
  assert.equal(fs.readFileSync(join(change, 'tasks.md'), 'utf8'), 'newer worktree notes');
});

test('repository root is never accepted as an active change to copy', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, ['scripts/ensure-branch.mjs', f.root], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
});

test('default isolation creates a feature branch in place without copying the change', t => {
  const f = fixture(t); f.git('switch', 'main');
  const before = fs.readFileSync(join(f.dir, 'tasks.md'), 'utf8');
  const result = spawnSync(process.execPath, ['scripts/spec-superflow.mjs', 'isolate', f.dir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.git('branch', '--show-current'), 'demo');
  assert.equal(readIsolationContext(f.dir).kind, 'branch');
  assert.equal(f.git('worktree', 'list', '--porcelain').split('worktree ').length - 1, 1);
  assert.equal(fs.readFileSync(join(f.dir, 'tasks.md'), 'utf8'), before);
});

test('branch name collision does not switch onto unrelated existing work', t => {
  const f = fixture(t); f.git('branch', 'demo'); f.git('switch', 'main');
  const result = spawnSync(process.execPath, ['scripts/spec-superflow.mjs', 'isolate', f.dir], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.equal(f.git('branch', '--show-current'), 'main');
});

test('failed branch-only finish returns to the feature branch for safe repair', t => {
  const f = fixture(t);
  writeIsolationContext(f.dir, { change_name: 'demo', change_relative_path: 'changes/demo', target_root: f.root,
    target_branch: 'main', isolation_root: f.root, isolation_branch: 'feature', kind: 'branch', finish_status: 'pending', review_base: f.base });
  const sink = { stdout: { write() {} }, stderr: { write() {} } };
  assert.equal(finish([f.dir, '--test-cmd', 'node -e "process.exit(1)"'], sink).exitCode, 1);
  assert.equal(f.git('branch', '--show-current'), 'feature');
  assert.equal(readIsolationContext(f.dir).finish_status, 'verify-pending');
});

test('stale contract recovery rewinds to bridging instead of recreating an existing plan', t => {
  const f = fixture(t); fs.appendFileSync(join(f.dir, 'execution-contract.md'), 'Changed contract');
  const s = createRecoverySummary(f.dir);
  assert.equal(s.next_action.skill, 'contract-builder');
  assert.match(s.next_action.command, /bridging/);
});

test('entering debugging does not silently approve a changed contract', t => {
  const f = fixture(t), state = readState(f.dir);
  state.artifacts_hash = computeArtifactsHash(f.dir); state.contract_hash = computeContractHash(f.dir); writeState(f.dir, state);
  fs.appendFileSync(join(f.dir, 'execution-contract.md'), 'Unapproved behavior');
  const result = spawnSync(process.execPath, ['scripts/spec-superflow.mjs', 'state', 'transition', f.dir, 'debugging'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readState(f.dir).contract_hash, state.contract_hash);
  const check = spawnSync(process.execPath, ['scripts/spec-superflow.mjs', 'state', 'check', f.dir, '--json'], { encoding: 'utf8' });
  assert.equal(check.status, 1);
});

test('only an unfinished physical verification can reopen closing for diagnosis', t => {
  const f = fixture(t), sink = { write() {} };
  const state = readState(f.dir); state.state = 'closing'; writeState(f.dir, state);
  const args = ['check', f.dir, 'closing', 'debugging'];
  assert.equal(runGuard(args, { stdout: sink, stderr: sink }).exitCode, 1);
  const context = { change_name: 'demo', target_root: f.root, target_branch: 'main', isolation_root: f.root,
    isolation_branch: 'feature', kind: 'branch', finish_status: 'verify-pending', review_base: f.base };
  writeIsolationContext(f.dir, context);
  assert.equal(runGuard(args, { stdout: sink, stderr: sink }).exitCode, 0);
  assert.equal(createRecoverySummary(f.dir).next_action.skill, 'bug-investigator');
  writeIsolationContext(f.dir, { ...context, finish_status: 'complete' });
  assert.equal(runGuard(args, { stdout: sink, stderr: sink }).exitCode, 1);
  assert.equal(createRecoverySummary(f.dir).continuation.kind, 'terminal');
});

test('finish retry revalidates ignored inputs and retains isolation on failure', t => {
  const f = fixture(t), wt = `${f.root}-wt`;
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  f.git('switch', 'main'); f.git('worktree', 'add', wt, 'feature');
  const change = join(wt, 'changes/demo'); fs.mkdirSync(change, { recursive: true });
  fs.writeFileSync(join(change, '.spec-superflow.yaml'), 'state: closing\n');
  fs.writeFileSync(join(f.root, 'dep.txt'), 'good');
  writeIsolationContext(change, { change_name: 'demo', change_relative_path: 'changes/demo', target_root: f.root,
    target_branch: 'main', isolation_root: wt, isolation_branch: 'feature', kind: 'worktree', finish_status: 'pending' });
  let failOnce = true;
  const runner = (args, options) => {
    if (args.includes('remove') && failOnce) { failOnce = false; throw new Error('temporary cleanup lock'); }
    return execFileSync('git', args, options);
  };
  const sink = { stdout: { write() {} }, stderr: { write() {} } };
  assert.equal(finish([change, '--test-cmd', 'node verify.cjs'], sink, runner).exitCode, 1);
  fs.writeFileSync(join(f.root, 'dep.txt'), 'broken');
  assert.equal(finish([change, '--test-cmd', 'node verify.cjs'], sink, runner).exitCode, 1);
  assert.equal(fs.existsSync(wt), true);
  assert.equal(fs.readFileSync(join(f.root, 'runs.txt'), 'utf8'), 'run\nrun\n');
});


test('recorded isolation cannot silently authorize a different feature branch', t => {
  const f = fixture(t);
  writeIsolationContext(f.dir, { change_name: 'demo', change_relative_path: 'changes/demo', target_root: f.root,
    target_branch: 'main', isolation_root: f.root, isolation_branch: 'feature', kind: 'branch', finish_status: 'pending', review_base: f.base });
  f.git('switch', '-c', 'unrelated');
  const result = spawnSync(process.execPath, ['scripts/spec-superflow.mjs', 'isolate', f.dir], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.throws(() => resolveChangeTarget(f.dir), /recorded isolation branch/);
  assert.equal(f.git('branch', '--show-current'), 'unrelated');
});


test('verification that modifies tracked files cannot certify or clean up isolation', t => {
  const f = fixture(t);
  writeIsolationContext(f.dir, { change_name: 'demo', change_relative_path: 'changes/demo', target_root: f.root,
    target_branch: 'main', isolation_root: f.root, isolation_branch: 'feature', kind: 'branch', finish_status: 'pending', review_base: f.base });
  const script = join(f.dir, 'mutate.cjs');
  fs.writeFileSync(script, "require('fs').appendFileSync('code.txt', ' changed by verification');");
  const sink = { stdout: { write() {} }, stderr: { write() {} } };
  assert.equal(finish([f.dir, '--test-cmd', `node "${script}"`], sink).exitCode, 1);
  assert.equal(readIsolationContext(f.dir).finish_status, 'verify-pending');
  assert.equal(f.git('rev-parse', 'feature'), f.head);
});
