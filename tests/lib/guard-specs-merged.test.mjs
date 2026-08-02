// Closing must be based on a verifiable publication receipt, not spec_merged.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dispatchCli } from '../../scripts/spec-superflow.mjs';
import { runGuard } from '../../scripts/guard/guard.mjs';

function makeChangeFixture(withDelta) {
  const repo = mkdtempSync(join(tmpdir(), 'ssf-specs-merged-'));
  const dir = join(repo, 'changes', 'test');
  mkdirSync(join(dir, 'specs', 'test'), { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), '# Test\n\n## Why\nTest.\n\n## What Changes\n- Test.\n');
  writeFileSync(join(dir, 'design.md'), '# Design\n\n## Context\nTest.\n\n## Goals\nTest.\n\n## Decisions\n\n### Decision 1\n- Choice: Test\n- Rationale: Test\n\n## Risks And Trade-Offs\nNone.\n');
  writeFileSync(join(dir, 'tasks.md'), '# Tasks\n\n- [x] Task 1\n- [x] Task 2\n');
  writeFileSync(join(dir, 'execution-contract.md'), '# Execution Contract\n\n## Intent Lock\nTest.\n');
  const specsContent = withDelta
    ? '## ADDED Requirements\n\n### Requirement: New\n\nThe system SHALL do new.\n\n#### Scenario: New\n- **WHEN** x\n- **THEN** y\n'
    : '## Requirements\n\n### Requirement: Existing\n\nThe system SHALL exist.\n\n#### Scenario: Existing\n- **WHEN** a\n- **THEN** b\n';
  writeFileSync(join(dir, 'specs', 'test', 'spec.md'), specsContent);
  initializeGitRepository(repo);
  return { repo, dir };
}

function runGit(directory, args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
}

function initializeGitRepository(directory) {
  runGit(directory, ['init', '--quiet']);
  runGit(directory, ['config', 'user.email', 'tests@example.invalid']);
  runGit(directory, ['config', 'user.name', 'Guard Specs Merged Test']);
  runGit(directory, ['add', '--all']);
  runGit(directory, ['commit', '--quiet', '--message', 'initial closing guard change']);
  writeFileSync(join(directory, 'git-range-marker.txt'), 'second commit\n');
  runGit(directory, ['add', 'git-range-marker.txt']);
  runGit(directory, ['commit', '--quiet', '--message', 'second closing guard change']);
}

function cleanup(fixture) {
  if (fixture && existsSync(fixture.repo)) rmSync(fixture.repo, { recursive: true, force: true });
}

async function runCli(args) {
  const output = { stdout: '', stderr: '' };
  const io = {
    stdout: { write: text => { output.stdout += text; } },
    stderr: { write: text => { output.stderr += text; } },
  };
  const result = await dispatchCli(args, io);
  return { ...result, output };
}

async function runGuardWithCapturedOutput(args) {
  const output = { stdout: '', stderr: '' };
  const io = {
    stdout: { write: text => { output.stdout += text; } },
    stderr: { write: text => { output.stderr += text; } },
  };
  const result = await runGuard(args, io);
  return { ...result, output };
}

