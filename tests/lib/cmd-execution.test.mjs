import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

function writeChangeDirectory(directory, workflow = 'full') {
  writeFileSync(join(directory, 'proposal.md'), '## Why\nEnough context to create a controlled execution plan.\n## What Changes\n- Guard execution.\n');
  writeFileSync(join(directory, 'design.md'), '# Design\n');
  writeFileSync(join(directory, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 First task\n- [ ] 1.2 Second task\n');
  writeFileSync(join(directory, 'execution-contract.md'), '# Execution Contract\n');
  mkdirSync(join(directory, 'specs', 'execution'), { recursive: true });
  writeFileSync(join(directory, 'specs', 'execution', 'spec.md'), '## ADDED Requirements\n### Requirement: Guarded execution\nThe system SHALL guard execution.\n#### Scenario: Create plan\n- **WHEN** a plan is created\n- **THEN** it is persisted.\n');
  writeFileSync(join(directory, '.spec-superflow.yaml'), `state: approved-for-build\nworkflow: ${workflow}\n`);
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

  it('shows the persisted execution plan', () => {
    runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default',
      '--wave', 'wave-1:parallel:1.1,1.2']);

    const result = runSsf(['execution', 'show', changeDir, '--json']);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.plan.mode, 'sdd');
    assert.equal(result.json.valid, true);
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

  it('rejects malformed waves and invalid revision directions', () => {
    const malformed = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'bad wave', '--wave', 'missing-parts']);
    assert.notEqual(malformed.exitCode, 0);
    assert.match(malformed.stderr, /wave/i);

    runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default', '--wave', 'wave-1:serial:1.1']);
    const invalidRevision = runSsf(['execution', 'revise', changeDir, '--mode', 'sdd', '--reason', 'not an upgrade', '--wave', 'wave-1:serial:1.1']);
    assert.notEqual(invalidRevision.exitCode, 0);
    assert.match(invalidRevision.stderr, /inline|upgrade/i);
  });
});
