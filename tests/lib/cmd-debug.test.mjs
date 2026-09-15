import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { canCreateSymlink } from '../helpers/symlink-support.mjs';
import { computeArtifactsHash, computeContractHash } from '../../scripts/lib/hash.mjs';
import { getOverlayPaths } from '../../scripts/lib/sdd-overlay.mjs';
import { inspectDebugEscalation } from '../../scripts/lib/debug-attempts.mjs';
import { readState, rebuildState, writeState } from '../../scripts/lib/state-loader.mjs';

const CLI_PATH = join(process.cwd(), 'scripts/spec-superflow.mjs');
let changeDir;
let outsideDir;

function ssf(args) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: 'utf8' });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function writeChange(directory) {
  writeFileSync(join(directory, 'proposal.md'), '## Why\nDebug escalation needs durable evidence and a hard gate.\n## What Changes\n- Guard DP-5.\n');
  writeFileSync(join(directory, 'design.md'), '# Design\n');
  writeFileSync(join(directory, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Guard DP-5\n');
  writeFileSync(join(directory, 'execution-contract.md'), '# Execution Contract\n');
  mkdirSync(join(directory, 'specs', 'debugging'), { recursive: true });
  writeFileSync(join(directory, 'specs', 'debugging', 'spec.md'), '## ADDED Requirements\n### Requirement: Guarded DP-5\nThe system SHALL require three failed fixes.\n#### Scenario: Escalate\n- **WHEN** three fixes fail\n- **THEN** escalation is allowed.\n');
  rebuildState(directory, { computeArtifactsHash, computeContractHash });
  const state = readState(directory);
  state.state = 'debugging';
  state.workflow = 'quick';
  writeState(directory, state);
}

function prepareCurrentPlan() {
  const state = readState(changeDir);
  state.state = 'approved-for-build';
  state.workflow = 'quick';
  writeState(changeDir, state);
  const wave = 'debug-guard:serial:1.1';
  assert.equal(ssf(['execution', 'recommend', changeDir, '--wave', wave]).exitCode, 0);
  const planned = ssf([
    'execution', 'plan', changeDir,
    '--mode', 'inline',
    '--confirm',
    '--reason', 'Bind debugging evidence to the current plan',
    '--wave', wave,
  ]);
  assert.equal(planned.exitCode, 0, planned.stderr);
  const plannedState = readState(changeDir);
  plannedState.state = 'debugging';
  writeState(changeDir, plannedState);
}

function preparePlanlessWorkflow(mode) {
  const initialState = readState(changeDir);
  initialState.state = 'exploring';
  initialState.workflow = 'auto';
  writeState(changeDir, initialState);

  const recommendation = ssf([
    'workflow', 'recommend', changeDir,
    '--task-count', '2', '--file-count', '2',
    '--config-doc-only', mode === 'tweak' ? 'yes' : 'no',
    '--schema-api-change', 'no', '--new-module', 'no',
    '--behavioral-constraint-change', 'no', '--cross-module-change', 'no',
    '--uncertainty', 'low',
    ...(mode === 'hotfix' ? ['--request-kind', 'incident'] : []),
    ...(mode === 'lightweight' ? [
      '--affected-path', 'tests/lib/cmd-debug.test.mjs',
      '--production-behavior', 'no', '--public-boundary', 'no', '--installer', 'no',
      '--state-machine', 'no', '--external-side-effect', 'no',
      '--data-permission-config-semantics', 'no', '--expected-behavior-clear', 'yes',
      '--verification-reproducible', 'yes', '--impact-paths-complete', 'yes',
    ] : []),
    '--json',
  ]);
  assert.equal(recommendation.exitCode, 0, recommendation.stderr);
  assert.equal(JSON.parse(recommendation.stdout).recommendation.mode, mode);

  const selection = ['tweak', 'lightweight'].includes(mode)
    ? ssf([
      'workflow', 'select', changeDir, '--mode', mode, '--confirm', '--reason', 'Bounded planless correction',
      ...(mode === 'lightweight' ? ['--scope-confirmation', 'Affected test paths and exclusions reviewed', '--verification', 'tdd'] : []),
    ])
    : ssf(['workflow', 'accept', changeDir, '--source', 'direct-request', '--verification', 'tdd']);
  assert.equal(selection.exitCode, 0, selection.stderr);

  const state = readState(changeDir);
  state.state = 'debugging';
  writeState(changeDir, state);
}

function evidence(name, content = name) {
  const directory = join(changeDir, '.superpowers', 'sdd', 'debug-evidence');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${name}.log`);
  writeFileSync(path, `${content}\n`);
  return path;
}

function record(id, evidencePath = evidence(id)) {
  return ssf([
    'debug', 'attempt', 'record', changeDir,
    '--id', id,
    '--summary', `Fix ${id} failed`,
    '--evidence', evidencePath,
    '--json',
  ]);
}

function escalate(extra = []) {
  return ssf([
    'debug', 'escalate', changeDir,
    '--decision', 'continue',
    '--reason', 'Three evidence-backed fixes failed',
    ...extra,
    '--json',
  ]);
}

beforeEach(() => {
  changeDir = mkdtempSync(join(tmpdir(), 'ssf-debug-cmd-'));
  outsideDir = mkdtempSync(join(tmpdir(), 'ssf-debug-outside-'));
  writeChange(changeDir);
});

afterEach(() => {
  rmSync(changeDir, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
});

describe('ssf debug', () => {
  it('rejects a Quick debugging context without a current execution plan', () => {
    const result = record('attempt-1');

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /execution plan/i);
    const escalation = escalate(['--confirm']);
    assert.equal(escalation.exitCode, 1);
    assert.match(escalation.stderr, /execution plan/i);
    assert.equal(existsSync(join(changeDir, '.superpowers', 'sdd', 'debug-attempts.json')), false);
    assert.equal(readState(changeDir).dp_5_result, null);
  });

  it('records a Quick debugging attempt with a valid direct receipt and no execution plan', () => {
    preparePlanlessWorkflow('quick');

    const result = record('attempt-1');

    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.context.execution_plan_hash, null);
    assert.match(payload.context.workflow_authorization_id, /^[0-9a-f-]{36}$/);
    assert.equal(existsSync(join(changeDir, '.superpowers', 'sdd', 'debug-attempts.json')), true);
  });

  it('persists direct Quick DP-5 escalation without an execution plan after three attempts', () => {
    preparePlanlessWorkflow('quick');
    for (const id of ['attempt-1', 'attempt-2', 'attempt-3']) {
      assert.equal(record(id).exitCode, 0);
    }

    const result = escalate(['--confirm']);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(readState(changeDir).dp_5_result, /^continue:/);
  });

  it('records a direct Hotfix debugging attempt with a valid receipt and no execution plan', () => {
    preparePlanlessWorkflow('hotfix');

    const result = record('attempt-1');

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).context.execution_plan_hash, null);
  });

  it('records a Tweak debugging attempt with a confirmed selection and no execution plan', () => {
    preparePlanlessWorkflow('tweak');

    const result = record('attempt-1');

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).context.execution_plan_hash, null);
  });

  it('records a lightweight debugging attempt with a confirmed receipt and no execution plan', () => {
    preparePlanlessWorkflow('lightweight');

    const result = record('attempt-1');

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).context.execution_plan_hash, null);
  });

  it('keeps lightweight DP-5 supported after completion evidence updates the receipt', () => {
    preparePlanlessWorkflow('lightweight');
    for (const id of ['attempt-1', 'attempt-2', 'attempt-3']) {
      assert.equal(record(id).exitCode, 0);
    }
    assert.equal(escalate(['--confirm']).exitCode, 0);

    const completion = ssf([
      'workflow', 'evidence', changeDir,
      '--focused-review', 'No scope expansion found',
      '--verification-command', 'node --test tests/lib/cmd-debug.test.mjs',
      '--verification-result', 'pass',
    ]);
    assert.equal(completion.exitCode, 0, completion.stderr);

    const inspection = inspectDebugEscalation(changeDir);
    assert.equal(inspection.supported, true, inspection.reason);
  });

  it('rejects prior planless attempts after the workflow receipt is replaced', () => {
    preparePlanlessWorkflow('quick');
    assert.equal(record('attempt-1').exitCode, 0);

    const state = readState(changeDir);
    state.state = 'exploring';
    state.workflow = 'auto';
    writeState(changeDir, state);
    preparePlanlessWorkflow('quick');

    const result = record('attempt-2');

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /stale|context/i);
  });

  it('rejects a tampered Quick receipt when no execution plan exists', () => {
    preparePlanlessWorkflow('quick');
    const receiptPath = getOverlayPaths(changeDir).workflowSelection;
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    receipt.selection.verification_strategy = 'bounded';
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const result = record('attempt-1');

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /execution plan/i);
  });

  it('keeps Full debugging dependent on a current execution plan', () => {
    const state = readState(changeDir);
    state.workflow = 'full';
    writeState(changeDir, state);

    const result = record('attempt-1');

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /execution plan/i);
  });

  it('keeps legacy Hotfix debugging dependent on a current execution plan', () => {
    const state = readState(changeDir);
    state.workflow = 'hotfix';
    writeState(changeDir, state);

    const result = record('attempt-1');

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /execution plan/i);
  });

  it('rejects attempt recording outside debugging state', () => {
    const state = readState(changeDir);
    state.state = 'executing';
    writeState(changeDir, state);

    const result = record('attempt-1');

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /debugging state/i);
  });

  it('records and shows one evidence-backed failed attempt', () => {
    prepareCurrentPlan();
    const recorded = record('attempt-1');
    assert.equal(recorded.exitCode, 0, recorded.stderr);

    const shown = ssf(['debug', 'attempt', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    const payload = JSON.parse(shown.stdout);
    assert.equal(payload.attempt_count, 1);
    assert.equal(payload.attempts[0].id, 'attempt-1');
    assert.match(payload.attempts[0].evidence_sha256, /^sha256:[a-f0-9]{64}$/);
  });

  it('rejects DP-5 escalation with fewer than three failed attempts', () => {
    prepareCurrentPlan();
    assert.equal(record('attempt-1').exitCode, 0);
    assert.equal(record('attempt-2').exitCode, 0);

    const result = escalate(['--confirm']);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /at least three/i);
    assert.equal(readState(changeDir).dp_5_result, null);
  });

  it('rejects duplicate failure evidence', () => {
    prepareCurrentPlan();
    const sharedEvidence = evidence('shared', 'same failure output');
    assert.equal(record('attempt-1', sharedEvidence).exitCode, 0);

    const duplicate = record('attempt-2', sharedEvidence);

    assert.equal(duplicate.exitCode, 1);
    assert.match(duplicate.stderr, /duplicate evidence/i);
  });

  it('rejects a ledger path redirected outside the change directory by a symlink', { skip: !canCreateSymlink() }, () => {
    prepareCurrentPlan();
    renameSync(join(changeDir, '.superpowers'), join(outsideDir, 'overlay'));
    symlinkSync(join(outsideDir, 'overlay'), join(changeDir, '.superpowers'), 'dir');
    const evidencePath = join(changeDir, 'attempt-1.log');
    writeFileSync(evidencePath, 'failed test output\n');

    const result = record('attempt-1', evidencePath);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /physical directory/i);
    assert.equal(existsSync(join(outsideDir, 'overlay', 'sdd', 'debug-attempts.json')), false);
  });

  it('does not count Wave Review repair failures as debugging attempts', () => {
    prepareCurrentPlan();
    const repairDirectory = join(changeDir, '.superpowers', 'sdd', 'repair-state');
    mkdirSync(repairDirectory, { recursive: true });
    writeFileSync(join(repairDirectory, 'wave-review.json'), JSON.stringify({ failure_count: 5 }));

    const result = escalate(['--confirm']);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /at least three/i);
  });

  it('rejects escalation when the recorded context is stale', () => {
    prepareCurrentPlan();
    for (const id of ['attempt-1', 'attempt-2', 'attempt-3']) {
      assert.equal(record(id).exitCode, 0);
    }
    writeFileSync(join(changeDir, 'proposal.md'), '## Why\nScope changed after debugging attempts were recorded.\n## What Changes\n- Different fix.\n');

    const result = escalate(['--confirm']);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /stale|context/i);
  });

  it('rejects escalation when recorded evidence is missing', () => {
    prepareCurrentPlan();
    const evidencePaths = [];
    for (const id of ['attempt-1', 'attempt-2', 'attempt-3']) {
      const evidencePath = evidence(id);
      evidencePaths.push(evidencePath);
      assert.equal(record(id, evidencePath).exitCode, 0);
    }
    unlinkSync(evidencePaths[1]);

    const result = escalate(['--confirm']);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /evidence does not exist/i);
  });

  it('rejects attempts and escalation when the current execution plan is stale', () => {
    prepareCurrentPlan();
    assert.equal(record('attempt-1').exitCode, 0);

    writeFileSync(join(changeDir, 'proposal.md'), '## Why\nThe execution plan is now stale.\n## What Changes\n- Changed scope.\n');
    const result = record('attempt-2');

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /execution plan is stale/i);
  });

  it('requires explicit confirmation even after three failed attempts', () => {
    prepareCurrentPlan();
    for (const id of ['attempt-1', 'attempt-2', 'attempt-3']) {
      assert.equal(record(id).exitCode, 0);
    }

    const result = escalate();

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /--confirm/i);
  });

  it('persists DP-5 only after three distinct attempts and confirmation', () => {
    prepareCurrentPlan();
    for (const id of ['attempt-1', 'attempt-2', 'attempt-3']) {
      assert.equal(record(id).exitCode, 0);
    }

    const result = escalate(['--confirm']);

    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.attempt_count, 3);
    const state = readState(changeDir);
    assert.match(state.dp_5_result, /^continue:/);
    assert.equal(state.dp_5_confirmed, 'true');
    assert.match(state.dp_5_timestamp, /^\d{4}-\d{2}-\d{2}T/);

    const laterAttempt = record('attempt-4');
    assert.equal(laterAttempt.exitCode, 1);
    assert.match(laterAttempt.stderr, /already recorded/i);
  });
});
