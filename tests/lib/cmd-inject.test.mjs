// tests/lib/cmd-inject.test.mjs
// Tests for scripts/lib/cmd-inject.mjs
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let generatePhaseGuard, toCursorMdc, toCopilotInstructions;

describe('cmd-inject: generatePhaseGuard()', () => {
  before(async () => {
    const modulePath = join(process.cwd(), 'scripts/lib/cmd-inject.mjs');
    const mod = await import(modulePath);
    generatePhaseGuard = mod.generatePhaseGuard;
    toCursorMdc = mod.toCursorMdc;
    toCopilotInstructions = mod.toCopilotInstructions;
  });

  it('replaces {{change_name}} placeholder', () => {
    const result = generatePhaseGuard({ state: 'exploring', change_name: 'add-csv-export' });
    assert.ok(result.includes('add-csv-export'), `Expected "add-csv-export" in output, got: ${result.substring(0, 100)}`);
  });

  it('replaces {{state}} placeholder', () => {
    const result = generatePhaseGuard({ state: 'executing', change_name: 'test' });
    assert.ok(result.includes('executing'));
  });

  it('replaces {{workflow}} placeholder', () => {
    const result = generatePhaseGuard({ state: 'exploring', workflow: 'hotfix', change_name: 'test' });
    assert.ok(result.includes('hotfix'));
  });

  it('generates exploring phase with allowed operations', () => {
    const result = generatePhaseGuard({ state: 'exploring', change_name: 'test' });
    assert.ok(result.includes('澄清需求'));
    assert.ok(result.includes('禁止操作'));
  });

  it('generates specifying phase with allowed operations', () => {
    const result = generatePhaseGuard({ state: 'specifying', change_name: 'test' });
    assert.ok(result.includes('specs/'));
    assert.ok(result.includes('design.md'));
  });

  it('generates bridging phase with contract operations', () => {
    const result = generatePhaseGuard({ state: 'bridging', change_name: 'test' });
    assert.ok(result.includes('execution-contract.md'));
    assert.ok(result.includes('ssf validate'));
  });

  it('generates approved-for-build phase', () => {
    const result = generatePhaseGuard({ state: 'approved-for-build', change_name: 'test' });
    assert.ok(result.includes('执行模式'));
    assert.ok(result.includes('DP-4'));
    assert.match(result, /execution plan/);
    assert.match(result, /不得开始实现/);
  });

  it('generates executing phase with test prohibition', () => {
    const result = generatePhaseGuard({ state: 'executing', change_name: 'test' });
    assert.ok(result.includes('跳过测试'));
    assert.match(result, /wave review/);
    assert.match(result, /review receipt/);
  });

  it('generates debugging phase with root cause analysis', () => {
    const result = generatePhaseGuard({ state: 'debugging', change_name: 'test' });
    assert.ok(result.includes('根因分析'));
    assert.ok(result.includes('TDD 修复循环'));
  });

  it('generates closing phase with verification', () => {
    const result = generatePhaseGuard({ state: 'closing', change_name: 'test' });
    assert.ok(result.includes('三维验证'));
    assert.ok(result.includes('DP-7'));
  });

  it('generates abandoned terminal state', () => {
    const result = generatePhaseGuard({ state: 'abandoned', change_name: 'test' });
    assert.ok(result.includes('终止状态'));
    assert.ok(result.includes('不得合并'));
  });

  it('falls back to exploring for unknown state', () => {
    const result = generatePhaseGuard({ state: 'unknown-state', change_name: 'test' });
    assert.ok(result.includes('澄清需求'), `Expected exploring fallback, got: ${result.substring(0, 200)}`);
  });

  it('uses defaults when optional fields missing', () => {
    const result = generatePhaseGuard({ state: 'exploring' });
    // change_name defaults to 'unknown'
    assert.ok(result.includes('unknown'));
    // workflow defaults to 'full'
    assert.ok(result.includes('full'));
  });
});

describe('cmd-inject: toCursorMdc()', () => {
  it('wraps base content with Cursor MDC frontmatter', () => {
    const base = '# Phase Guard: test-change\n\n## Allowed\n- Do stuff';
    const result = toCursorMdc(base);

    assert.ok(result.includes('---'), 'Should have frontmatter delimiter');
    assert.ok(result.includes('description: spec-superflow phase guard'));
    assert.ok(result.includes('alwaysApply: true'));
    assert.ok(result.includes('test-change'));
  });
});

