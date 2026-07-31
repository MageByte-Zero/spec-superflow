import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getCheckpoint, saveCheckpoint, listCheckpoints, createHandoff, listHandoffs, finishHandoff, resolveHandoff,
} from '../../scripts/lib/sdd-overlay.mjs';
import * as sddOverlay from '../../scripts/lib/sdd-overlay.mjs';

let changeDir;

const validHandoffInput = {
  type: 'research',
  title: 'Research findings',
  question: 'Which approach should the implementation use?',
  context: 'Compare the available implementation approaches.',
  source: 'Local repository inspection',
};

beforeEach(() => {
  changeDir = mkdtempSync(join(tmpdir(), 'sdd-overlay-'));
  writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Original task text\n');
  writeFileSync(join(changeDir, 'proposal.md'), '# Proposal\n\nA valid proposal.\n');
  writeFileSync(join(changeDir, 'design.md'), '# Design\n\nA valid design.\n');
  writeFileSync(join(changeDir, '.spec-superflow.yaml'), 'state: executing\nworkflow: auto\n');
});

afterEach(() => {
  rmSync(changeDir, { recursive: true, force: true });
});

describe('checkpoint storage', () => {
  it('returns the saved current schema while list and show reparse it', () => {
    const saved = saveCheckpoint(changeDir, { taskId: '1.1', next: 'Run the focused test' });

    assert.deepEqual(Object.keys(saved), [
      'task_id', 'task_hash', 'next', 'completed', 'evidence', 'review', 'risk',
      'commit_start', 'commit_end', 'created_at', 'stale',
    ]);
    assert.equal(saved.task_id, '1.1');
    assert.match(saved.task_hash, /^sha256:/);
    assert.equal(saved.next, 'Run the focused test');
    assert.equal(saved.completed, 'Not recorded');
    assert.equal(saved.evidence, 'Not recorded');
    assert.equal(saved.review, 'Not recorded');
    assert.equal(saved.risk, 'Not recorded');
    assert.equal(saved.commit_start, 'Not recorded');
    assert.equal(saved.commit_end, 'Not recorded');
    assert.equal(saved.stale, false);
    assert.deepEqual(listCheckpoints(changeDir)[0], saved);
    assert.deepEqual(getCheckpoint(changeDir, '1.1'), saved);

    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Changed task text\n');
    assert.equal(listCheckpoints(changeDir)[0].stale, true);
    assert.equal(getCheckpoint(changeDir, '1.1').stale, true);
  });

  it('computes the save task hash once without rereading the saved checkpoint', () => {
    const source = readFileSync(new URL('../../scripts/lib/sdd-overlay.mjs', import.meta.url), 'utf8');
    const saveBody = source.match(/export function saveCheckpoint[\s\S]*?\n}\n\nexport function listCheckpoints/)[0];

    assert.equal((saveBody.match(/computeTaskHash/g) ?? []).length, 1);
    assert.ok(saveBody.indexOf('computeTaskHash') < saveBody.indexOf('mkdirSync'));
    assert.doesNotMatch(saveBody, /readCheckpoint/);
  });

  it('persists commit boundaries and recovery fields across list and show reads', () => {
    saveCheckpoint(changeDir, {
      taskId: '1.1',
      next: 'Run the focused test',
      completed: 'Added parser tests',
      evidence: 'tests/lib/sdd-overlay.test.mjs',
      review: 'review.md',
      risk: 'None',
      commitStart: 'aaaaaaa',
      commitEnd: 'bbbbbbb',
    });

    const checkpoint = listCheckpoints(changeDir)[0];
    assert.equal(checkpoint.task_id, '1.1');
    assert.equal(checkpoint.next, 'Run the focused test');
    assert.equal(checkpoint.completed, 'Added parser tests');
    assert.equal(checkpoint.evidence, 'tests/lib/sdd-overlay.test.mjs');
    assert.equal(checkpoint.review, 'review.md');
    assert.equal(checkpoint.risk, 'None');
    assert.equal(checkpoint.commit_start, 'aaaaaaa');
    assert.equal(checkpoint.commit_end, 'bbbbbbb');
  });

  it('marks a checkpoint stale when its numbered task line changes', () => {
    saveCheckpoint(changeDir, { taskId: '1.1', next: 'Run the focused test' });
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Changed task text\n');

    assert.equal(listCheckpoints(changeDir)[0].stale, true);
  });

  it('keeps a checkpoint current when only its legal checkbox state changes', () => {
    saveCheckpoint(changeDir, { taskId: '1.1', next: 'Run the focused test' });
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [X] 1.1 Original task text\n');

    assert.equal(listCheckpoints(changeDir)[0].stale, false);
  });

  it('marks a checkpoint stale when its task is removed', () => {
    saveCheckpoint(changeDir, { taskId: '1.1', next: 'Run the focused test' });
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n');

    assert.equal(listCheckpoints(changeDir)[0].stale, true);
  });
});

describe('handoff storage', () => {
  it('creates HANDOFF.md and HANDOFF_RESULT.md and validates the latter on finish', () => {
    const handoff = createHandoff(changeDir, validHandoffInput);
    const handoffPath = join(handoff.directory, 'HANDOFF.md');
    const resultPath = join(handoff.directory, 'HANDOFF_RESULT.md');

    assert.equal(existsSync(handoffPath), true);
    assert.equal(existsSync(resultPath), true);
    writeFileSync(resultPath, validResult());
    assert.equal(finishHandoff(changeDir, handoff.id).status, 'result-ready');
  });

  it('keeps a handoff active when finish validation fails', () => {
    const handoff = createHandoff(changeDir, validHandoffInput);

    assert.throws(() => finishHandoff(changeDir, handoff.id), /Conclusion/);
    assert.equal(listHandoffs(changeDir)[0].status, 'active');
  });

  it('requires explicit drift acknowledgement before resolving', () => {
    const handoff = createReadyHandoff();
    writeFileSync(join(changeDir, 'design.md'), '# Changed design\n');

    assert.throws(
      () => resolveHandoff(changeDir, handoff.id, 'accept', false),
      /acknowledge-source-drift/,
    );
    assert.equal(resolveHandoff(changeDir, handoff.id, 'accept', true).status, 'resolved');
  });
});

