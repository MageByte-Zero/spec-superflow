import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlan, writePlan } from '../../scripts/lib/execution-plan.mjs';
import { createRecommendationReceipt } from '../../scripts/lib/execution-recommendation.mjs';

const CLI = join(process.cwd(), 'scripts/spec-superflow.mjs');
let root;

function runSsf(args, { cwd = process.cwd() } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      status: error.status || 1,
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() ?? error.message,
    };
  }
}

function makeChange(name, state) {
  const changeDir = join(root, name);
  mkdirSync(changeDir);
  writeFileSync(join(changeDir, '.spec-superflow.yaml'), `state: ${state}\nworkflow: full\n`);
  return changeDir;
}

function makeTasksChange(name, tasks) {
  const changeDir = join(root, name);
  mkdirSync(changeDir);
  writeFileSync(join(changeDir, 'tasks.md'), `# Tasks\n\n${tasks}`);
  return changeDir;
}

function makeCurrentPlan(changeDir) {
  writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Resume execution\n');
  writeFileSync(join(changeDir, 'execution-contract.md'), '# Execution Contract\n\nResume safely.\n');
  const waves = [{ id: 'recovery-cli', strategy: 'serial', tasks: ['1.1'], depends_on: [] }];
  const recommendationReceipt = createRecommendationReceipt(changeDir, waves);
  const recommendation = recommendationReceipt.recommendation;
  const plan = createPlan(changeDir, {
    mode: recommendation.recommendation.mode,
    source: 'user-confirmed',
    rationale: 'Resume the current recovery CLI wave',
    waves,
    recommendation,
    recommendationReceipt,
    selection: {
      confirmed: true,
      followed_recommendation: true,
      acknowledged_non_recommendation: false,
    },
  });
  writePlan(changeDir, plan);
  return plan;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ssf-cmd-recovery-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ssf resume and switch', () => {
  it('returns one stable JSON object from resume', () => {
    const change = makeChange('alpha', 'specifying');
    const result = runSsf(['resume', change, '--json']);

    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.deepEqual(
      Object.keys(value).filter(key =>
        ['ok', 'command', 'change', 'state', 'terminal', 'blockers', 'next_action', 'continuation'].includes(key),
      ),
      ['ok', 'command', 'change', 'state', 'terminal', 'blockers', 'next_action', 'continuation'],
    );
    assert.equal(value.command, 'resume');
  });

  it('rejects switch without an explicit target as JSON', () => {
    const result = runSsf(['switch', '--json']);

    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      command: 'switch',
      error: {
        code: 'TARGET_REQUIRED',
        message: 'switch requires an explicit change target',
        details: {},
      },
    });
  });

  it('rejects a whitespace-only switch target as text', () => {
    const result = runSsf(['switch', '   ']);

    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /TARGET_REQUIRED: switch requires an explicit change target/);
  });

  it('rejects a whitespace-only switch target as JSON', () => {
    const result = runSsf(['switch', '   ', '--json']);

    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      command: 'switch',
      error: {
        code: 'TARGET_REQUIRED',
        message: 'switch requires an explicit change target',
        details: {},
      },
    });
  });

  for (const command of ['resume', 'switch']) {
    it(`rejects multiple change targets from ${command} as JSON`, () => {
      const result = runSsf([command, 'alpha', 'beta', '--json']);

      assert.equal(result.status, 2);
      assert.deepEqual(JSON.parse(result.stdout), {
        ok: false,
        command,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: `${command} accepts at most one change target`,
          details: { positionals: ['alpha', 'beta'] },
        },
      });
    });

    it(`maps native ${command} parse errors to one JSON usage error`, () => {
      const usage = command === 'resume'
        ? 'Usage: ssf resume [change-dir] [--json]'
        : 'Usage: ssf switch <change-dir> [--json]';
      const result = runSsf([command, '--json', '--bad-option']);

      assert.equal(result.status, 2);
      assert.deepEqual(JSON.parse(result.stdout), {
        ok: false,
        command,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: usage,
          details: {},
        },
      });
      assert.equal(result.stderr, '');
    });

    it(`maps native ${command} parse errors to text usage`, () => {
      const usage = command === 'resume'
        ? 'Usage: ssf resume [change-dir] [--json]'
        : 'Usage: ssf switch <change-dir> [--json]';
      const result = runSsf([command, '--bad-option']);

      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, `${usage}\n`);
    });
  }

  it('returns a single JSON object for recovery domain errors', () => {
    const result = runSsf(['resume', join(root, 'missing'), '--json']);

    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      command: 'resume',
      error: {
        code: 'TARGET_NOT_FOUND',
        message: 'Change target was not found',
        details: { input: join(root, 'missing') },
      },
    });
  });

  it('keeps unexpected recovery read failures as domain JSON errors', () => {
    const change = join(root, 'unreadable');
    mkdirSync(change);
    mkdirSync(join(change, '.spec-superflow.yaml'));

    const result = runSsf(['resume', change, '--json']);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.status, 1);
    assert.equal(payload.ok, false);
    assert.equal(payload.command, 'resume');
    assert.equal(payload.error.code, 'RECOVERY_FAILED');
    assert.match(payload.error.message, /EISDIR/);
    assert.equal(payload.error.details.code, 'EISDIR');
    assert.match(payload.error.details.message, /EISDIR/);
  });

  it('renders the complete recovery context as text without changing the target', () => {
    const change = makeChange('alpha', 'specifying');
    const stateBefore = readFileSync(join(change, '.spec-superflow.yaml'), 'utf8');

    const result = runSsf(['switch', change]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Change: alpha/);
    assert.match(result.stdout, new RegExp(`Path: ${change.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(result.stdout, /Selection: explicit/);
    assert.match(result.stdout, /State: specifying/);
    assert.match(result.stdout, /Workflow: full/);
    assert.match(result.stdout, /Checkpoint: none/);
    assert.match(result.stdout, /Handoffs: active 0, result-ready 0, resolved 0/);
    assert.match(result.stdout, /Execution current: not required/);
    assert.match(result.stdout, /Execution revision: none/);
    assert.match(result.stdout, /Next eligible wave: none/);
    assert.match(result.stdout, /Execution failures: not required/);
    assert.match(result.stdout, /Blockers: none/);
    assert.match(result.stdout, /Continuation: automatic/);
    assert.match(result.stdout, /Next action:/);
    assert.doesNotMatch(result.stdout, /undefined/);
    assert.equal(readFileSync(join(change, '.spec-superflow.yaml'), 'utf8'), stateBefore);
  });

  it('reports when resume automatically selects the only active change', () => {
    const changesDir = join(root, 'changes');
    mkdirSync(changesDir);
    const change = join(changesDir, 'alpha');
    mkdirSync(change);
    writeFileSync(join(change, '.spec-superflow.yaml'), 'state: specifying\nworkflow: full\n');

    const result = runSsf(['resume'], { cwd: root });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Change: alpha/);
    assert.match(result.stdout, new RegExp(`Path: ${realpathSync(change).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(result.stdout, /Selection: only-active/);
    assert.doesNotMatch(result.stdout, /undefined/);
  });

  it('renders current execution plan fields and the next eligible wave', () => {
    const change = makeChange('executing-alpha', 'executing');
    const plan = makeCurrentPlan(change);

    const result = runSsf(['resume', change]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Workflow: full/);
    assert.match(result.stdout, /Execution current: yes/);
    assert.match(result.stdout, new RegExp(`Execution revision: ${plan.revision}`));
    assert.match(result.stdout, /Next eligible wave: recovery-cli/);
    assert.match(result.stdout, /Continuation: automatic \(wave: recovery-cli\)/);
    assert.match(result.stdout, /Execution failures: none/);
    assert.doesNotMatch(result.stdout, /undefined/);
  });

  it('returns an automatic continuation with the eligible wave as JSON', () => {
    const change = makeChange('automatic-alpha', 'executing');
    makeCurrentPlan(change);

    const result = runSsf(['resume', change, '--json']);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).continuation, {
      kind: 'automatic',
      wave: 'recovery-cli',
      reason: 'Current execution plan has an eligible wave',
    });
  });

  it('returns a blocked continuation with the required operator action as JSON', () => {
    const change = makeChange('blocked-alpha', 'executing');

    const result = runSsf(['resume', change, '--json']);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).continuation, {
      kind: 'blocked',
      wave: null,
      reason: 'A current execution plan is required',
    });
  });

  it('returns a terminal continuation as JSON', () => {
    const change = makeChange('terminal-alpha', 'closing');

    const result = runSsf(['resume', change, '--json']);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).continuation, {
      kind: 'terminal',
      wave: null,
      reason: 'Change is terminal',
    });
  });
});