describe('cmd-inject: toCopilotInstructions()', () => {
  it('simplifies heading for Copilot format', () => {
    const base = '# Phase Guard: test-change\n\n## Allowed\n- Do stuff';
    const result = toCopilotInstructions(base);

    assert.ok(result.includes('# Phase Guard'));
    assert.ok(result.includes('## Allowed'));
    // Should NOT contain the change name in heading
    assert.ok(!result.includes('# Phase Guard: test-change'));
  });
});

describe('cmd-inject: platform resolution', () => {
  let resolvePlatforms, detectProjectPlatforms;

  before(async () => {
    const modulePath = join(process.cwd(), 'scripts/lib/cmd-inject.mjs');
    const mod = await import(modulePath);
    resolvePlatforms = mod.resolvePlatforms;
    detectProjectPlatforms = mod.detectProjectPlatforms;
  });

  it('resolves explicit all to all supported platforms', () => {
    const result = resolvePlatforms('all', process.cwd());
    assert.deepEqual(result, { ok: true, platforms: ['claude', 'cursor', 'copilot', 'gemini'] });
  });

  it('detects Cursor from .cursor marker', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssf-inject-cursor-'));
    try {
      mkdirSync(join(dir, '.cursor'), { recursive: true });
      assert.deepEqual(detectProjectPlatforms(dir), ['cursor']);
      assert.deepEqual(resolvePlatforms(undefined, dir), { ok: true, platforms: ['cursor'] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects omitted platforms when no marker exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssf-inject-none-'));
    try {
      const result = resolvePlatforms(undefined, dir);
      assert.equal(result.ok, false);
      assert.match(result.message, /--platforms/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects omitted platforms when multiple markers exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssf-inject-multi-'));
    try {
      mkdirSync(join(dir, '.cursor'), { recursive: true });
      mkdirSync(join(dir, '.claude'), { recursive: true });
      const result = resolvePlatforms(undefined, dir);
      assert.equal(result.ok, false);
      assert.match(result.message, /multiple/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cmd-inject: CLI writes', () => {
  const CLI = join(process.cwd(), 'scripts/spec-superflow.mjs');

  function runInject(cwd, changeDir, extraArgs = []) {
    try {
      const stdout = execFileSync(process.execPath, [CLI, 'inject', changeDir, ...extraArgs], { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return { exitCode: 0, stdout, stderr: '' };
    } catch (err) {
      return { exitCode: err.status || 1, stdout: err.stdout?.toString() || '', stderr: err.stderr?.toString() || err.message };
    }
  }

  it('cursor-only injection does not write GEMINI.md', () => {
    const root = mkdtempSync(join(tmpdir(), 'ssf-inject-cli-cursor-'));
    try {
      const change = join(root, 'change');
      mkdirSync(change, { recursive: true });
      writeFileSync(join(change, '.spec-superflow.yaml'), 'state: exploring\nworkflow: full\nchange_name: inject-test\n');
      const result = runInject(root, change, ['--platforms', 'cursor']);
      assert.equal(result.exitCode, 0, result.stdout + result.stderr);
      assert.equal(existsSync(join(root, '.cursor', 'rules', 'phase-guard.mdc')), true);
      assert.equal(existsSync(join(root, 'GEMINI.md')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('omitted ambiguous platform exits before writing files', () => {
    const root = mkdtempSync(join(tmpdir(), 'ssf-inject-cli-none-'));
    try {
      const change = join(root, 'change');
      mkdirSync(change, { recursive: true });
      writeFileSync(join(change, '.spec-superflow.yaml'), 'state: exploring\nworkflow: full\nchange_name: inject-test\n');
      const result = runInject(root, change);
      assert.equal(result.exitCode, 2);
      assert.match(result.stderr || result.stdout, /--platforms/);
      assert.equal(existsSync(join(root, '.cursor')), false);
      assert.equal(existsSync(join(root, 'GEMINI.md')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
