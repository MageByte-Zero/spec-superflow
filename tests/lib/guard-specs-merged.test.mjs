// tests/lib/guard-specs-merged.test.mjs
// Regression for #28: `executing → closing` must be blocked while delta specs
// exist but spec-merger has not run (spec_merged not recorded).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const GUARD = join(ROOT, 'scripts', 'guard', 'guard.mjs');
const CLI = join(ROOT, 'scripts', 'spec-superflow.mjs');

function makeChangeDir(withDelta) {
  const dir = mkdtempSync(join(tmpdir(), 'ssf-specs-merged-'));
  mkdirSync(join(dir, 'specs'), { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), '# Test\n\n## Why\nTest.\n\n## What Changes\n- Test.\n');
  writeFileSync(join(dir, 'design.md'), '# Design\n\n## Context\nTest.\n\n## Goals\nTest.\n\n## Decisions\n\n### Decision 1\n- Choice: Test\n- Rationale: Test\n\n## Risks And Trade-Offs\nNone.\n');
  writeFileSync(join(dir, 'tasks.md'), '# Tasks\n\n- [x] Task 1\n- [x] Task 2\n');
  writeFileSync(join(dir, 'execution-contract.md'), '# Execution Contract\n\n## Intent Lock\nTest.\n');
  const specsContent = withDelta
    ? '## ADDED Requirements\n\n### Requirement: New\n\nThe system SHALL do new.\n\n#### Scenario: New\n- **WHEN** x\n- **THEN** y\n'
    : '## Requirements\n\n### Requirement: Existing\n\nThe system SHALL exist.\n\n#### Scenario: Existing\n- **WHEN** a\n- **THEN** b\n';
  writeFileSync(join(dir, 'specs', 'test.md'), specsContent);
  return dir;
}

function cleanup(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

function runClosingGuard(dir, extraState = '') {
  try {
    rmSync(join(dir, '.superpowers'), { recursive: true, force: true });
    writeFileSync(
      join(dir, '.spec-superflow.yaml'),
      `state: executing\nworkflow: full\nchange_name: test\ndp_6_result: pass: ok\n${extraState}`,
    );
    const report = join(dir, 'close-review.md');
    writeFileSync(report, 'review passed\n');
    execFileSync('node', [CLI, 'execution', 'plan', dir, '--mode', 'sdd',
      '--reason', 'closing guard regression fixture', '--wave', 'close:serial:1.1'], { stdio: 'pipe', timeout: 5000 });
    execFileSync('node', [CLI, 'execution', 'review', dir, '--wave', 'close',
      '--base', 'base', '--head', 'head', '--report', report, '--verdict', 'pass'], { stdio: 'pipe', timeout: 5000 });
    execFileSync('node', [GUARD, 'check', dir, 'executing', 'closing', '--json'], { stdio: 'pipe', timeout: 5000 });
    return { ok: true, out: '' };
  } catch (e) {
    const out = `${e.stdout?.toString() || ''}\n${e.stderr?.toString() || ''}`;
    return { ok: false, out: out || e.message };
  }
}

describe('BUG/#28: spec-merger gate before closing', () => {
  let noDeltaDir, deltaDir;
  before(() => {
    noDeltaDir = makeChangeDir(false);
    deltaDir = makeChangeDir(true);
  });
  after(() => {
    cleanup(noDeltaDir);
    cleanup(deltaDir);
  });

  it('SHALL allow closing when there are no delta specs', () => {
    const r = runClosingGuard(noDeltaDir);
    assert.equal(r.ok, true, `closing should be allowed without delta specs, got: ${r.out}`);
  });

  it('SHALL block closing when delta specs exist but spec-merger has not run', () => {
    const r = runClosingGuard(deltaDir);
    assert.equal(r.ok, false, 'closing must be blocked until delta specs are merged');
    assert.match(r.out, /spec-merger|spec_merged|delta specs/i);
  });

  it('SHALL allow closing when spec_merged is recorded', () => {
    const r = runClosingGuard(deltaDir, 'spec_merged: true\n');
    assert.equal(r.ok, true, `closing should be allowed once spec_merged=true, got: ${r.out}`);
  });
});
