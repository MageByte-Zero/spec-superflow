import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { computeArtifactsHash, computeContractHash } from '../../scripts/lib/hash.mjs';
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
  it('rejects attempt recording outside debugging state', () => {
    const state = readState(changeDir);
    state.state = 'executing';
    writeState(changeDir, state);

    const result = record('attempt-1');

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /debugging state/i);
  });

  it('records and shows one evidence-backed failed attempt', () => {
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
    assert.equal(record('attempt-1').exitCode, 0);
    assert.equal(record('attempt-2').exitCode, 0);

    const result = escalate(['--confirm']);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /at least three/i);
    assert.equal(readState(changeDir).dp_5_result, null);
  });

  it('rejects duplicate failure evidence', () => {
    const sharedEvidence = evidence('shared', 'same failure output');
    assert.equal(record('attempt-1', sharedEvidence).exitCode, 0);

    const duplicate = record('attempt-2', sharedEvidence);

    assert.equal(duplicate.exitCode, 1);
    assert.match(duplicate.stderr, /duplicate evidence/i);
  });

  it('rejects a ledger path redirected outside the change directory by a symlink', () => {
    symlinkSync(outsideDir, join(changeDir, '.superpowers'), 'dir');
    const evidencePath = join(changeDir, 'attempt-1.log');
    writeFileSync(evidencePath, 'failed test output\n');

    const result = record('attempt-1', evidencePath);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /physical directory/i);
    assert.equal(existsSync(join(outsideDir, 'sdd', 'debug-attempts.json')), false);
  });

  it('does not count Wave Review repair failures as debugging attempts', () => {
    const repairDirectory = join(changeDir, '.superpowers', 'sdd', 'repair-state');
    mkdirSync(repairDirectory, { recursive: true });
    writeFileSync(join(repairDirectory, 'wave-review.json'), JSON.stringify({ failure_count: 5 }));

    const result = escalate(['--confirm']);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /at least three/i);
  });

  it('rejects escalation when the recorded context is stale', () => {
    for (const id of ['attempt-1', 'attempt-2', 'attempt-3']) {
      assert.equal(record(id).exitCode, 0);
    }
    writeFileSync(join(changeDir, 'proposal.md'), '## Why\nScope changed after debugging attempts were recorded.\n## What Changes\n- Different fix.\n');

    const result = escalate(['--confirm']);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /stale|context/i);
  });

  it('rejects escalation when recorded evidence is missing', () => {
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
    const state = readState(changeDir);
    state.state = 'approved-for-build';
    state.workflow = 'full';
    writeState(changeDir, state);
    const wave = 'wave-1:serial:1.1';
    assert.equal(ssf(['execution', 'recommend', changeDir, '--wave', wave]).exitCode, 0);
    const planned = ssf([
      'execution', 'plan', changeDir,
      '--mode', 'inline',
      '--confirm',
      '--reason', 'Guard debugging against the current plan',
      '--wave', wave,
    ]);
    assert.equal(planned.exitCode, 0, planned.stderr);
    const plannedState = readState(changeDir);
    plannedState.state = 'debugging';
    writeState(changeDir, plannedState);
    assert.equal(record('attempt-1').exitCode, 0);

    writeFileSync(join(changeDir, 'proposal.md'), '## Why\nThe execution plan is now stale.\n## What Changes\n- Changed scope.\n');
    const result = record('attempt-2');

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /execution plan is stale/i);
  });

  it('requires explicit confirmation even after three failed attempts', () => {
    for (const id of ['attempt-1', 'attempt-2', 'attempt-3']) {
      assert.equal(record(id).exitCode, 0);
    }

    const result = escalate();

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /--confirm/i);
  });

  it('persists DP-5 only after three distinct attempts and confirmation', () => {
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
