// tests/lib/guard-tests-passing.test.mjs
// Regression for BUG-A: the `executing → closing` transition was unreachable
// because `test_result` was never written, yet the tests-passing guard required it.
// Now the guard also accepts `dp_6_result` starting with "pass".

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

function makeChangeDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ssf-tests-passing-'));
  mkdirSync(join(dir, 'specs'), { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), '# Test\n\n## Why\nTest.\n\n## What Changes\n- Test.\n');
  writeFileSync(join(dir, 'design.md'), '# Design\n\n## Context\nTest.\n\n## Goals\nTest.\n\n## Decisions\n\n### Decision 1\n- Choice: Test\n- Rationale: Test\n\n## Risks And Trade-Offs\nNone.\n');
  writeFileSync(join(dir, 'tasks.md'), '# Tasks\n\n- [x] Task 1\n- [x] Task 2\n');
  writeFileSync(join(dir, 'specs', 'test.md'), '## ADDED Requirements\n\n### Requirement: Test\n\nThe system SHALL test.\n\n#### Scenario: Test\n- **WHEN** test\n- **THEN** test\n');
  writeFileSync(join(dir, 'execution-contract.md'), '# Execution Contract\n\n## Intent Lock\nTest.\n');
  return dir;
}

function cleanup(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

// Writes a state file in `executing` and runs the guard for executing -> closing.
// The guard emits the structured result to stdout (--json mode), so capture both
// stdout and stderr for assertions.
function runClosingGuard(dir, extraState = '') {
  try {
    // `spec_merged: true` is in the base state so the #28 specs-merged gate
    // passes — these tests isolate the tests-passing dimension only.
    // (The specs-merged dimension is covered separately in
    //  tests/lib/guard-specs-merged.test.mjs.)
    writeFileSync(
      join(dir, '.spec-superflow.yaml'),
      `state: executing\nworkflow: full\nchange_name: test\nspec_merged: true\n${extraState}`,
    );
    rmSync(join(dir, '.superpowers'), { recursive: true, force: true });
    const report = join(dir, 'close-review.md');
    writeFileSync(report, 'review passed\n');
    execFileSync('node', [CLI, 'execution', 'plan', dir, '--mode', 'sdd',
      '--reason', 'closing guard regression fixture', '--wave', 'close:serial:1.1'], { stdio: 'pipe', timeout: 5000 });
    execFileSync('node', [CLI, 'execution', 'review', dir, '--wave', 'close',
      '--base', 'base', '--head', 'head', '--report', report, '--verdict', 'pass'], { stdio: 'pipe', timeout: 5000 });
    execFileSync('node', [GUARD, 'check', dir, 'executing', 'closing', '--json'], { stdio: 'pipe', timeout: 5000 });
    return { ok: true, stderr: '' };
  } catch (e) {
    const out = `${e.stdout?.toString() || ''}\n${e.stderr?.toString() || ''}`;
    return { ok: false, stderr: out || e.message };
  }
}

describe('BUG-A: executing -> closing reachable once verification recorded', () => {
  let dir;
  before(() => { dir = makeChangeDir(); });
  after(() => { cleanup(dir); });

  it('SHALL fail when no verification outcome recorded', () => {
    const r = runClosingGuard(dir);
    assert.equal(r.ok, false, 'closing must be blocked without a verification result');
    assert.match(r.stderr, /verification outcome missing/i);
  });

  it('SHALL pass when dp_6_result starts with "pass" (the release-archivist signal)', () => {
    const r = runClosingGuard(dir, 'dp_6_result: pass: all green\n');
    assert.equal(r.ok, true, `closing should be allowed via dp_6_result, got: ${r.stderr || ''}`);
  });

  it('SHALL pass when test_result is explicitly "pass"', () => {
    const r = runClosingGuard(dir, 'test_result: pass\n');
    assert.equal(r.ok, true, `closing should be allowed via test_result, got: ${r.stderr || ''}`);
  });

  it('SHALL fail when dp_6_result is "fail" (not a pass signal)', () => {
    const r = runClosingGuard(dir, 'dp_6_result: fail: broken\n');
    assert.equal(r.ok, false, 'closing must be blocked when verification failed');
  });
});
