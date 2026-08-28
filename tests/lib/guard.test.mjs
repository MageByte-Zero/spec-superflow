// tests/lib/guard.test.mjs
// Tests for scripts/guard/guard.mjs — transition matrix and workflow behavior
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { acceptWorkflowRecommendation, saveWorkflowRecommendation } from '../../scripts/lib/workflow-recommendation.mjs';
import { getPlanScopedPaths } from '../../scripts/lib/sdd-overlay.mjs';
import { runGuard as runGuardInProcess, getTransitionCheckTables } from '../../scripts/guard/guard.mjs';
import { run as runExecution } from '../../scripts/lib/cmd-execution.mjs';
import { readState, writeState, rebuildState } from '../../scripts/lib/state-loader.mjs';
import { computeArtifactsHash, computeContractHash } from '../../scripts/lib/hash.mjs';
import { createGitSeedFixture } from '../helpers/git-seed-fixture.mjs';
import { canCreateSymlink } from '../helpers/symlink-support.mjs';

let tempDir;
let gitRefs;
const GUARD_PATH = join(process.cwd(), 'scripts/guard/guard.mjs');
const CLI_PATH = join(process.cwd(), 'scripts/spec-superflow.mjs');

function runNodeScript(scriptPath, args) {
  const output = { stdout: '', stderr: '' };
  const io = {
    stdout: { write: text => { output.stdout += text; } },
    stderr: { write: text => { output.stderr += text; } },
  };
  let result;
  try {
    if (scriptPath === GUARD_PATH) result = runGuardInProcess(args, io);
    else if (scriptPath === CLI_PATH && args[0] === 'execution') result = runExecution(args.slice(1), io);
    else if (scriptPath === CLI_PATH && args[0] === 'state') result = runStateInProcess(args.slice(1), io);
    else throw new Error(`No in-process boundary for ${scriptPath}`);
  } catch (error) {
    output.stderr += `${error.message}\n`;
    result = { exitCode: 1 };
  }
  if (result.exitCode === 0) return output.stdout;
  const error = new Error(output.stderr || `command exited ${result.exitCode}`);
  error.status = result.exitCode;
  error.stdout = output.stdout;
  error.stderr = output.stderr;
  throw error;
}

function runStateInProcess(args, io) {
  const [subcommand, directory, field, value] = args;
  const useJson = args.includes('--json');
  if (subcommand === 'init') {
    mkdirSync(directory, { recursive: true });
    const state = rebuildState(directory, { computeArtifactsHash, computeContractHash });
    io.stdout.write(useJson
      ? `${JSON.stringify({ ok: true, artifacts_hash: state.artifacts_hash, contract_hash: state.contract_hash })}\n`
      : 'State initialized.\n');
    return { exitCode: 0 };
  }
  if (subcommand === 'set') {
    const state = readState(directory);
    state[field] = value;
    writeState(directory, state);
    io.stdout.write(useJson ? `${JSON.stringify({ ok: true, field, value })}\n` : `Set ${field}.\n`);
    return { exitCode: 0 };
  }
  throw new Error(`unsupported in-process state subcommand: ${subcommand}`);
}

function runGit(directory, args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
}

function initializeGitRepository(directory) {
  runGit(directory, ['init', '--quiet']);
  runGit(directory, ['config', 'user.email', 'tests@example.invalid']);
  runGit(directory, ['config', 'user.name', 'Guard Control Records Test']);
  runGit(directory, ['add', '--all']);
  runGit(directory, ['commit', '--quiet', '--message', 'initial guard control records change']);
  const base = runGit(directory, ['rev-parse', 'HEAD']);
  writeFileSync(join(directory, 'git-range-marker.txt'), 'second commit\n');
  runGit(directory, ['add', 'git-range-marker.txt']);
  runGit(directory, ['commit', '--quiet', '--message', 'second guard control records change']);
  // R4: review head 须被至少一个非 protected 分支包含。seed 默认分支为 master
  // （protected），建立一个指向 head 的隔离分支使分支校验放行。
  runGit(directory, ['branch', 'test-isolation']);
  return { base, head: runGit(directory, ['rev-parse', 'HEAD']) };
}

