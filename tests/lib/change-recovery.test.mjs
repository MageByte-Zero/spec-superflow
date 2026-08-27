import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRecoverySummary, resolveChangeTarget } from '../../scripts/lib/change-recovery.mjs';
import { createPlan, writePlan } from '../../scripts/lib/execution-plan.mjs';
import { createRecommendationReceipt } from '../../scripts/lib/execution-recommendation.mjs';
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

  function makeCurrentExecutionPlan(changeDir, { waveId = 'content-wave' } = {}) {
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Content-level recovery\n');
    writeFileSync(join(changeDir, 'execution-contract.md'), '# Execution Contract\n\nContent evidence.\n');
    const waves = [{ id: waveId, strategy: 'serial', tasks: ['1.1'], depends_on: [] }];
    const recommendationReceipt = createRecommendationReceipt(changeDir, waves);
    const recommendation = recommendationReceipt.recommendation;
    const plan = createPlan(changeDir, {
      mode: recommendation.recommendation.mode,
      source: 'user-confirmed',
      rationale: 'Route from content-level plan evidence',
      waves,
      recommendation,
      recommendationReceipt,
      selection: {
        confirmed: true,
        followed_recommendation: true,
        acknowledged_non_recommendation: false,
      },
    });
    writePlan(changeDir, plan);
    return plan;
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

  it('routes to build-executor from plan content despite a lagging state field', () => {
    const change = makeChange('stale-state-plan', 'exploring');
    makeCurrentExecutionPlan(change, { waveId: 'wave-content-1' });

    const summary = createRecoverySummary(change);

    assert.equal(summary.execution.current, true);
    assert.equal(summary.execution.next_eligible_wave, 'wave-content-1');
    assert.equal(summary.next_action.skill, 'build-executor');
    assert.match(summary.next_action.reason, /wave-content-1/);
  });

  it('falls back to state-field routing when no execution plan exists', () => {
    const change = makeChange('no-plan', 'exploring');

    const summary = createRecoverySummary(change);

    assert.equal(summary.execution.present, false);
    assert.equal(summary.next_action.skill, 'need-explorer');
    assert.match(summary.next_action.reason, /Route from exploring/);
  });

  it('keeps terminal changes routed to no skill even with a valid plan', () => {
    const change = makeChange('terminal-plan', 'closing');
    makeCurrentExecutionPlan(change);

    const summary = createRecoverySummary(change);

    assert.equal(summary.terminal, true);
    assert.equal(summary.next_action.skill, 'none');
    assert.deepEqual(summary.blockers, []);
  });
});
