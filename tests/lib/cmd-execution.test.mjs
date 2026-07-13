import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'scripts/spec-superflow.mjs');
let changeDir;

function runSsf(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { exitCode: 0, stdout, stderr: '', json: tryJson(stdout) };
  } catch (error) {
    return {
      exitCode: error.status ?? 1,
      stdout: error.stdout?.toString() ?? '',
      stderr: error.stderr?.toString() ?? '',
      json: tryJson(error.stdout?.toString() ?? ''),
    };
  }
}

function tryJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function writeChangeDirectory(directory, workflow = 'full', revision = null) {
  writeFileSync(join(directory, 'proposal.md'), '## Why\nEnough context to create a controlled execution plan.\n## What Changes\n- Guard execution.\n');
  writeFileSync(join(directory, 'design.md'), '# Design\n');
  writeFileSync(join(directory, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 First task\n- [ ] 1.2 Second task\n');
  writeFileSync(join(directory, 'execution-contract.md'), '# Execution Contract\n');
  mkdirSync(join(directory, 'specs', 'execution'), { recursive: true });
  writeFileSync(join(directory, 'specs', 'execution', 'spec.md'), '## ADDED Requirements\n### Requirement: Guarded execution\nThe system SHALL guard execution.\n#### Scenario: Create plan\n- **WHEN** a plan is created\n- **THEN** it is persisted.\n');
  writeFileSync(join(directory, '.spec-superflow.yaml'), [
    'state: approved-for-build',
    `workflow: ${workflow}`,
    revision === null ? null : `revision: ${revision}`,
    '',
  ].filter(line => line !== null).join('\n'));
}

function writeReviewReport(name, content = 'Review completed without blocking findings.\n') {
  const reportsDir = join(changeDir, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, name);
  writeFileSync(reportPath, content);
  return reportPath;
}

beforeEach(() => {
  changeDir = mkdtempSync(join(tmpdir(), 'ssf-execution-cmd-'));
  writeChangeDirectory(changeDir);
});

afterEach(() => {
  rmSync(changeDir, { recursive: true, force: true });
});

describe('ssf execution', () => {
  it('records DP-4 and state summary only after writing a valid default SDD plan', () => {
    const result = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd',
      '--reason', 'full workflow default', '--wave', 'wave-1:parallel:1.1,1.2', '--json']);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.plan.mode, 'sdd');
    assert.equal(result.json.plan.revision, 1);
    assert.equal(runSsf(['state', 'get', changeDir, 'execution_mode', '--json']).json.value, 'sdd');
    assert.match(runSsf(['state', 'get', changeDir, 'execution_plan_hash', '--json']).json.value, /^sha256:/);
    assert.equal(runSsf(['state', 'get', changeDir, 'execution_plan_revision', '--json']).json.value, 1);
    assert.match(runSsf(['state', 'get', changeDir, 'dp_4_result', '--json']).json.value, /plan revision 1/);
  });

  it('rejects batch-inline without an explicit user override', () => {
    const result = runSsf(['execution', 'plan', changeDir, '--mode', 'batch-inline',
      '--reason', 'operator wants a batch', '--wave', 'wave-1:serial:1.1', '--json']);

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /override/i);
  });

  it('rejects multiline and control-character reasons before mutating the plan or state', () => {
    const statePath = join(changeDir, '.spec-superflow.yaml');
    const planPath = join(changeDir, '.superpowers', 'sdd', 'execution-plan.json');
    const originalState = readFileSync(statePath, 'utf8');

    for (const reason of ['approved\nexecution_mode: inline', 'approved\u0001inline']) {
      const result = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', reason,
        '--wave', 'wave-1:parallel:1.1,1.2', '--json']);

      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /reason.*control|reason.*line/i);
      assert.equal(readFileSync(statePath, 'utf8'), originalState);
      assert.equal(existsSync(planPath), false);
    }
  });

  it('shows the persisted execution plan', () => {
    runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default',
      '--wave', 'wave-1:parallel:1.1,1.2']);

    const result = runSsf(['execution', 'show', changeDir, '--json']);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.plan.mode, 'sdd');
    assert.equal(result.json.valid, true);
    assert.equal(result.json.current, true);
    assert.deepEqual(result.json.waves, [{
      id: 'wave-1',
      strategy: 'parallel',
      tasks: ['1.1', '1.2'],
      depends_on: [],
      eligible: true,
      retryable: false,
      receipt: null,
      blockers: [],
    }]);
  });

  it('does not show a pass receipt after its report evidence is deleted', () => {
    runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default',
      '--wave', 'wave-1:serial:1.1']);
    const reportPath = writeReviewReport('wave-1.md');
    const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', 'abc1234', '--head', 'def5678', '--report', reportPath, '--verdict', 'pass']);
    assert.equal(reviewed.exitCode, 0, reviewed.stderr);

    rmSync(reportPath);

    const shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.waves[0].receipt, null);
    assert.equal(shown.json.waves[0].eligible, true);
  });

  it('encodes wave dependencies and refuses review of a wave before its dependencies pass', () => {
    const planned = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd',
      '--reason', 'full workflow default',
      '--wave', 'wave-1:parallel:1.1,1.2',
      '--wave', 'wave-2:serial:2.1:wave-1', '--json']);
    assert.equal(planned.exitCode, 0, planned.stderr);
    assert.deepEqual(planned.json.plan.waves[1].depends_on, ['wave-1']);

    const shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.waves[0].eligible, true);
    assert.equal(shown.json.waves[1].eligible, false);
    assert.deepEqual(shown.json.waves[1].blockers, ['wave-1']);

    const premature = runSsf(['execution', 'review', changeDir, '--wave', 'wave-2',
      '--base', 'abc1234', '--head', 'def5678', '--report', 'reports/wave-2.md', '--verdict', 'pass']);
    assert.notEqual(premature.exitCode, 0);
    assert.match(premature.stderr, /wave-1.*pass|dependencies/i);
  });

  it('rejects a plan when state mode differs from the frozen plan mode', () => {
    runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default',
      '--wave', 'wave-1:parallel:1.1,1.2']);
    const statePath = join(changeDir, '.spec-superflow.yaml');
    writeFileSync(statePath, readFileSync(statePath, 'utf8').replace('execution_mode: sdd', 'execution_mode: inline'));

    const result = runSsf(['execution', 'show', changeDir, '--json']);

    assert.notEqual(result.exitCode, 0);
    assert.equal(result.json.valid, false);
    assert.ok(result.json.failures.includes('execution plan mode does not match state'));
  });

  it('increments revision when a batch-inline plan is revised to SDD', () => {
    const initial = runSsf(['execution', 'plan', changeDir, '--mode', 'batch-inline', '--override',
      '--reason', 'operator requested a batch', '--wave', 'wave-1:serial:1.1']);
    assert.equal(initial.exitCode, 0, initial.stderr);

    const revised = runSsf(['execution', 'revise', changeDir, '--mode', 'sdd',
      '--reason', 'risk requires independent review', '--wave', 'wave-1:parallel:1.1,1.2', '--json']);

    assert.equal(revised.exitCode, 0, revised.stderr);
    assert.equal(revised.json.plan.revision, 2);
    assert.equal(runSsf(['state', 'get', changeDir, 'execution_plan_revision', '--json']).json.value, 2);
  });

  it('invalidates receipts from the replaced plan revision', () => {
    const initial = runSsf(['execution', 'plan', changeDir, '--mode', 'batch-inline', '--override',
      '--reason', 'operator requested a batch', '--wave', 'wave-1:serial:1.1']);
    assert.equal(initial.exitCode, 0, initial.stderr);
    const reportPath = writeReviewReport('wave-1.md');
    const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', 'abc1234', '--head', 'def5678', '--report', reportPath, '--verdict', 'pass']);
    assert.equal(reviewed.exitCode, 0, reviewed.stderr);

    const revised = runSsf(['execution', 'revise', changeDir, '--mode', 'sdd',
      '--reason', 'risk requires independent review', '--wave', 'wave-1:parallel:1.1,1.2', '--json']);
    assert.equal(revised.exitCode, 0, revised.stderr);

    const shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.current, true);
    assert.equal(shown.json.waves[0].receipt, null);
    assert.equal(shown.json.waves[0].eligible, true);
  });

  it('replans a current SDD plan with a new revision, renewed DP-4 state, and cleared receipts', () => {
    const initial = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd',
      '--reason', 'full workflow default', '--wave', 'wave-1:serial:1.1']);
    assert.equal(initial.exitCode, 0, initial.stderr);
    const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', 'base-1', '--head', 'head-1', '--report', writeReviewReport('wave-1.md'), '--verdict', 'pass']);
    assert.equal(reviewed.exitCode, 0, reviewed.stderr);

    const replanned = runSsf(['execution', 'revise', changeDir, '--mode', 'sdd',
      '--reason', 'split independent work into a recovery wave',
      '--wave', 'wave-1:parallel:1.1,1.2', '--json']);

    assert.equal(replanned.exitCode, 0, replanned.stderr);
    assert.equal(replanned.json.plan.revision, 2);
    assert.equal(runSsf(['state', 'get', changeDir, 'execution_plan_revision', '--json']).json.value, 2);
    assert.match(runSsf(['state', 'get', changeDir, 'dp_4_result', '--json']).json.value, /plan revision 2/);
    const shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.current, true);
    assert.equal(shown.json.waves[0].receipt, null);
  });

  it('recovers a stale SDD plan by revising it to current artifacts and clearing old receipts', () => {
    const initial = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd',
      '--reason', 'full workflow default', '--wave', 'wave-1:serial:1.1']);
    assert.equal(initial.exitCode, 0, initial.stderr);
    const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', 'base-1', '--head', 'head-1', '--report', writeReviewReport('stale-wave-1.md'), '--verdict', 'pass']);
    assert.equal(reviewed.exitCode, 0, reviewed.stderr);
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Updated task\n- [ ] 1.2 Recovery task\n');

    const replanned = runSsf(['execution', 'revise', changeDir, '--mode', 'sdd',
      '--reason', 'refresh the plan after task scope changed',
      '--wave', 'wave-1:parallel:1.1,1.2', '--json']);

    assert.equal(replanned.exitCode, 0, replanned.stderr);
    assert.equal(replanned.json.plan.revision, 2);
    const shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.current, true);
    assert.equal(shown.json.waves[0].receipt, null);
    assert.match(runSsf(['state', 'get', changeDir, 'dp_4_result', '--json']).json.value, /plan revision 2/);
  });

  it('makes a failed current wave retryable while blocking dependents until its replacement pass receipt', () => {
    const planned = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd',
      '--reason', 'repair reviews before dependent work',
      '--wave', 'wave-1:serial:1.1',
      '--wave', 'wave-2:serial:1.2:wave-1']);
    assert.equal(planned.exitCode, 0, planned.stderr);

    const failed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', 'base-fail', '--head', 'head-fail', '--report', writeReviewReport('wave-1-fail.md'), '--verdict', 'fail']);
    assert.equal(failed.exitCode, 0, failed.stderr);

    let shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.waves[0].receipt.status, 'fail');
    assert.equal(shown.json.waves[0].retryable, true);
    assert.equal(shown.json.waves[0].eligible, true);
    assert.equal(shown.json.waves[1].eligible, false);
    assert.deepEqual(shown.json.waves[1].blockers, ['wave-1']);

    const replacement = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', 'base-pass', '--head', 'head-pass', '--report', writeReviewReport('wave-1-pass.md'), '--verdict', 'pass']);
    assert.equal(replacement.exitCode, 0, replacement.stderr);

    shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.waves[0].receipt.status, 'pass');
    assert.equal(shown.json.waves[0].retryable, false);
    assert.equal(shown.json.waves[0].eligible, false);
    assert.equal(shown.json.waves[1].eligible, true);
  });

  it('keeps the Task 1 state revision aligned through plan, show, revise, and show', () => {
    writeChangeDirectory(changeDir, 'full', 2);
    const initial = runSsf(['execution', 'plan', changeDir, '--mode', 'batch-inline', '--override',
      '--reason', 'operator requested a batch', '--wave', 'wave-1:serial:1.1', '--json']);
    assert.equal(initial.exitCode, 0, initial.stderr);
    assert.equal(initial.json.plan.revision, 2);

    const firstShow = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(firstShow.exitCode, 0, firstShow.stderr);
    assert.equal(firstShow.json.valid, true);
    assert.equal(runSsf(['state', 'get', changeDir, 'revision', '--json']).json.value, 2);

    const revised = runSsf(['execution', 'revise', changeDir, '--mode', 'sdd',
      '--reason', 'risk requires independent review', '--wave', 'wave-1:parallel:1.1,1.2', '--json']);
    assert.equal(revised.exitCode, 0, revised.stderr);
    assert.equal(revised.json.plan.revision, 3);

    const secondShow = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(secondShow.exitCode, 0, secondShow.stderr);
    assert.equal(secondShow.json.valid, true);
    assert.equal(runSsf(['state', 'get', changeDir, 'revision', '--json']).json.value, 3);
  });

  it('rejects an invalid review verdict without writing a receipt', () => {
    runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default',
      '--wave', 'wave-1:parallel:1.1,1.2']);

    const result = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', 'abc1234', '--head', 'def5678', '--report', 'reports/wave-1.md', '--verdict', 'maybe', '--json']);

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /pass.*fail|verdict/i);
  });

  it('rejects a review without exactly one wave selector', () => {
    const result = runSsf(['execution', 'review', changeDir, '--base', 'abc1234',
      '--head', 'def5678', '--report', 'reports/wave-1.md', '--verdict', 'pass']);

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /--wave is required/);
  });

  it('rejects malformed waves and SDD plan downgrades', () => {
    const malformed = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'bad wave', '--wave', 'missing-parts']);
    assert.notEqual(malformed.exitCode, 0);
    assert.match(malformed.stderr, /wave/i);

    runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default', '--wave', 'wave-1:serial:1.1']);
    const invalidRevision = runSsf(['execution', 'revise', changeDir, '--mode', 'inline', '--override', '--reason', 'downgrade', '--wave', 'wave-1:serial:1.1']);
    assert.notEqual(invalidRevision.exitCode, 0);
    assert.match(invalidRevision.stderr, /sdd|downgrade|upgrade/i);
  });
});