describe('guard: transition matrix', () => {
  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-guard-test-'));
    // Create minimal artifacts so artifact checks can pass
    writeFileSync(join(tempDir, 'proposal.md'), '## Why\nThis is a test proposal for guard testing purposes. The system needs to support feature X which will enable users to accomplish their goals more efficiently.\n## What Changes\n- Add feature X');
    mkdirSync(join(tempDir, 'specs', 'test'), { recursive: true });
    writeFileSync(join(tempDir, 'specs', 'test', 'spec.md'), '## ADDED Requirements\n### Requirement: Feature X\nThe system SHALL do X.\n#### Scenario: basic\n- **WHEN** user triggers\n- **THEN** system responds');
    writeFileSync(join(tempDir, 'design.md'), '## Context\nTest design\n## Decisions\n### Decision 1\n- Choice: A\n- Rationale: B');
    writeFileSync(join(tempDir, 'tasks.md'), '## File Structure\n- Create: src/x.ts\n## Tasks\n### 1.1 Task\n- [x] done');
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function runGuard(fromState, toState, opts = '') {
    try {
      const extraArgs = opts ? opts.split(/\s+/).filter(Boolean) : [];
      const result = runNodeScript(GUARD_PATH, ['check', tempDir, fromState, toState, '--json', ...extraArgs]);
      return { exitCode: 0, output: JSON.parse(result.trim()) };
    } catch (err) {
      if (err.stdout) {
        try { return { exitCode: err.status, output: JSON.parse(err.stdout.trim()) }; }
        catch { return { exitCode: err.status, output: err.stderr || err.message }; }
      }
      return { exitCode: err.status || 1, output: err.stderr || err.message };
    }
  }

  it('exploring→specifying permits a confirmed intake before planning artifacts exist', () => {
    const result = runGuard('exploring', 'specifying');
    assert.equal(result.exitCode, 0, `Expected exit 0 but got ${result.exitCode}: ${JSON.stringify(result.output)}`);
    assert.deepEqual(result.output.checks, []);
  });

  it('specifying→bridging requires artifacts-exist + schema-valid', () => {
    const result = runGuard('specifying', 'bridging');
    assert.equal(result.exitCode, 0, `Expected exit 0 but got ${result.exitCode}: ${JSON.stringify(result.output)}`);
    const dims = result.output.checks.map(c => c.dimension);
    assert.ok(dims.includes('artifacts-exist'));
    assert.ok(dims.includes('schema-valid'));
  });

  it('bridging→approved-for-build requires artifacts-exist + schema-valid + contract-fresh', () => {
    const result = runGuard('bridging', 'approved-for-build');
    // contract-fresh may fail since no contract exists, but the check should run
    const dims = result.output.checks.map(c => c.dimension);
    assert.ok(dims.includes('artifacts-exist'));
    assert.ok(dims.includes('schema-valid'));
    assert.ok(dims.includes('contract-fresh'));
  });

  it('approved-for-build→executing requires artifacts-exist + contract-fresh', () => {
    const result = runGuard('approved-for-build', 'executing');
    const dims = result.output.checks.map(c => c.dimension);
    assert.ok(dims.includes('artifacts-exist'));
    assert.ok(dims.includes('contract-fresh'));
  });

  it('executing→closing requires tasks-complete + tests-passing', () => {
    const result = runGuard('executing', 'closing');
    const dims = result.output.checks.map(c => c.dimension);
    assert.ok(dims.includes('tasks-complete'));
    assert.ok(dims.includes('tests-passing'));
  });

  it('executing→debugging requires no checks', () => {
    const result = runGuard('executing', 'debugging');
    assert.equal(result.exitCode, 0);
    assert.deepStrictEqual(result.output.checks, []);
  });

  it('exploring→approved-for-build fails in default full workflow', () => {
    const result = runGuard('exploring', 'approved-for-build');
    assert.equal(result.exitCode, 1, `Expected exit 1 but got ${result.exitCode}: ${JSON.stringify(result.output)}`);
    const dims = result.output.checks.map(c => c.dimension);
    assert.ok(dims.includes('workflow-mode'));
  });

  it('exploring→approved-for-build passes in tweak workflow', () => {
    const result = runGuard('exploring', 'approved-for-build', '--workflow tweak');
    assert.equal(result.exitCode, 0, `Expected exit 0 but got ${result.exitCode}: ${JSON.stringify(result.output)}`);
    assert.deepEqual(result.output.checks, []);
  });

  it('unknown transition returns error', () => {
    const result = runGuard('closing', 'exploring');
    assert.equal(result.exitCode, 1);
  });
});

describe('guard: workflow mode behavior', () => {
  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-guard-mode-'));
    writeFileSync(join(tempDir, 'proposal.md'), '## Why\nTest for mode skipping\n## What Changes\n- Add Y');
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function runGuardWithMode(fromState, toState, workflow) {
    try {
      const result = runNodeScript(GUARD_PATH, ['check', tempDir, fromState, toState, '--json', '--workflow', workflow]);
      return { exitCode: 0, output: JSON.parse(result.trim()) };
    } catch (err) {
      if (err.stdout) {
        try { return { exitCode: err.status, output: JSON.parse(err.stdout.trim()) }; }
        catch { return { exitCode: err.status, output: err.stderr || err.message }; }
      }
      return { exitCode: err.status || 1, output: err.stderr || err.message };
    }
  }

  it('tweak mode allows exploring to approved-for-build without artifacts', () => {
    const result = runGuardWithMode('exploring', 'approved-for-build', 'tweak');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks, []);
  });

  it('hotfix mode allows exploring to bridging without artifacts', () => {
    const result = runGuardWithMode('exploring', 'bridging', 'hotfix');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks, []);
  });

  it('full mode keeps requiring artifacts on specifying to bridging', () => {
    const result = runGuardWithMode('specifying', 'bridging', 'full');
    const checks = result.output.checks;
    assert.ok(checks.some(c => c.dimension === 'artifacts-exist'));
    assert.ok(checks.some(c => c.dimension === 'schema-valid'));
  });

  it('invalid workflow mode exits with error', () => {
    const result = runGuardWithMode('exploring', 'specifying', 'invalid-mode');
    assert.equal(result.exitCode, 2);
  });
});