async function runClosingGuard(fixture, { extraState = '', synchronize = false, mutateSource = false, mutateBaseline = false } = {}) {
  const { repo, dir } = fixture;
  try {
    rmSync(join(dir, '.superpowers'), { recursive: true, force: true });
    writeFileSync(
      join(dir, '.spec-superflow.yaml'),
      `state: executing\nworkflow: full\nchange_name: test\ndp_6_result: pass: ok\n${extraState}`,
    );
    if (synchronize) {
      const sync = await runCli(['sync', dir]);
      if (sync.exitCode !== 0) throw new Error(`${sync.output.stdout}\n${sync.output.stderr}`);
    }
    if (mutateSource) appendFileSync(join(dir, 'specs', 'test', 'spec.md'), '\n<!-- changed after publication -->\n');
    if (mutateBaseline) appendFileSync(join(repo, 'specs', 'test', 'spec.md'), '\n<!-- changed after publication -->\n');
    const recommendation = await runCli(['execution', 'recommend', dir,
      '--wave', 'close:serial:1.1']);
    if (recommendation.exitCode !== 0) throw new Error(`${recommendation.output.stdout}\n${recommendation.output.stderr}`);
    const plan = await runCli(['execution', 'plan', dir, '--mode', 'sdd',
      '--confirm', '--acknowledge-recommendation', '--reason', 'closing guard regression fixture',
      '--wave', 'close:serial:1.1']);
    if (plan.exitCode !== 0) throw new Error(`${plan.output.stdout}\n${plan.output.stderr}`);
    const report = join(dir, '.superpowers', 'sdd', 'reviews', 'close-review.md');
    mkdirSync(join(dir, '.superpowers', 'sdd', 'reviews'), { recursive: true });
    writeFileSync(report, 'review passed\n');
    const base = runGit(repo, ['rev-parse', 'HEAD~1']);
    const head = runGit(repo, ['rev-parse', 'HEAD']);
    const review = await runCli(['execution', 'review', dir, '--wave', 'close',
      '--base', base, '--head', head, '--report', report, '--verdict', 'pass']);
    if (review.exitCode !== 0) throw new Error(`${review.output.stdout}\n${review.output.stderr}`);
    const guard = await runGuardWithCapturedOutput(['check', dir, 'executing', 'closing', '--json']);
    if (guard.exitCode !== 0) throw new Error(`${guard.output.stdout}\n${guard.output.stderr}`);
    return { ok: true, out: '' };
  } catch (e) {
    const out = `${e.stdout?.toString() || ''}\n${e.stderr?.toString() || ''}`;
    return { ok: false, out: out.trim() || e.message };
  }
}

describe('BUG/#28: publication receipt gate before closing', () => {
  let noDelta, delta, legacyBoolean, published, staleSource, staleBaseline;
  before(() => {
    noDelta = makeChangeFixture(false);
    delta = makeChangeFixture(true);
    legacyBoolean = makeChangeFixture(true);
    published = makeChangeFixture(true);
    staleSource = makeChangeFixture(true);
    staleBaseline = makeChangeFixture(true);
  });
  after(() => {
    [noDelta, delta, legacyBoolean, published, staleSource, staleBaseline].forEach(cleanup);
  });

  it('routes publication through the in-process dispatcher while preserving its visible result', async () => {
    const output = { stdout: '', stderr: '' };
    const io = {
      stdout: { write: text => { output.stdout += text; } },
      stderr: { write: text => { output.stderr += text; } },
    };

    const result = await dispatchCli(['sync', published.dir], io);

    assert.equal(result.exitCode, 0, output.stderr);
    assert.match(output.stdout, /Published 1 canonical spec/i);
  });

  it('SHALL allow closing when there are no delta specs', async () => {
    const r = await runClosingGuard(noDelta);
    assert.equal(r.ok, true, `closing should be allowed without delta specs, got: ${r.out}`);
  });

  it('SHALL block closing when delta specs exist but no publication receipt exists', async () => {
    const r = await runClosingGuard(delta);
    assert.equal(r.ok, false, 'closing must be blocked until a receipt is recorded');
    assert.match(r.out, /publication receipt|sync|delta specs/i);
  });

  it('SHALL block a legacy spec_merged boolean without a publication receipt', async () => {
    const r = await runClosingGuard(legacyBoolean, { extraState: 'spec_merged: true\n' });
    assert.equal(r.ok, false, 'spec_merged=true alone must not prove publication');
    assert.match(r.out, /publication receipt|spec_merged/i);
  });

  it('SHALL allow closing with a current publication receipt', async () => {
    const r = await runClosingGuard(published, { synchronize: true });
    assert.equal(r.ok, true, `closing should be allowed after unchanged publication, got: ${r.out}`);
  });

  it('SHALL block closing when the source delta changes after publication', async () => {
    const r = await runClosingGuard(staleSource, { synchronize: true, mutateSource: true });
    assert.equal(r.ok, false, 'a changed delta must invalidate its publication receipt');
    assert.match(r.out, /delta has changed|publication receipt/i);
  });

  it('SHALL block closing when the published baseline changes after publication', async () => {
    const r = await runClosingGuard(staleBaseline, { synchronize: true, mutateBaseline: true });
    assert.equal(r.ok, false, 'a changed baseline must invalidate its publication receipt');
    assert.match(r.out, /baseline has changed|publication receipt/i);
  });
});
