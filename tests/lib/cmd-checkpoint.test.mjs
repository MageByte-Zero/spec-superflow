// tests/lib/cmd-checkpoint.test.mjs
// Dispatcher-level tests for ssf checkpoint.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'scripts/spec-superflow.mjs');
let changeDir;

function runSsf(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      exitCode: error.status || 1,
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || error.message,
    };
  }
}

beforeEach(() => {
  changeDir = mkdtempSync(join(tmpdir(), 'ssf-checkpoint-'));
  writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Original task text\n');
});

afterEach(() => {
  rmSync(changeDir, { recursive: true, force: true });
});

describe('ssf checkpoint', () => {
  it('advertises checkpoint and handoff syntax in --help', () => {
    const result = runSsf(['--help']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /checkpoint save <change-dir>/);
    assert.match(result.stdout, /handoff create <change-dir>/);
  });

  it('saves and shows a task checkpoint', () => {
    const result = runSsf([
      'checkpoint', 'save', changeDir, '--task', '1.1', '--next', 'Run focused tests',
      '--completed', 'Added parser tests', '--verification', 'tests/lib/sdd-overlay.test.mjs',
      '--review', 'review.md', '--risk', 'None', '--commit-start', 'aaaaaaa', '--commit-end', 'bbbbbbb',
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    const show = runSsf(['checkpoint', 'show', changeDir, '1.1', '--json']);
    assert.equal(show.exitCode, 0, show.stderr);
    const shown = JSON.parse(show.stdout).checkpoint;
    assert.equal(shown.next, 'Run focused tests');
    assert.equal(shown.completed, 'Added parser tests');
    assert.equal(shown.evidence, 'tests/lib/sdd-overlay.test.mjs');
    assert.equal(shown.review, 'review.md');
    assert.equal(shown.risk, 'None');
    assert.equal(shown.commit_start, 'aaaaaaa');
    assert.equal(shown.commit_end, 'bbbbbbb');

    const listed = runSsf(['checkpoint', 'list', changeDir, '--json']);
    assert.equal(listed.exitCode, 0, listed.stderr);
    const listedCheckpoint = JSON.parse(listed.stdout).checkpoints[0];
    assert.equal(listedCheckpoint.completed, 'Added parser tests');
    assert.equal(listedCheckpoint.evidence, 'tests/lib/sdd-overlay.test.mjs');
    assert.equal(listedCheckpoint.review, 'review.md');
    assert.equal(listedCheckpoint.risk, 'None');
    assert.equal(listedCheckpoint.commit_start, 'aaaaaaa');
    assert.equal(listedCheckpoint.commit_end, 'bbbbbbb');
  });

  it('rejects save without --next before creating a checkpoint file', () => {
    const result = runSsf(['checkpoint', 'save', changeDir, '--task', '1.1']);
    assert.equal(result.exitCode, 2);
    assert.equal(existsSync(join(changeDir, '.superpowers', 'sdd', 'checkpoints', '1.1.md')), false);
    assert.equal(existsSync(join(changeDir, '.superpowers')), false);
  });

  it('rejects an unknown save task before creating the checkpoint directory', () => {
    const result = runSsf(['checkpoint', 'save', changeDir, '--task', '9.9', '--next', 'Continue']);
    assert.equal(result.exitCode, 1);
    assert.equal(existsSync(join(changeDir, '.superpowers')), false);
  });

  it('lists a stale checkpoint as JSON', () => {
    const save = runSsf(['checkpoint', 'save', changeDir, '--task', '1.1', '--next', 'Run focused tests']);
    assert.equal(save.exitCode, 0, save.stderr);
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Changed task text\n');

    const result = runSsf(['checkpoint', 'list', changeDir, '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.checkpoints.length, 1);
    assert.equal(payload.checkpoints[0].task_id, '1.1');
    assert.equal(payload.checkpoints[0].stale, true);
  });

  it('keeps a checkpoint current after a checkbox-only task update', () => {
    const save = runSsf(['checkpoint', 'save', changeDir, '--task', '1.1', '--next', 'Run focused tests']);
    assert.equal(save.exitCode, 0, save.stderr);
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 Original task text\n');

    const result = runSsf(['checkpoint', 'list', changeDir, '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).checkpoints[0].stale, false);
  });

  it('rejects an unknown task ID when showing a checkpoint', () => {
    const result = runSsf(['checkpoint', 'show', changeDir, '9.9']);
    assert.equal(result.exitCode, 1);
  });
});