describe('guard: direct short paths', () => {
  let dir;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ssf-direct-short-path-'));
  });

  after(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function createDirectReceipt(workflow) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.spec-superflow.yaml'), `state: exploring\nworkflow: ${workflow}\n`);
    saveWorkflowRecommendation(dir, {
      task_count: workflow === 'hotfix' ? 2 : 3,
      file_count: workflow === 'hotfix' ? 2 : 3,
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
      request_kind: workflow === 'hotfix' ? 'incident' : 'standard',
    });
    acceptWorkflowRecommendation(dir, { source: 'direct-request', verificationStrategy: 'bounded' });
  }

  function run(fromState, toState, workflow) {
    try {
      const stdout = runNodeScript(GUARD_PATH, ['check', dir, fromState, toState, '--json', '--workflow', workflow]);
      return { exitCode: 0, output: JSON.parse(stdout.trim()) };
    } catch (error) {
      return { exitCode: error.status ?? 1, output: JSON.parse(error.stdout.toString().trim()) };
    }
  }

  it('allows a direct quick path without planning artifacts or an execution plan', () => {
    createDirectReceipt('quick');
    let result = run('exploring', 'approved-for-build', 'quick');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks.map(check => check.dimension), ['direct-short-path']);

    result = run('approved-for-build', 'executing', 'quick');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks.map(check => check.dimension), ['direct-short-path']);

    writeFileSync(join(dir, '.spec-superflow.yaml'), 'state: executing\nworkflow: quick\ntest_result: pass: focused test\n');
    result = run('executing', 'closing', 'quick');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks.map(check => check.dimension), ['direct-short-path', 'direct-test-result']);

    writeFileSync(join(dir, '.spec-superflow.yaml'), 'state: executing\nworkflow: quick\ndp_6_result: pass: insufficient for direct closing\n');
    result = run('executing', 'closing', 'quick');
    assert.equal(result.exitCode, 1);
    assert.equal(result.output.checks.find(check => check.dimension === 'direct-test-result').pass, false);
  });

  it('allows only an incident-backed direct hotfix and keeps legacy hotfix guarded', () => {
    createDirectReceipt('hotfix');
    const direct = run('exploring', 'approved-for-build', 'hotfix');
    assert.equal(direct.exitCode, 0, JSON.stringify(direct.output));
    assert.deepEqual(direct.output.checks.map(check => check.dimension), ['direct-short-path']);

    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: hotfix\n');
    const legacy = run('exploring', 'approved-for-build', 'hotfix');
    assert.equal(legacy.exitCode, 1);
    assert.match(legacy.output.checks[0].failures.join(' '), /direct receipt/i);
  });
});

