import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { readCurrentReview, readPlan, recordReview } from '../../scripts/lib/execution-plan.mjs';
import { checkExecutionReviewsPassed } from '../../scripts/guard/checks/execution-reviews-passed.mjs';
import { writeIsolationContext } from '../../scripts/lib/isolation-context.mjs';
import { run as finish } from '../../scripts/lib/cmd-finish.mjs';
import { readState } from '../../scripts/lib/state-loader.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'spec-superflow.mjs');

/**
 * A repository whose trunk is `develop`: there is no local main/master, which is
 * exactly the layout where a final review range had no recorded anchor and no
 * trunk to fall back to. Every change here starts on that trunk and commits
 * straight onto it.
 */
function developTrunkFixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'ssf-anchor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'Spec Superflow Test');
  git('config', 'user.email', 'tests@example.invalid');
  fs.writeFileSync(join(root, 'seed.txt'), 'seed\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  const dir = join(root, 'changes', 'demo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'tasks.md'), '# Tasks\n\n- [ ] 1 do the work\n');
  fs.writeFileSync(join(dir, 'proposal.md'), '# Proposal\n\n## Why\n\nTrunk-branch review-anchor regression coverage.\n\n## What Changes\n\n- Record the start anchor and use it for the final review range.\n');
  const commit = (name, content) => {
    fs.writeFileSync(join(root, name), content);
    git('add', '-A');
    git('commit', '-qm', name);
    return git('rev-parse', 'HEAD');
  };
  const start = (reason = 'approved plan') => {
    const result = spawnSync(process.execPath, [CLI, 'workflow', 'start', dir, '--path', 'planned', '--confirm', '--reason', reason], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  const report = () => {
    const reports = join(dir, '.superpowers', 'sdd', 'reviews');
    fs.mkdirSync(reports, { recursive: true });
    const file = join(reports, 'final.md');
    fs.writeFileSync(file, 'Review completed without blocking findings.\n');
    return file;
  };
  return { root, dir, git, commit, start, report };
}

test('workflow start records the commit and branch the change started from', t => {
  const f = developTrunkFixture(t);
  const startHead = f.git('rev-parse', 'HEAD');
  f.start();
  const state = readState(f.dir);
  assert.equal(state.state, 'executing');
  assert.equal(state.review_base, startHead);
  assert.equal(state.target_branch, 'develop');
});

test('a re-approved scope change keeps the earliest start anchor', t => {
  const f = developTrunkFixture(t);
  const first = f.git('rev-parse', 'HEAD');
  f.start();
  // A second start happens after work already exists, so the range must still
  // begin at the first entry into executing.
  fs.writeFileSync(join(f.dir, 'tasks.md'), '# Tasks\n\n- [ ] 1 do the work\n- [ ] 2 cover it\n');
  const second = f.commit('extra.txt', 'extra\n');
  assert.notEqual(second, first);
  f.start('re-approved scope');
  assert.equal(readState(f.dir).review_base, first);
});

test('a develop trunk with no main/master can record a final review and close', t => {
  const f = developTrunkFixture(t);
  f.start();
  const anchor = readState(f.dir).review_base;
  const head = f.commit('impl.txt', 'impl\n');
  const receipt = recordReview(f.dir, 'final', { status: 'pass', base: anchor, head, report: f.report() });
  assert.equal(receipt.status, 'pass');
  assert.equal(receipt.base, anchor);
  assert.equal(receipt.head, head);
  assert.equal(checkExecutionReviewsPassed(f.dir).pass, true);
});

test('the recorded anchor still rejects a truncated or shifted final range', t => {
  const f = developTrunkFixture(t);
  f.start();
  const anchor = readState(f.dir).review_base;
  const first = f.commit('impl.txt', 'impl\n');
  const head = f.commit('impl2.txt', 'impl2\n');
  const report = f.report();
  assert.throws(() => recordReview(f.dir, 'final', { status: 'pass', base: first, head, report }), /complete target merge-base/);
  assert.throws(() => recordReview(f.dir, 'final', { status: 'pass', base: anchor, head: first, report }), /current HEAD/);
  assert.equal(recordReview(f.dir, 'final', { status: 'pass', base: anchor, head, report }).status, 'pass');
});

test('the start anchor outranks an isolation base recorded later', t => {
  const f = developTrunkFixture(t);
  f.start();
  const anchor = readState(f.dir).review_base;
  const midFlight = f.commit('impl.txt', 'impl\n');
  // The change's start commit is the range origin, so a later record must not
  // widen it back to the shared ancestor.
  writeIsolationContext(f.dir, {
    change_name: 'demo', target_branch: 'develop', isolation_branch: 'demo',
    target_root: f.root, isolation_root: f.root, kind: 'branch',
    finish_status: 'pending', review_base: midFlight,
  });
  const head = f.commit('impl2.txt', 'impl2\n');
  const report = f.report();
  assert.throws(() => recordReview(f.dir, 'final', { status: 'pass', base: midFlight, head, report }), /complete target merge-base/);
  assert.equal(recordReview(f.dir, 'final', { status: 'pass', base: anchor, head, report }).status, 'pass');
});

test('the review anchor never redirects a merge onto another equal-commit branch', t => {
  const f = developTrunkFixture(t);
  f.start();
  const anchor = readState(f.dir).review_base;
  const head = f.commit('impl.txt', 'impl\n');
  recordReview(f.dir, 'final', { status: 'pass', base: anchor, head, report: f.report() });
  // A second branch holding the identical commit must never be taken as the
  // trunk: `finish` requires recorded branch provenance and refuses otherwise.
  f.git('branch', 'copy', head);
  f.git('switch', '-q', 'copy');
  const sink = { stdout: { write() {} }, stderr: { write() {} } };
  assert.equal(finish([f.dir], sink).exitCode, 1);
  assert.equal(f.git('branch', '--show-current'), 'copy');
  assert.equal(f.git('rev-parse', 'HEAD'), head);
  assert.equal(readState(f.dir).review_base, anchor);
  assert.equal(readCurrentReview(f.dir, 'final', readPlan(f.dir))?.status, 'pass');
});
