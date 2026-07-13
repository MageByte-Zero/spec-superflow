// tests/lib/guard.test.mjs
// Tests for scripts/guard/guard.mjs — transition matrix and workflow behavior
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

let tempDir;
const GUARD_PATH = join(process.cwd(), 'scripts/guard/guard.mjs');
const CLI_PATH = join(process.cwd(), 'scripts/spec-superflow.mjs');

function runNodeScript(scriptPath, args) {
  return execFileSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
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

  it('exploring→specifying requires artifacts-exist', () => {
    const result = runGuard('exploring', 'specifying');
    assert.equal(result.exitCode, 0, `Expected exit 0 but got ${result.exitCode}: ${JSON.stringify(result.output)}`);
    const checks = result.output.checks;
    assert.ok(checks.some(c => c.dimension === 'artifacts-exist'));
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

describe('guard: hotfix minimal contract', () => {
  let dir;

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
    runNodeScript(CLI_PATH, ['execution', 'plan', dir, '--mode', 'sdd',
      '--reason', 'hotfix default execution plan', '--wave', 'wave-1:serial:1.1']);
    const result = run('approved-for-build', 'executing');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    const dims = result.output.checks.map(c => c.dimension);
    assert.deepEqual(dims, ['contract-current', 'dp3-approved', 'execution-plan-ready']);
  });
});

describe('guard: execution control records', () => {
  let dir;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ssf-guard-control-records-'));
  });

  after(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function run(fromState, toState, workflow = 'full') {
    try {
      const stdout = runNodeScript(GUARD_PATH, ['check', dir, fromState, toState, '--json', '--workflow', workflow]);
      return { exitCode: 0, output: JSON.parse(stdout.trim()) };
    } catch (err) {
      if (err.stdout) {
        try { return { exitCode: err.status, output: JSON.parse(err.stdout.trim()) }; }
        catch { return { exitCode: err.status, output: err.stderr || err.message }; }
      }
      return { exitCode: err.status || 1, output: err.stderr || err.message };
    }
  }

  function prepareFreshFullState() {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'specs', 'execution'), { recursive: true });
    writeFileSync(join(dir, 'proposal.md'), '## Why\nThis proposal has enough context to verify guard control records in a full workflow.\n## What Changes\n- Enforce recorded execution control data.\n');
    writeFileSync(join(dir, 'design.md'), '# Design\n\n## Context\nGuard control records.\n');
    writeFileSync(join(dir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 First task\n- [x] 1.2 Second task\n');
    writeFileSync(join(dir, 'specs', 'execution', 'spec.md'), '## ADDED Requirements\n\n### Requirement: Execution control records\nThe system SHALL require current execution control records.\n\n#### Scenario: Guard transition\n- **WHEN** execution starts\n- **THEN** the guard verifies control records.\n');
    writeFileSync(join(dir, 'execution-contract.md'), '# Execution Contract\n\n## Intent Lock\n\nGuard control records.\n');
    writeFileSync(join(dir, '.spec-superflow.yaml'), 'state: approved-for-build\nworkflow: full\n');
    runNodeScript(CLI_PATH, ['state', 'init', dir]);
  }

  function createCurrentPlan() {
    runNodeScript(CLI_PATH, ['execution', 'plan', dir, '--mode', 'sdd',
      '--reason', 'full workflow default execution plan',
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
    runNodeScript(CLI_PATH, ['state', 'set', dir, 'spec_merged', 'true']);
  }

  function writeReviewReport(name, content = 'Review completed without blocking findings.\n') {
    const reportsDir = join(dir, 'reports');
    mkdirSync(reportsDir, { recursive: true });
    const reportPath = join(reportsDir, name);
    writeFileSync(reportPath, content);
    return reportPath;
  }

  it('rejects arbitrary DP-4 text when no current execution plan exists', () => {
    prepareFreshFullState();
    setStateField('dp_4_result', 'anything');

    const result = run('approved-for-build', 'executing');

    assert.equal(result.exitCode, 1);
    const planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.ok(planCheck);
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /plan.*missing|execution plan/i);
  });

  it('rejects a debugging return without a current execution plan in full workflow', () => {
    prepareFreshFullState();

    const result = run('debugging', 'executing');

    assert.equal(result.exitCode, 1);
    const planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.ok(planCheck);
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /plan.*missing|execution plan/i);
  });

  it('rejects a debugging return without a current execution plan in hotfix workflow', () => {
    prepareFreshFullState();
    setStateField('workflow', 'hotfix');

    const result = run('debugging', 'executing', 'hotfix');

    assert.equal(result.exitCode, 1);
    const planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.ok(planCheck);
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /plan.*missing|execution plan/i);
  });

  it('keeps a debugging return in tweak workflow limited to contract freshness', () => {
    prepareFreshFullState();
    setStateField('workflow', 'tweak');

    const result = run('debugging', 'executing', 'tweak');

    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.deepEqual(result.output.checks.map(check => check.dimension), ['contract-fresh']);
  });

  it('rejects a debugging return when the execution plan is stale', () => {
    prepareFreshFullState();
    createCurrentPlan();
    writeFileSync(join(dir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 Changed task\n');

    const result = run('debugging', 'executing');

    assert.equal(result.exitCode, 1);
    const planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.ok(planCheck);
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /stale: artifacts hash mismatch/i);
  });

  it('rejects a debugging return when the execution plan mode mismatches state', () => {
    prepareFreshFullState();
    createCurrentPlan();
    setStateField('execution_mode', 'inline');

    const result = run('debugging', 'executing');

    assert.equal(result.exitCode, 1);
    const planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.ok(planCheck);
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /mode does not match state/i);
  });

  it('rejects a debugging return when DP-4 forges the current plan revision', () => {
    prepareFreshFullState();
    createCurrentPlan();
    setStateField('dp_4_result', 'sdd: plan revision 10; forged revision reference');

    const result = run('debugging', 'executing');

    assert.equal(result.exitCode, 1);
    const planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.ok(planCheck);
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /DP-4.*revision/i);
  });

  it('rejects DP-4 that names a different execution plan revision', () => {
    prepareFreshFullState();
    createCurrentPlan();
    setStateField('dp_4_result', 'sdd: plan revision 10; forged revision reference');

    const result = run('approved-for-build', 'executing');

    assert.equal(result.exitCode, 1);
    const planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /DP-4.*revision/i);
  });

  it('keeps tweak transitions exempt from execution plan and review receipt checks', () => {
    prepareFreshFullState();
    setStateField('workflow', 'tweak');
    setStateField('dp_4_result', 'tweak execution selected');

    const executing = run('approved-for-build', 'executing', 'tweak');
    assert.equal(executing.exitCode, 0, JSON.stringify(executing.output));
    assert.ok(!executing.output.checks.some(check => check.dimension === 'execution-plan-ready'));

    recordPassingClosingPrerequisites();
    const closing = run('executing', 'closing', 'tweak');
    assert.equal(closing.exitCode, 0, JSON.stringify(closing.output));
    assert.ok(!closing.output.checks.some(check => check.dimension === 'execution-reviews-passed'));
  });

  it('rejects full and hotfix closing without a current execution plan', () => {
    for (const workflow of ['full', 'hotfix']) {
      prepareFreshFullState();
      setStateField('workflow', workflow);
      recordPassingClosingPrerequisites();

      const result = run('executing', 'closing', workflow);
      const planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
      assert.equal(result.exitCode, 1, workflow);
      assert.ok(planCheck, workflow);
      assert.equal(planCheck.pass, false, workflow);
      assert.match(planCheck.failures.join('\n'), /plan.*missing|execution plan/i, workflow);
    }
  });

  it('rejects stale and state-mismatched execution plans before executing', () => {
    prepareFreshFullState();
    createCurrentPlan();
    writeFileSync(join(dir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 Changed task\n');

    let result = run('approved-for-build', 'executing');
    let planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.equal(result.exitCode, 1);
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /stale: artifacts hash mismatch/i);

    prepareFreshFullState();
    createCurrentPlan();
    setStateField('execution_mode', 'inline');
    result = run('approved-for-build', 'executing');
    planCheck = result.output.checks.find(check => check.dimension === 'execution-plan-ready');
    assert.equal(result.exitCode, 1);
    assert.equal(planCheck.pass, false);
    assert.match(planCheck.failures.join('\n'), /mode does not match state/i);
  });

  it('blocks closing until every planned wave has a passing review receipt', () => {
    prepareFreshFullState();
    createCurrentPlan();
    recordPassingClosingPrerequisites();

    let result = run('executing', 'closing');
    let reviewCheck = result.output.checks.find(check => check.dimension === 'execution-reviews-passed');
    assert.equal(result.exitCode, 1);
    assert.equal(reviewCheck.pass, false);
    assert.match(reviewCheck.failures.join('\n'), /wave-1|receipt/i);

    runNodeScript(CLI_PATH, ['execution', 'review', dir, '--wave', 'wave-1',
      '--base', 'base-1', '--head', 'head-1', '--report', writeReviewReport('wave-1.md'), '--verdict', 'pass']);
    runNodeScript(CLI_PATH, ['execution', 'review', dir, '--wave', 'wave-2',
      '--base', 'base-2', '--head', 'head-2', '--report', writeReviewReport('wave-2.md'), '--verdict', 'fail']);

    result = run('executing', 'closing');
    reviewCheck = result.output.checks.find(check => check.dimension === 'execution-reviews-passed');
    assert.equal(result.exitCode, 1);
    assert.equal(reviewCheck.pass, false);
    assert.match(reviewCheck.failures.join('\n'), /wave-2.*fail/i);

    runNodeScript(CLI_PATH, ['execution', 'review', dir, '--wave', 'wave-2',
      '--base', 'base-2-repair', '--head', 'head-2-repair', '--report', writeReviewReport('wave-2-repair.md'), '--verdict', 'pass']);

    result = run('executing', 'closing');
    reviewCheck = result.output.checks.find(check => check.dimension === 'execution-reviews-passed');
    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.equal(reviewCheck.pass, true);
  });

  it('allows closing with passing receipts when existing checks also pass', () => {
    prepareFreshFullState();
    createCurrentPlan();
    recordPassingClosingPrerequisites();
    runNodeScript(CLI_PATH, ['execution', 'review', dir, '--wave', 'wave-1',
      '--base', 'base-1', '--head', 'head-1', '--report', writeReviewReport('wave-1.md'), '--verdict', 'pass']);
    runNodeScript(CLI_PATH, ['execution', 'review', dir, '--wave', 'wave-2',
      '--base', 'base-2', '--head', 'head-2', '--report', writeReviewReport('wave-2.md'), '--verdict', 'pass']);

    const result = run('executing', 'closing');

    assert.equal(result.exitCode, 0, JSON.stringify(result.output));
    assert.equal(result.output.checks.find(check => check.dimension === 'execution-reviews-passed').pass, true);
  });

  it('blocks closing when a persisted passing review report is no longer safe evidence', () => {
    const replacements = [
      {
        name: 'deleted',
        replace: reportPath => rmSync(reportPath),
      },
      {
        name: 'empty',
        replace: reportPath => writeFileSync(reportPath, ''),
      },
      {
        name: 'directory',
        replace: reportPath => {
          rmSync(reportPath);
          mkdirSync(reportPath);
        },
      },
      {
        name: 'symbolic link',
        replace: reportPath => {
          rmSync(reportPath);
          symlinkSync(writeReviewReport('replacement-target.md'), reportPath);
        },
      },
      {
        name: 'control-character path',
        replace: reportPath => {
          const receiptPath = join(dir, '.superpowers', 'sdd', 'reviews', `${Buffer.from('wave-1').toString('base64url')}.json`);
          const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
          receipt.report = `${reportPath}\nforged`;
          writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
        },
      },
    ];

    for (const replacement of replacements) {
      prepareFreshFullState();
      createCurrentPlan();
      recordPassingClosingPrerequisites();
      const waveOneReport = writeReviewReport('wave-1.md');
      runNodeScript(CLI_PATH, ['execution', 'review', dir, '--wave', 'wave-1',
        '--base', 'base-1', '--head', 'head-1', '--report', waveOneReport, '--verdict', 'pass']);
      runNodeScript(CLI_PATH, ['execution', 'review', dir, '--wave', 'wave-2',
        '--base', 'base-2', '--head', 'head-2', '--report', writeReviewReport('wave-2.md'), '--verdict', 'pass']);

      replacement.replace(waveOneReport);

      const result = run('executing', 'closing');
      const reviewCheck = result.output.checks.find(check => check.dimension === 'execution-reviews-passed');
      assert.equal(result.exitCode, 1, replacement.name);
      assert.equal(reviewCheck.pass, false, replacement.name);
      assert.match(reviewCheck.failures.join('\n'), /wave-1|receipt/i, replacement.name);
    }
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

  it('fails when no artifacts exist', () => {
    const result = runGuard('exploring', 'specifying');
    // artifacts-exist should fail — no proposal, specs, etc.
    const artifactsCheck = result.output.checks.find(c => c.dimension === 'artifacts-exist');
    assert.ok(artifactsCheck);
    assert.equal(artifactsCheck.pass, false);
    assert.ok(artifactsCheck.failures.length > 0);
  });
});