describe('guard: hotfix minimal contract', () => {
  let dir;

  // P1（review-findings-fix R2）：解析 guard 的转换检查表
  function runGuardTable(workflow) {
    return getTransitionCheckTables()[workflow];
  }

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ssf-hotfix-guard-'));
    writeFileSync(join(dir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: hotfix\nchange_name: hotfix-test\n');
  });

  after(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function run(fromState, toState) {
    try {
      const stdout = runNodeScript(GUARD_PATH, ['check', dir, fromState, toState, '--json', '--workflow', 'hotfix']);
      return { exitCode: 0, output: JSON.parse(stdout.trim()) };
    } catch (err) {
      if (err.stdout) {
        try { return { exitCode: err.status, output: JSON.parse(err.stdout.trim()) }; }
        catch { return { exitCode: err.status, output: err.stderr || err.message }; }
      }
      return { exitCode: err.status || 1, output: err.stderr || err.message };
    }
  }

  function prepareFreshHotfixState() {
    writeFileSync(join(dir, 'execution-contract.md'), '# Execution Contract\n\n## Intent Lock\n\nHotfix contract.\n');
    runNodeScript(CLI_PATH, ['state', 'init', dir]);
    runNodeScript(CLI_PATH, ['state', 'set', dir, 'workflow', 'hotfix']);
  }

  it('allows exploring to bridging without full planning artifacts', () => {
    const result = run('exploring', 'bridging');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks, []);
  });

  it('blocks bridging to approved-for-build without execution-contract.md', () => {
    const result = run('bridging', 'approved-for-build');
    assert.equal(result.exitCode, 1);
    assert.ok(result.output.checks.some(c => c.dimension === 'contract-current'));
  });

  it('blocks bridging to approved-for-build without DP-3', () => {
    prepareFreshHotfixState();
    const result = run('bridging', 'approved-for-build');
    assert.equal(result.exitCode, 1);
    assert.ok(result.output.checks.some(c => c.dimension === 'dp3-approved'));
  });

  it('rejects bridging to approved-for-build when DP-3 is recorded but not approved', () => {
    prepareFreshHotfixState();
    runNodeScript(CLI_PATH, ['state', 'set', dir, 'dp_3_result', 'rejected']);
    const result = run('bridging', 'approved-for-build');
    assert.equal(result.exitCode, 1);
    const dp3Check = result.output.checks.find(c => c.dimension === 'dp3-approved');
    assert.ok(dp3Check);
    assert.equal(dp3Check.pass, false);
  });

  it('allows bridging to approved-for-build with fresh contract and DP-3', () => {
    prepareFreshHotfixState();
    runNodeScript(CLI_PATH, ['state', 'set', dir, 'dp_3_result', 'approved']);
    const result = run('bridging', 'approved-for-build');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  });

  it('allows approved-for-build to executing with fresh contract and approved DP-3', () => {
    prepareFreshHotfixState();
    runNodeScript(CLI_PATH, ['state', 'set', dir, 'dp_3_result', 'approved: user confirmed minimal contract']);
    writeFileSync(join(dir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Hotfix task\n');
    runNodeScript(CLI_PATH, ['execution', 'recommend', dir, '--wave', 'wave-1:serial:1.1']);
    runNodeScript(CLI_PATH, ['execution', 'plan', dir, '--mode', 'sdd', '--confirm', '--acknowledge-recommendation',
      '--reason', 'hotfix user-selected execution plan', '--wave', 'wave-1:serial:1.1']);
    const result = run('approved-for-build', 'executing');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    // P1（review-findings-fix R2）：hotfix 快速路径不挂 tasks-checkbox-format
    // ——hotfix 可能没有完整 tasks.md，格式检查仅适用于 full 流程主表。
    const dims = result.output.checks.map(c => c.dimension);
    assert.deepEqual(dims, ['contract-current', 'dp3-approved', 'execution-plan-ready']);
  });

  it('keeps tasks-checkbox-format only in the full workflow main table', () => {
    // 直接断言 guard 内部表：hotfix 表还原、full 主表仍含该维度
    assert.ok(!runGuardTable('hotfix')['approved-for-build:executing'].includes('tasks-checkbox-format'));
    assert.ok(runGuardTable('full')['approved-for-build:executing'].includes('tasks-checkbox-format'));
  });

  it('allows a reviewed hotfix without tasks.md to enter closing', () => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'execution-contract.md'), '# Execution Contract\n\n## Intent Lock\n\nHotfix closing contract.\n');
    runNodeScript(CLI_PATH, ['state', 'init', dir]);
    runNodeScript(CLI_PATH, ['state', 'set', dir, 'workflow', 'hotfix']);
    const refs = initializeGitRepository(dir);

    runNodeScript(CLI_PATH, ['execution', 'recommend', dir, '--wave', 'wave-1:serial:1.1']);
    runNodeScript(CLI_PATH, ['execution', 'plan', dir, '--mode', 'inline', '--confirm',
      '--reason', 'user-selected hotfix closing plan', '--wave', 'wave-1:serial:1.1']);

    const reportsDir = join(dir, '.superpowers', 'sdd', 'reviews');
    mkdirSync(reportsDir, { recursive: true });
    writeFileSync(join(reportsDir, 'wave-1.md'), 'Hotfix review passed.\n');
    runNodeScript(CLI_PATH, ['execution', 'review', dir, '--wave', 'wave-1',
      '--base', refs.base, '--head', refs.head, '--report', '.superpowers/sdd/reviews/wave-1.md', '--verdict', 'pass']);
    runNodeScript(CLI_PATH, ['state', 'set', dir, 'test_result', 'pass']);
    runNodeScript(CLI_PATH, ['state', 'set', dir, 'spec_merged', 'true']);

    const result = run('executing', 'closing');

    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks.map(check => check.dimension), [
      'tests-passing',
      'specs-merged',
      'execution-plan-ready',
      'execution-reviews-passed',
    ]);
  });
});

