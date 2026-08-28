// tests/lib/guard-transitions.test.mjs
// Regression tests for state machine transition guard matrix
// Covers specs/guard-transitions/spec.md requirements

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const GUARD = join(ROOT, 'scripts', 'guard', 'guard.mjs');

// All legal transitions (from docs/state-machine.md)
const ALL_TRANSITIONS = [
  // Mainline
  { from: 'exploring', to: 'specifying' },
  { from: 'specifying', to: 'bridging' },
  { from: 'bridging', to: 'approved-for-build' },
  { from: 'approved-for-build', to: 'executing' },
  { from: 'executing', to: 'closing' },
  // Fast-path
  { from: 'exploring', to: 'bridging', workflow: 'hotfix' },
  { from: 'exploring', to: 'approved-for-build', workflow: 'tweak' },
  // Rewind
  { from: 'executing', to: 'specifying' },
  { from: 'executing', to: 'bridging' },
  { from: 'approved-for-build', to: 'specifying' },
  { from: 'approved-for-build', to: 'bridging' },
  { from: 'specifying', to: 'exploring' },
  { from: 'bridging', to: 'specifying' },
  // Debugging round-trip
  { from: 'executing', to: 'debugging' },
  { from: 'debugging', to: 'executing' },
  // Abandon
  { from: 'exploring', to: 'abandoned' },
  { from: 'specifying', to: 'abandoned' },
  { from: 'bridging', to: 'abandoned' },
  { from: 'approved-for-build', to: 'abandoned' },
  { from: 'executing', to: 'abandoned' },
  { from: 'debugging', to: 'abandoned' },
];

// Illegal transitions (should be rejected)
const ILLEGAL_TRANSITIONS = [
  { from: 'exploring', to: 'closing' },
  { from: 'exploring', to: 'executing' },
  { from: 'specifying', to: 'executing' },
  { from: 'specifying', to: 'closing' },
  { from: 'bridging', to: 'closing' },
  { from: 'closing', to: 'abandoned' },
  { from: 'abandoned', to: 'exploring' },
  { from: 'abandoned', to: 'specifying' },
];

function makeChangeDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ssf-guard-test-'));
  mkdirSync(join(dir, 'specs', 'test'), { recursive: true });
  return dir;
}