describe('ssf save', () => {
  it('writes the existing checkpoint schema', () => {
    const change = makeTasksChange('alpha', '- [ ] 1.1 Run recovery test\n');
    const result = runSsf(['save', change, '--task', '1.1', '--next', 'Run tests', '--json']);

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(payload), ['ok', 'command', 'change', 'checkpoint']);
    assert.equal(payload.command, 'save');
    assert.deepEqual(payload.change, { name: 'alpha', path: change });
    assert.equal(payload.checkpoint.task_id, '1.1');
    assert.equal(payload.checkpoint.next, 'Run tests');
    assert.match(readFileSync(join(change, '.superpowers/sdd/checkpoints/1.1.md'), 'utf8'), /task_hash: "sha256:/);
  });

  it('rejects missing save inputs as one JSON usage error without writes', () => {
    const change = makeTasksChange('alpha', '- [ ] 1.1 Existing task\n');
    const result = runSsf(['save', change, '--task', '1.1', '--json']);

    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      command: 'save',
      error: {
        code: 'INVALID_ARGUMENTS',
        message: 'save requires --task <id> and --next <text>',
        details: {},
      },
    });
    assert.equal(existsSync(join(change, '.superpowers/sdd/checkpoints/1.1.md')), false);
    assert.equal(existsSync(join(change, '.superpowers')), false);
  });

  it('maps unknown save options to a text usage error without writes', () => {
    const change = makeTasksChange('alpha', '- [ ] 1.1 Existing task\n');
    const result = runSsf(['save', change, '--task', '1.1', '--next', 'Continue', '--unexpected']);

    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Usage: ssf save <change-dir> --task <id> --next <text>\n');
    assert.equal(existsSync(join(change, '.superpowers')), false);
  });

  it('maps missing save option values to one JSON usage error without writes', () => {
    const change = makeTasksChange('alpha', '- [ ] 1.1 Existing task\n');
    const result = runSsf(['save', change, '--task', '--next', 'Continue', '--json']);

    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      command: 'save',
      error: {
        code: 'INVALID_ARGUMENTS',
        message: 'Usage: ssf save <change-dir> --task <id> --next <text>',
        details: {},
      },
    });
    assert.equal(existsSync(join(change, '.superpowers')), false);
  });

  it('rejects unknown tasks as one JSON domain error without creating a checkpoint', () => {
    const change = makeTasksChange('alpha', '- [ ] 1.1 Existing task\n');
    const result = runSsf(['save', change, '--task', '9.9', '--next', 'Continue', '--json']);

    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      command: 'save',
      error: {
        code: 'CHECKPOINT_SAVE_FAILED',
        message: "Task '9.9' was not found in tasks.md",
        details: {},
      },
    });
    assert.equal(existsSync(join(change, '.superpowers/sdd/checkpoints/9.9.md')), false);
    assert.equal(existsSync(join(change, '.superpowers')), false);
  });
});