describe('guard: execution control records', () => {
  let dir;
  let fixture;

  before(() => {
    fixture = createGitSeedFixture({
      setup: writeFreshFullState,
      initialCommitMessage: 'initial guard control records change',
      secondCommit: {
        path: 'git-range-marker.txt',
        content: 'second commit\n',
        message: 'second guard control records change',
      },
      prefix: 'ssf-guard-control-records-seed-',
      copyPrefix: 'ssf-guard-control-records-',
    });
  });

  after(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    fixture?.dispose();
  });

  async function run(fromState, toState, workflow = 'full') {
    const output = { stdout: '', stderr: '' };
    const io = {
      stdout: { write: text => { output.stdout += text; } },
      stderr: { write: text => { output.stderr += text; } },
    };
    try {
      const result = await runGuardInProcess(['check', dir, fromState, toState, '--json', '--workflow', workflow], io);
      return { exitCode: result.exitCode, output: JSON.parse(output.stdout.trim()) };
    } catch (error) {
      return { exitCode: 1, output: output.stderr || error.message };
    }
  }

  function writeFreshFullState(directory) {
    mkdirSync(join(directory, 'specs', 'execution'), { recursive: true });
    writeFileSync(join(directory, 'proposal.md'), '## Why\nThis proposal has enough context to verify guard control records in a full workflow.\n## What Changes\n- Enforce recorded execution control data.\n');
    writeFileSync(join(directory, 'design.md'), '# Design\n\n## Context\nGuard control records.\n');
    writeFileSync(join(directory, 'tasks.md'), '# Tasks\n\n- [x] 1.1 First task\n- [x] 1.2 Second task\n');
    writeFileSync(join(directory, 'specs', 'execution', 'spec.md'), '## Requirements\n\n### Requirement: Execution control records\nThe system SHALL require current execution control records.\n\n#### Scenario: Guard transition\n- **WHEN** execution starts\n- **THEN** the guard verifies control records.\n');
    writeFileSync(join(directory, 'execution-contract.md'), '# Execution Contract\n\n## Intent Lock\n\nGuard control records.\n');
    writeFileSync(join(directory, '.spec-superflow.yaml'), 'state: approved-for-build\nworkflow: full\n');
    runNodeScript(CLI_PATH, ['state', 'init', directory]);
  }

  function prepareFreshFullState() {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = fixture.createCopy();
    // R4: head 须被至少一个非 protected 分支包含。seed 默认分支为 master
    // （protected），建立指向 head 的隔离分支使分支校验放行。
    runGit(dir, ['branch', 'test-isolation', fixture.head]);
    gitRefs = { base: fixture.base, head: fixture.head };
  }

  function createCurrentPlan() {
    runNodeScript(CLI_PATH, ['execution', 'recommend', dir,
      '--wave', 'wave-1:parallel:1.1,1.2',
      '--wave', 'wave-2:serial:2.1']);
    runNodeScript(CLI_PATH, ['execution', 'plan', dir, '--mode', 'sdd', '--confirm',
      '--reason', 'full workflow user-selected execution plan',
      '--wave', 'wave-1:parallel:1.1,1.2',
      '--wave', 'wave-2:serial:2.1']);
  }

  function setStateField(field, value) {
    const statePath = join(dir, '.spec-superflow.yaml');
    const current = readFileSync(statePath, 'utf8');
    writeFileSync(statePath, current.replace(new RegExp(`^${field}:.*$`, 'm'), `${field}: ${value}`));
  }

  function recordPassingClosingPrerequisites() {
    runNodeScript(CLI_PATH, ['state', 'set', dir, 'test_result', 'pass: unit tests']);
  }

  function writeReviewReport(name, content = 'Review completed without blocking findings.\n') {
    const reportsDir = join(dir, '.superpowers', 'sdd', 'reviews');
    mkdirSync(reportsDir, { recursive: true });
    const reportPath = join(reportsDir, name);
    writeFileSync(reportPath, content);
    return reportPath;
  }

  it('rejects arbitrary DP-4 text when no current execution plan exists', async () => {
    prepareFreshFullState();
    setStateField('dp_4_result', 'anything');

    const result = await run('approved-for-build', 'executing');

    assert.equal(result.exitCode, 1);
    const planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.ok(planCheck);
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /plan.*missing|execution plan/i);
  });

  it('rejects a debugging return without a current execution plan in full workflow', async () => {
    prepareFreshFullState();

    const result = await run('debugging', 'executing');

    assert.equal(result.exitCode, 1);
    const planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.ok(planCheck);
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /plan.*missing|execution plan/i);
  });

  it('rejects a debugging return without a current execution plan in hotfix workflow', async () => {
    prepareFreshFullState();
    setStateField('workflow', 'hotfix');

    const result = await run('debugging', 'executing', 'hotfix');

    assert.equal(result.exitCode, 1);
    const planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.ok(planCheck);
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /plan.*missing|execution plan/i);
  });

  it('keeps a debugging return in tweak workflow free of contract checks', async () => {
    prepareFreshFullState();
    setStateField('workflow', 'tweak');

    const result = await run('debugging', 'executing', 'tweak');

    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks, []);
  });

  it('rejects a debugging return when the execution plan is stale', async () => {
    prepareFreshFullState();
    createCurrentPlan();
    writeFileSync(join(dir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 Changed task\n');

    const result = await run('debugging', 'executing');

    assert.equal(result.exitCode, 1);
    const planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.ok(planCheck);
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /stale: artifacts hash mismatch/i);
  });

  it('rejects a debugging return when the execution plan mode mismatches state', async () => {
    prepareFreshFullState();
    createCurrentPlan();
    setStateField('execution_mode', 'inline');

    const result = await run('debugging', 'executing');

    assert.equal(result.exitCode, 1);
    const planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.ok(planCheck);
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /mode does not match state/i);
  });

  it('rejects a debugging return when DP-4 forges the current plan revision', async () => {
    prepareFreshFullState();
    createCurrentPlan();
    setStateField('dp_4_result', 'sdd: plan revision 10; forged revision reference');

    const result = await run('debugging', 'executing');

    assert.equal(result.exitCode, 1);
    const planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.ok(planCheck);
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /DP-4.*revision/i);
  });

  it('rejects DP-4 that names a different execution plan revision', async () => {
    prepareFreshFullState();
    createCurrentPlan();
    setStateField('dp_4_result', 'sdd: plan revision 10; forged revision reference');

    const result = await run('approved-for-build', 'executing');

    assert.equal(result.exitCode, 1);
    const planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /DP-4.*revision/i);
  });

  it('keeps tweak transitions exempt from execution plan and review receipt checks', async () => {
    prepareFreshFullState();
    setStateField('workflow', 'tweak');
    setStateField('dp_4_result', 'tweak execution selected');

    const executing = await run('approved-for-build', 'executing', 'tweak');
    assert.equal(executing.exitCode, 0, JSON.stringify(executing.output));
    assert.ok(!executing.output.checks.some(check => check.dimension === 'execution-plan-ready'));

    recordPassingClosingPrerequisites();
    const closing = await run('executing', 'closing', 'tweak');
    assert.equal(closing.exitCode, 0, JSON.stringify(closing.output));
    assert.ok(!closing.output.checks.some(check => check.dimension === 'execution-reviews-passed'));
  });

  it('rejects full and hotfix closing without a current execution plan', async () => {
    for (const workflow of ['full', 'hotfix']) {
      prepareFreshFullState();
      setStateField('workflow', workflow);
      recordPassingClosingPrerequisites();

      const result = await run('executing', 'closing', workflow);
      const planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
      assert.equal(result.exitCode, 1, workflow);
      assert.ok(planCheck, workflow);
      assert.equal(planCheck.pass, false, workflow);
      assert.match(planCheck.failures.join('\n'), /plan.*missing|execution plan/i, workflow);
    }
  });

  it('rejects stale and state-mismatched execution plans before executing', async () => {
    prepareFreshFullState();
    createCurrentPlan();
    writeFileSync(join(dir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 Changed task\n');

    let result = await run('approved-for-build', 'executing');
    let planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.equal(result.exitCode, 1);
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /stale: artifacts hash mismatch/i);

    prepareFreshFullState();
    createCurrentPlan();
    setStateField('execution_mode', 'inline');
    result = await run('approved-for-build', 'executing');
    planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.equal(result.exitCode, 1);
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /mode does not match state/i);
  });

  it('blocks closing until every planned wave has a passing review receipt', async () => {
    prepareFreshFullState();
    createCurrentPlan();
    recordPassingClosingPrerequisites();

    let result = await run('executing', 'closing');
    let reviewCheck = result.output.checks.find(check => check.dimension === 'execution-reviews-passed');
    assert.equal(result.exitCode, 1);
    assert.equal(reviewCheck.pass, false);
    assert.match(reviewCheck.failures.join('\n'), /wave-1|receipt/i);

    runNodeScript(CLI_PATH, ['execution', 'review', dir, '--wave', 'wave-1',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', writeReviewReport('wave-1.md'), '--verdict', 'pass']);
    runNodeScript(CLI_PATH, ['execution', 'review', dir, '--wave', 'wave-2',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', writeReviewReport('wave-2.md'), '--verdict', 'fail']);

    result = await run('executing', 'closing');
    reviewCheck = result.output.checks.find(check => check.dimension === 'execution-reviews-passed');
    assert.equal(result.exitCode, 1);
    assert.equal(reviewCheck.pass, false);
    assert.match(reviewCheck.failures.join('\n'), /wave-2.*fail/i);

    runNodeScript(CLI_PATH, ['execution', 'review', dir, '--wave', 'wave-2',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', writeReviewReport('wave-2-repair.md'), '--verdict', 'pass']);

    result = await run('executing', 'closing');
    reviewCheck = result.output.checks.find(check => check.dimension === 'execution-reviews-passed');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.equal(reviewCheck.pass, true);
  });

  it('allows closing with passing receipts when existing checks also pass', async () => {
    prepareFreshFullState();
    createCurrentPlan();
    recordPassingClosingPrerequisites();
    runNodeScript(CLI_PATH, ['execution', 'review', dir, '--wave', 'wave-1',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', writeReviewReport('wave-1.md'), '--verdict', 'pass']);
    runNodeScript(CLI_PATH, ['execution', 'review', dir, '--wave', 'wave-2',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', writeReviewReport('wave-2.md'), '--verdict', 'pass']);

    const result = await run('executing', 'closing');

    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.equal(result.output.checks.find(check => check.dimension === 'execution-reviews-passed').pass, true);
  });

  it('blocks closing when a persisted passing review report is no longer safe evidence', { skip: !canCreateSymlink() }, async () => {
    const replacements = [
      {
        name: 'deleted',
        replace: reportPath => rmSync(reportPath),
      },
      {
        name: 'symbolic link',
        replace: reportPath => {
          rmSync(reportPath);
          symlinkSync(writeReviewReport('replacement-target.md'), reportPath);
        },
      },
    ];

    for (const replacement of replacements) {
      prepareFreshFullState();
      createCurrentPlan();
      recordPassingClosingPrerequisites();
      const waveOneReport = writeReviewReport('wave-1.md');
      runNodeScript(CLI_PATH, ['execution', 'review', dir, '--wave', 'wave-1',
        '--base', gitRefs.base, '--head', gitRefs.head, '--report', waveOneReport, '--verdict', 'pass']);
      runNodeScript(CLI_PATH, ['execution', 'review', dir, '--wave', 'wave-2',
        '--base', gitRefs.base, '--head', gitRefs.head, '--report', writeReviewReport('wave-2.md'), '--verdict', 'pass']);

      replacement.replace(waveOneReport);

      const result = await run('executing', 'closing');
      const reviewCheck = result.output.checks.find(check => check.dimension === 'execution-reviews-passed');
      assert.equal(result.exitCode, 1, replacement.name);
      assert.equal(reviewCheck.pass, false, replacement.name);
      assert.match(reviewCheck.failures.join('\n'), /wave-1|receipt/i, replacement.name);
    }
  });
});

describe('guard: workflow-aware transition resolution', () => {
  let dir;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ssf-guard-workflow-aware-'));
    writeFileSync(join(dir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: quick\n');
  });

  after(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function run(fromState, toState, workflow) {
    try {
      const stdout = runNodeScript(GUARD_PATH, ['check', dir, fromState, toState, '--json', '--workflow', workflow]);
      return { exitCode: 0, output: JSON.parse(stdout.trim()) };
    } catch (error) {
      return { exitCode: error.status ?? 1, output: JSON.parse(error.stdout.toString().trim()) };
    }
  }

  it('rejects exploring→specifying for quick with the correct fast-path hint', () => {
    const result = run('exploring', 'specifying', 'quick');
    assert.equal(result.exitCode, 1, JSON.stringify(result.output));
    const failures = result.output.checks.flatMap(c => c.failures);
    assert.ok(result.output.checks.some(c => c.dimension === 'workflow-mode'), JSON.stringify(result.output));
    assert.ok(failures.some(f => f.includes('use exploring -> approved-for-build')), failures.join('\n'));
  });

  it('rejects exploring→specifying for tweak', () => {
    const result = run('exploring', 'specifying', 'tweak');
    assert.equal(result.exitCode, 1, JSON.stringify(result.output));
    assert.ok(result.output.checks.some(c => c.dimension === 'workflow-mode'), JSON.stringify(result.output));
  });

  it('rejects exploring→specifying for hotfix', () => {
    const result = run('exploring', 'specifying', 'hotfix');
    assert.equal(result.exitCode, 1, JSON.stringify(result.output));
    assert.ok(result.output.checks.some(c => c.dimension === 'workflow-mode'), JSON.stringify(result.output));
  });

  it('rejects specifying→bridging for quick', () => {
    const result = run('specifying', 'bridging', 'quick');
    assert.equal(result.exitCode, 1, JSON.stringify(result.output));
    const failures = result.output.checks.flatMap(c => c.failures);
    assert.ok(result.output.checks.some(c => c.dimension === 'workflow-mode'), JSON.stringify(result.output));
    assert.ok(failures.some(f => f.includes('use exploring -> approved-for-build')), failures.join('\n'));
  });

  it('still allows exploring→specifying for full (regression)', () => {
    const result = run('exploring', 'specifying', 'full');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks, []);
  });

  it('allows specifying→approved-for-build for quick (corrective skip)', () => {
    const result = run('specifying', 'approved-for-build', 'quick');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks, []);
  });

  it('allows specifying→approved-for-build for lightweight (corrective skip)', () => {
    const result = run('specifying', 'approved-for-build', 'lightweight');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks, []);
  });

  it('rejects approved-for-build→bridging for quick as workflow-transition-unknown without artifacts demands', () => {
    const result = run('approved-for-build', 'bridging', 'quick');
    assert.equal(result.exitCode, 1, JSON.stringify(result.output));
    const failures = result.output.checks.flatMap(c => c.failures);
    assert.ok(result.output.checks.some(c => c.dimension === 'workflow-transition-unknown'), JSON.stringify(result.output));
    assert.ok(failures.some(f => f.includes("workflow 'quick'") && f.includes('approved-for-build:bridging')), failures.join('\n'));
    assert.ok(!failures.some(f => f.includes('artifacts-exist')), failures.join('\n'));
  });

  it('rejects exploring→bridging for quick as workflow-transition-unknown (full-only forward key)', () => {
    const result = run('exploring', 'bridging', 'quick');
    assert.equal(result.exitCode, 1, JSON.stringify(result.output));
    assert.ok(result.output.checks.some(c => c.dimension === 'workflow-transition-unknown'), JSON.stringify(result.output));
  });

  it('keeps rewind specifying→exploring allowed for quick', () => {
    const result = run('specifying', 'exploring', 'quick');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks, []);
  });

  it('keeps rewind executing→specifying allowed for quick', () => {
    const result = run('executing', 'specifying', 'quick');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks, []);
  });

  it('keeps rewind approved-for-build→specifying allowed for tweak', () => {
    const result = run('approved-for-build', 'specifying', 'tweak');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks, []);
  });

  it('keeps abandon exploring→abandoned allowed for quick', () => {
    const result = run('exploring', 'abandoned', 'quick');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks, []);
  });

  it('keeps abandon debugging→abandoned allowed for lightweight', () => {
    const result = run('debugging', 'abandoned', 'lightweight');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks, []);
  });

  it('keeps quick executing→closing on direct short path with direct-test-result (regression)', () => {
    const workflowDir = mkdtempSync(join(tmpdir(), 'ssf-guard-aware-quick-'));
    try {
      writeFileSync(join(workflowDir, '.spec-superflow.yaml'), 'state: executing\nworkflow: quick\n');
      saveWorkflowRecommendation(workflowDir, {
        task_count: 3, file_count: 3, config_doc_only: 'no', schema_api_change: 'no',
        new_module: 'no', behavioral_constraint_change: 'no', cross_module_change: 'no',
        uncertainty: 'low', request_kind: 'standard',
      });
      acceptWorkflowRecommendation(workflowDir, { source: 'direct-request', verificationStrategy: 'bounded' });
      writeFileSync(join(workflowDir, '.spec-superflow.yaml'), 'state: executing\nworkflow: quick\ntest_result: pass: focused test\n');
      const stdout = runNodeScript(GUARD_PATH, ['check', workflowDir, 'executing', 'closing', '--json', '--workflow', 'quick']);
      const output = JSON.parse(stdout.trim());
      assert.deepEqual(output.checks.map(c => c.dimension), ['direct-short-path', 'direct-test-result']);
    } finally {
      rmSync(workflowDir, { recursive: true, force: true });
    }
  });

  it('keeps lightweight executing→closing carrying lightweight-completion-evidence (regression)', () => {
    const workflowDir = mkdtempSync(join(tmpdir(), 'ssf-guard-aware-lw-'));
    try {
      writeFileSync(join(workflowDir, '.spec-superflow.yaml'), 'state: executing\nworkflow: lightweight\ntest_result: pass: targeted\n');
      const result = run('executing', 'closing', 'lightweight');
      assert.deepEqual(result.output.checks.map(c => c.dimension), [
        'direct-short-path', 'direct-test-result', 'lightweight-completion-evidence',
      ]);
    } finally {
      rmSync(workflowDir, { recursive: true, force: true });
    }
  });

  it('releases exploring→specifying after escalate from quick to full (workflow switch)', () => {
    const workflowDir = mkdtempSync(join(tmpdir(), 'ssf-guard-aware-escalate-'));
    try {
      writeFileSync(join(workflowDir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: quick\n');
      const rejected = run('exploring', 'specifying', 'quick');
      assert.equal(rejected.exitCode, 1, JSON.stringify(rejected.output));
      writeFileSync(join(workflowDir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: full\n');
      const released = run('exploring', 'specifying', 'full');
      assert.equal(released.exitCode, 0, JSON.stringify(released.output));
      assert.deepEqual(released.output.checks, []);
    } finally {
      rmSync(workflowDir, { recursive: true, force: true });
    }
  });

  it('keeps legacy hotfix exploring→bridging allowed without direct receipt (regression)', () => {
    const result = run('exploring', 'bridging', 'hotfix');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks, []);
  });
});

describe('guard: artifacts-exist check', () => {
  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-guard-artifacts-'));
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function runGuard(fromState, toState) {
    try {
      const result = runNodeScript(GUARD_PATH, ['check', tempDir, fromState, toState, '--json']);
      return { exitCode: 0, output: JSON.parse(result.trim()) };
    } catch (err) {
      if (err.stdout) {
        try { return { exitCode: err.status, output: JSON.parse(err.stdout.trim()) }; }
        catch { return { exitCode: err.status, output: err.stderr || err.message }; }
      }
      return { exitCode: err.status || 1, output: err.stderr || err.message };
    }
  }

  it('fails when a transition that requires artifacts has none', () => {
    const result = runGuard('specifying', 'bridging');
    // Intake is artifact-free; bridging is the first full-workflow transition
    // that must reject a change without proposal/spec artifacts.
    const artifactsCheck = result.output.checks.find(c => c.dimension === 'artifacts-exist');
    assert.ok(artifactsCheck);
    assert.equal(artifactsCheck.pass, false);
    assert.ok(artifactsCheck.failures.length > 0);
  });
});