function cleanup(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

function runGuard(from, to, dir, workflow = 'full') {
  try {
    // Write a minimal .spec-superflow.yaml so guard can read state
    const stateFile = join(dir, '.spec-superflow.yaml');
    writeFileSync(stateFile, `state: ${from}\nworkflow: ${workflow}\nchange_name: test\n`);

    // Also need a minimal proposal.md for artifacts-exist check
    writeFileSync(join(dir, 'proposal.md'), '# Test\n\n## Why\n\nTest change for guard matrix audit.\n\n## What Changes\n\n- Test.\n');
    writeFileSync(join(dir, 'design.md'), '# Design\n\n## Context\n\nTest.\n\n## Goals\n\nTest.\n\n## Decisions\n\n### Decision 1\n- Choice: Test\n- Rationale: Test\n\n## Risks And Trade-Offs\n\nNone.\n');
    writeFileSync(join(dir, 'tasks.md'), '# Tasks\n\n- [x] Task 1\n- [x] Task 2\n');
    writeFileSync(join(dir, 'specs', 'test', 'spec.md'), '## ADDED Requirements\n\n### Requirement: Test\n\nThe system SHALL test.\n\n#### Scenario: Test\n- **WHEN** test\n- **THEN** test\n');
    writeFileSync(join(dir, 'execution-contract.md'), '# Execution Contract\n\n## Intent Lock\n\nTest.\n');

    const args = [GUARD, 'check', dir, from, to, '--json'];
    if (workflow !== 'full') {
      args.push('--workflow', workflow);
    }

    const stdout = execFileSync(process.execPath, args, { encoding: 'utf8', timeout: 5000 });
    return { ok: true, status: 0, stdout, stderr: '', signal: null, timedOut: false, spawnError: null };
  } catch (e) {
    const errorCode = typeof e.code === 'string' ? e.code : null;
    const timedOut = errorCode === 'ETIMEDOUT' || (e.killed === true && e.status === null);
    return {
      ok: false,
      status: e.status ?? null,
      stdout: e.stdout?.toString() || '',
      stderr: e.stderr?.toString() || '',
      signal: e.signal ?? null,
      timedOut,
      spawnError: timedOut ? null : errorCode,
    };
  }
}

function guardOutput(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

// ─── D1: Guard 检查矩阵完整性 ───
// Requirement: Guard 检查矩阵完整性
// Scenario: 主线 transition 全覆盖

describe('Guard transition matrix completeness', () => {
  let dir;
  before(() => { dir = makeChangeDir(); });
  after(() => { cleanup(dir); });

  for (const t of ALL_TRANSITIONS) {
    const label = `${t.from} → ${t.to}${t.workflow ? ' (' + t.workflow + ')' : ''}`;
    it(`SHALL define checks for ${label}`, () => {
      const result = runGuard(t.from, t.to, dir, t.workflow || 'full');
      // The transition should be handled (either pass or fail with specific reason, but not "unknown transition")
      if (!result.ok) {
        const output = guardOutput(result);
        assert.ok(
          !output.includes('unknown transition') && !output.includes('Unknown transition'),
          `Transition ${label} is not defined in guard matrix: ${output}`
        );
      }
    });
  }
});

// Requirement: Guard 检查矩阵完整性
// Scenario: 非法 transition 被拦截
describe('Illegal transition rejection', () => {
  let dir;
  before(() => { dir = makeChangeDir(); });
  after(() => { cleanup(dir); });

  for (const t of ILLEGAL_TRANSITIONS) {
    it(`SHALL reject illegal transition ${t.from} → ${t.to}`, () => {
      const result = runGuard(t.from, t.to, dir);
      assert.equal(result.ok, false, `Illegal transition ${t.from} → ${t.to} should be rejected`);
    });
  }
});

// Requirement: Guard 脚本错误处理
// Scenario: guard 脚本异常时报告给用户
describe('Guard error handling', () => {
  it('SHALL return non-zero exit when called without arguments', () => {
    try {
      execSync(`node ${GUARD} check`, { stdio: 'pipe', timeout: 5000 });
      assert.fail('Should have thrown');
    } catch (e) {
      assert.ok(e.status !== 0, 'Guard should exit non-zero for missing arguments');
    }
  });

  it('SHALL output error for nonexistent change directory', () => {
    try {
      execSync(`node ${GUARD} check /nonexistent/path exploring specifying`, { stdio: 'pipe', timeout: 5000 });
      assert.fail('Should have thrown');
    } catch (e) {
      assert.ok(e.status !== 0, 'Guard should exit non-zero for nonexistent directory');
    }
  });
});

// ─── D1: Debugging 状态往返 ───
// Requirement: Debugging 状态往返无副作用
// Scenario: debugging 返回 executing 后进度保留
describe('Debugging round-trip', () => {
  let dir;
  before(() => { dir = makeChangeDir(); });
  after(() => { cleanup(dir); });

  it('SHALL allow executing → debugging transition', () => {
    const result = runGuard('executing', 'debugging', dir);
    // The transition may fail due to missing execution artifacts, but should NOT be "unknown transition"
    if (!result.ok) {
      const output = guardOutput(result);
      assert.ok(!output.includes('unknown'), `Should not reject with unknown: ${output}`);
    }
  });

  it('SHALL allow debugging → executing transition', () => {
    const result = runGuard('debugging', 'executing', dir);
    if (!result.ok) {
      const output = guardOutput(result);
      assert.ok(!output.includes('unknown'), `Should not reject with unknown: ${output}`);
    }
  });
});

// ─── D1: Terminal state protection ───
// Requirement: 废弃状态转换禁止
// Scenario: abandoned 后拒绝所有 transition
describe('Terminal state protection — abandoned', () => {
  let dir;
  before(() => { dir = makeChangeDir(); });
  after(() => { cleanup(dir); });

  const allTargets = ['exploring', 'specifying', 'bridging', 'approved-for-build', 'executing', 'debugging', 'closing'];

  for (const target of allTargets) {
    it(`SHALL reject abandoned → ${target}`, () => {
      const result = runGuard('abandoned', target, dir);
      assert.equal(result.ok, false, `Abandoned → ${target} must be rejected (terminal state)`);
    });
  }
});

// Scenario: closing 后拒绝所有 transition
describe('Terminal state protection — closing', () => {
  let dir;
  before(() => { dir = makeChangeDir(); });
  after(() => { cleanup(dir); });

  const allTargets = ['exploring', 'specifying', 'bridging', 'approved-for-build', 'executing', 'debugging', 'abandoned'];

  for (const target of allTargets) {
    it(`SHALL reject closing → ${target}`, () => {
      const result = runGuard('closing', target, dir);
      const expectedError = `Unknown transition: closing -> ${target}`;

      assert.equal(result.timedOut, false, `Closing → ${target} must not time out`);
      assert.equal(result.spawnError, null, `Closing → ${target} must not fail to spawn the guard`);
      assert.equal(result.signal, null, `Closing → ${target} must not terminate by signal`);
      assert.equal(result.status, 1, `Closing → ${target} must exit with the guard rejection status`);
      assert.equal(result.stderr, '', `Closing → ${target} must report its rejection as JSON stdout`);

      let response;
      assert.doesNotThrow(() => { response = JSON.parse(result.stdout); },
        `Closing → ${target} must return parseable JSON: ${result.stdout}`);
      assert.equal(response.pass, false, `Closing → ${target} response must fail`);
      assert.deepEqual(response.checks, [], `Closing → ${target} must not run transition checks`);
      assert.match(response.error, new RegExp(`^${expectedError.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`),
        `Closing → ${target} must report the authoritative unknown-transition error`);
    });
  }
});

// ─── D1: Fast-path validation ───
// Requirement: Guard 检查矩阵完整性
// Scenario: fast-path 有降级保护
describe('Fast-path validation', () => {
  let dir;
  before(() => { dir = makeChangeDir(); });
  after(() => { cleanup(dir); });

  it('SHALL support hotfix fast-path (exploring → bridging)', () => {
    const result = runGuard('exploring', 'bridging', dir, 'hotfix');
    // May fail on schema-valid or other checks, but should NOT be "unknown transition"
    if (!result.ok) {
      const output = guardOutput(result);
      assert.ok(!output.includes('unknown'), `Hotfix fast-path should be defined: ${output}`);
    }
  });

  it('SHALL support tweak fast-path (exploring → approved-for-build)', () => {
    const result = runGuard('exploring', 'approved-for-build', dir, 'tweak');
    if (!result.ok) {
      const output = guardOutput(result);
      assert.ok(!output.includes('unknown'), `Tweak fast-path should be defined: ${output}`);
    }
  });

  it('SHALL reject hotfix fast-path when workflow is full', () => {
    const result = runGuard('exploring', 'bridging', dir, 'full');
    const output = guardOutput(result);
    assert.equal(result.ok, false, 'exploring -> bridging must be rejected in full workflow');
    assert.match(output, /workflow-mode|fast-path|hotfix|tweak/i);
  });

  it('SHALL reject tweak route to bridging', () => {
    const result = runGuard('exploring', 'bridging', dir, 'tweak');
    const output = guardOutput(result);
    assert.equal(result.ok, false, 'tweak should use exploring -> approved-for-build, not bridging');
    // workflow-aware 化后 tweak 下 exploring:bridging 不再回退 full 主表，
    // 以 workflow-transition-unknown 明确拒绝（比原先的 workflow-mode gate 更精确）。
    assert.match(output, /workflow-mode|hotfix|workflow-transition-unknown/i);
  });

  it('SHALL reject tweak fast-path when workflow is full', () => {
    const result = runGuard('exploring', 'approved-for-build', dir, 'full');
    const output = guardOutput(result);
    assert.equal(result.ok, false, 'exploring -> approved-for-build must be rejected in full workflow');
    assert.match(output, /workflow-mode|fast-path|tweak/i);
  });
});
