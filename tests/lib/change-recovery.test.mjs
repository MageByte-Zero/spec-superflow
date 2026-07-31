import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRecoverySummary, resolveChangeTarget } from '../../scripts/lib/change-recovery.mjs';
import { createHandoff, finishHandoff, saveCheckpoint } from '../../scripts/lib/sdd-overlay.mjs';

describe('change-recovery: resolveChangeTarget()', () => {
  let root;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ssf-change-recovery-test-'));
    mkdirSync(join(root, 'changes'));
  });

  after(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function makeChange(name, state) {
    const changeDir = join(root, 'changes', name);
    mkdirSync(changeDir);
    writeFileSync(join(changeDir, '.spec-superflow.yaml'), `state: ${state}\n`);
    return changeDir;
  }

  function makeExecutableChange(name) {
    const changeDir = makeChange(name, 'executing');
    writeFileSync(join(changeDir, 'tasks.md'), '- [ ] 1.1 Recovery summary\n');
    return changeDir;
  }

  function makeStaleCheckpoint(changeDir, taskId) {
    saveCheckpoint(changeDir, { taskId, next: 'Use this stale recovery note' });
    writeFileSync(join(changeDir, 'tasks.md'), '- [ ] 1.1 Recovery summary with changed scope\n');
  }

  function makeResultReadyHandoff(changeDir, id) {
    const handoff = createHandoff(changeDir, {
      id,
      type: 'research',
      title: 'Recovery research',
      question: 'What needs review?',
    });
    writeFileSync(join(handoff.directory, 'HANDOFF_RESULT.md'), [
      '## Conclusion\nReady',
      '## Evidence\nRecorded',
      '## Produced Artifacts\nNone',
      '## Risks\nNone',
      '## Suggested Changes\nNone',
      '',
    ].join('\n\n'));
    finishHandoff(changeDir, id);
  }

  function makeMalformedPlan(changeDir) {
    const planDir = join(changeDir, '.superpowers', 'sdd');
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, 'execution-plan.json'), '{not valid JSON');
  }

  it('selects the only active change and rejects ambiguous recovery', () => {
    makeChange('alpha', 'executing');
    assert.equal(resolveChangeTarget(undefined, root).name, 'alpha');
    makeChange('beta', 'specifying');
    assert.throws(
      () => resolveChangeTarget(undefined, root),
      error => {
        assert.equal(error.code, 'AMBIGUOUS_CHANGE');
        assert.deepEqual(error.details.candidates, ['alpha', 'beta']);
        return true;
      },
    );
  });

  it('requires switch targets to resolve to recognizable changes', () => {
    assert.throws(
      () => resolveChangeTarget('missing', root),
      error => error.code === 'TARGET_NOT_FOUND',
    );
  });

  it('prioritizes result-ready handoffs over execution-plan blockers', () => {
    const change = makeExecutableChange('summary-alpha');
    makeStaleCheckpoint(change, '1.1');
    makeResultReadyHandoff(change, 'research-1');

    const summary = createRecoverySummary(change);

    assert.equal(summary.checkpoint.status, 'stale');
    assert.deepEqual(
      summary.blockers.map(blocker => blocker.code),
      ['HANDOFF_REVIEW_REQUIRED', 'EXECUTION_PLAN_REQUIRED'],
    );
    assert.equal(
      summary.next_action.command,
      `ssf handoff resolve ${change} research-1 --decision <accept|reject|defer>`,
    );
  });

  it('keeps malformed-plan failures after sorted result-ready handoff blockers', () => {
    const change = makeExecutableChange('malformed-plan');
    makeResultReadyHandoff(change, 'research-z');
    makeResultReadyHandoff(change, 'research-a');
    makeMalformedPlan(change);

    const summary = createRecoverySummary(change);

    assert.equal(summary.execution.current, false);
    assert.match(summary.execution.failures[0], /Unable to read execution plan/);
    assert.deepEqual(
      summary.blockers.map(blocker => blocker.code),
      ['HANDOFF_REVIEW_REQUIRED', 'HANDOFF_REVIEW_REQUIRED', 'EXECUTION_PLAN_STALE'],
    );
    assert.deepEqual(
      summary.blockers.map(blocker => blocker.handoff),
      ['research-a', 'research-z', undefined],
    );
    assert.equal(
      summary.next_action.command,
      `ssf handoff resolve ${change} research-a --decision <accept|reject|defer>`,
    );
  });

  it('requires a current plan throughout execution states', () => {
    for (const state of ['approved-for-build', 'executing', 'debugging']) {
      const change = makeChange(`requires-plan-${state}`, state);
      const summary = createRecoverySummary(change);

      assert.equal(summary.execution.required, true);
      assert.deepEqual(summary.blockers.map(blocker => blocker.code), ['EXECUTION_PLAN_REQUIRED']);
      assert.equal(summary.next_action.skill, 'build-executor');
    }
  });

  it('returns no next skill for terminal changes', () => {
    const change = makeChange('done', 'closing');
    const summary = createRecoverySummary(change);

    assert.equal(summary.terminal, true);
    assert.equal(summary.next_action.skill, 'none');
    assert.deepEqual(summary.blockers, []);
  });

  it('returns no next skill for abandoned changes', () => {
    const change = makeChange('abandoned', 'abandoned');
    const summary = createRecoverySummary(change);

    assert.equal(summary.terminal, true);
    assert.equal(summary.next_action.skill, 'none');
    assert.deepEqual(summary.blockers, []);
  });
});