describe('plan-scoped overlay paths', () => {
  it('isolates mutable records for two plan revisions while retaining root control files', () => {
    const root = sddOverlay.getOverlayPaths(changeDir);
    const first = planPaths({ hash: `sha256:${'a'.repeat(64)}`, revision: 1 });
    const second = planPaths({ hash: `sha256:${'a'.repeat(64)}`, revision: 2 });

    assert.equal(root.executionPlan, join(changeDir, '.superpowers', 'sdd', 'execution-plan.json'));
    assert.equal(root.executionRecommendation, join(changeDir, '.superpowers', 'sdd', 'execution-recommendation.json'));
    assert.equal(root.workflowSelection, join(changeDir, '.superpowers', 'sdd', 'workflow-selection.json'));
    assert.notEqual(first.planRoot, second.planRoot);
    for (const field of ['workspace', 'checkpoints', 'handoffs', 'reviews', 'repairState']) {
      assert.equal(typeof first[field], 'string', `${field} is resolved from the plan identity`);
      assert.notEqual(first[field], second[field], `${field} is not shared across revisions`);
      assert.notEqual(first[field], root[field], `${field} is not a legacy root-level mutable path`);
    }
  });

  it('resolves the same regenerable workspace after generated files are discarded', () => {
    const plan = { hash: `sha256:${'b'.repeat(64)}`, revision: 3 };
    const first = planPaths(plan);
    mkdirSync(first.workspace, { recursive: true });
    writeFileSync(join(first.workspace, 'task-1-brief.md'), 'generated task brief\n');

    rmSync(first.workspace, { recursive: true, force: true });
    assert.equal(existsSync(first.workspace), false);

    const recovered = planPaths(plan);
    assert.equal(recovered.workspace, first.workspace);
    mkdirSync(recovered.workspace, { recursive: true });
    writeFileSync(join(recovered.workspace, 'task-1-brief.md'), 'regenerated task brief\n');
    assert.equal(readFileSync(join(recovered.workspace, 'task-1-brief.md'), 'utf8'), 'regenerated task brief\n');
  });

  it('writes under the current plan and only reads a provably matching legacy checkpoint', () => {
    writeFileSync(join(changeDir, 'tasks.md'), [
      '# Tasks',
      '',
      '- [ ] 1.1 Matching legacy task',
      '- [ ] 1.2 Stale legacy task',
      '',
    ].join('\n'));
    saveCheckpoint(changeDir, { taskId: '1.1', next: 'Use proven legacy evidence' });
    saveCheckpoint(changeDir, { taskId: '1.2', next: 'Do not use stale evidence' });

    const plan = { hash: `sha256:${'d'.repeat(64)}`, revision: 4 };
    stampCheckpointPlan(changeDir, '1.1', plan.hash, plan.revision);
    stampCheckpointPlan(changeDir, '1.2', `sha256:${'e'.repeat(64)}`, plan.revision - 1);
    writeFileSync(join(changeDir, '.superpowers', 'sdd', 'execution-plan.json'), `${JSON.stringify(plan)}\n`);

    assert.deepEqual(listCheckpoints(changeDir).map(checkpoint => checkpoint.task_id), ['1.1']);

    const scoped = planPaths(plan);
    const saved = saveCheckpoint(changeDir, { taskId: '1.2', next: 'Write current plan evidence' });
    assert.equal(existsSync(join(scoped.checkpoints, '1.2.md')), true);
    assert.equal(existsSync(join(changeDir, '.superpowers', 'sdd', 'checkpoints', '1.2.md')), true);
    assert.equal(saved.plan_hash, plan.hash);
    assert.equal(saved.plan_revision, plan.revision);
    assert.deepEqual(listCheckpoints(changeDir).map(checkpoint => checkpoint.task_id), ['1.2']);
  });
});

function createReadyHandoff() {
  const handoff = createHandoff(changeDir, validHandoffInput);
  const resultPath = join(changeDir, '.superpowers', 'sdd', 'handoffs', handoff.id, 'HANDOFF_RESULT.md');
  writeFileSync(resultPath, validResult());
  return finishHandoff(changeDir, handoff.id);
}

function validResult() {
  return [
    '## Conclusion\nThe research is complete.',
    '## Evidence\nRepository evidence was reviewed.',
    '## Produced Artifacts\nThe handoff record was produced.',
    '## Risks\nNo additional risks were found.',
    '## Suggested Changes\nProceed with the selected approach.',
    '',
  ].join('\n');
}

function planPaths(plan) {
  assert.equal(typeof sddOverlay.getPlanScopedPaths, 'function',
    'plan-scoped path resolution is a public overlay helper');
  return sddOverlay.getPlanScopedPaths(changeDir, plan);
}

function stampCheckpointPlan(changeDir, taskId, planHash, planRevision) {
  const path = join(changeDir, '.superpowers', 'sdd', 'checkpoints', `${taskId}.md`);
  const record = readFileSync(path, 'utf8');
  writeFileSync(path, record.replace('---\n', [
    '---',
    `plan_hash: ${JSON.stringify(planHash)}`,
    `plan_revision: ${JSON.stringify(planRevision)}`,
    '',
  ].join('\n')));
}
