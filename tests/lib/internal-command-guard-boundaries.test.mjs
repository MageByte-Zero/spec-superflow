import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dispatchCli } from '../../scripts/spec-superflow.mjs';
import { run as runExecution } from '../../scripts/lib/cmd-execution.mjs';
import { runGuard } from '../../scripts/guard/guard.mjs';

const ROOT = process.cwd();
const CLI = join(ROOT, 'scripts', 'spec-superflow.mjs');
const GUARD = join(ROOT, 'scripts', 'guard', 'guard.mjs');
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function captureIo() {
  const output = { stdout: '', stderr: '' };
  return {
    output,
    io: {
      stdout: { write: text => { output.stdout += text; } },
      stderr: { write: text => { output.stderr += text; } },
    },
  };
}

function writeValidChange(dir) {
  mkdirSync(join(dir, 'specs', 'boundary'), { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), '## Why\nThis boundary fixture has enough detail for validation.\n## What Changes\n- Add a boundary.\n');
  writeFileSync(join(dir, 'design.md'), '# Design\n');
  writeFileSync(join(dir, 'tasks.md'), '# Tasks\n');
  writeFileSync(join(dir, 'specs', 'boundary', 'spec.md'), '## ADDED Requirements\n### Requirement: Boundary\nThe system SHALL retain wrapper behavior.\n#### Scenario: Validate\n- **WHEN** invoked\n- **THEN** it passes.\n');
}

describe('internal command and guard boundaries', () => {
  it('dispatches a command in-process with injected streams', async () => {
    const { io, output } = captureIo();
    let receivedArgs;
    let receivedIo;
    const result = await dispatchCli(['fixture', 'value'], {
      ...io,
      commands: {
        fixture: async () => ({ run: async (args, commandIo) => {
          receivedArgs = args;
          receivedIo = commandIo;
          commandIo.stdout.write('command output\n');
        } }),
      },
    });

    assert.equal(result.exitCode, 0);
    assert.deepEqual(receivedArgs, ['value']);
    assert.equal(receivedIo.stdout, io.stdout);
    assert.deepEqual(output, { stdout: 'command output\n', stderr: '' });
  });

  it('evaluates a guard transition in-process with injected streams', async () => {
    const { io, output } = captureIo();
    const result = await runGuard(['check', '.', 'exploring', 'specifying', '--json'], io);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(output.stdout), { pass: true, checks: [] });
    assert.equal(output.stderr, '');
  });

  it('reports execution-command validation failures in-process without exiting', async () => {
    const { io, output } = captureIo();
    const result = await runExecution(['unknown'], io);

    assert.equal(result.exitCode, 2);
    assert.match(output.stderr, /unknown execution subcommand/i);
    assert.match(output.stdout, /ssf execution recommend/i);
  });
});

describe('public command wrappers', () => {
  it('keeps the CLI success path, stdout, exit code, and cwd semantics', () => {
    const cwd = makeTempDir('ssf-cli-wrapper-');
    writeFileSync(join(cwd, 'spec-superflow.config.json'), '{"execution":{"inlineThreshold":17}}\n');
    const result = spawnSync(process.execPath, [CLI, 'runtime', 'config', '--get', 'execution.inlineThreshold'], {
      cwd,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '17');
    assert.equal(result.stderr, '');
  });

  it('keeps the CLI validation failure, stderr, and exit code', () => {
    const result = spawnSync(process.execPath, [CLI, 'runtime', 'asset', 'read', '../package.json'], { encoding: 'utf8' });

    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /allowlist/i);
  });

  it('keeps the guard success path, stdout, exit code, and cwd semantics', () => {
    const cwd = makeTempDir('ssf-guard-wrapper-');
    writeValidChange(cwd);
    const result = spawnSync(process.execPath, [GUARD, 'check', '.', 'specifying', 'bridging', '--json'], {
      cwd,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).pass, true);
    assert.equal(result.stderr, '');
  });

  it('keeps the guard validation failure, stderr, and exit code', () => {
    const result = spawnSync(process.execPath, [GUARD, 'check', '.', 'exploring', 'specifying', '--workflow', 'invalid'], {
      encoding: 'utf8',
    });

    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /invalid workflow/i);
  });
});
