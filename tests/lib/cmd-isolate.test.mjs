// Regression tests for #52: optional isolate names must not become the
// literal string "undefined" when cmd-isolate invokes ensure-branch.
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const CLI = join(ROOT, 'scripts', 'spec-superflow.mjs');
const ENSURE = join(ROOT, 'scripts', 'ensure-branch.mjs');
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function runIsolate(args) {
  const tempDir = mkdtempSync(join(tmpdir(), 'ssf-cmd-isolate-'));
  tempDirs.push(tempDir);
  const binDir = join(tempDir, 'bin');
  const capture = join(tempDir, 'argv.txt');
  const fakeNode = join(binDir, 'node');

  mkdirSync(binDir);
  writeFileSync(fakeNode, '#!/bin/sh\nprintf "%s\\n" "$@" > "$SSF_CAPTURE"\n', 'utf8');
  chmodSync(fakeNode, 0o755);

  const result = spawnSync(process.execPath, [CLI, 'isolate', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      SSF_CAPTURE: capture,
    },
  });

  return {
    result,
    argv: readFileSync(capture, 'utf8').trimEnd().split('\n'),
  };
}

describe('cmd-isolate optional change name (#52)', () => {
  const skip = process.platform === 'win32' && 'POSIX-only node shim';
  it('omits the optional name from ensure-branch argv when the caller omits it', { skip }, () => {
    const { result, argv } = runIsolate(['/tmp/changes/demo']);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(argv, [ENSURE, '/tmp/changes/demo']);
  });

  it('forwards an explicitly supplied name unchanged', { skip }, () => {
    const { result, argv } = runIsolate(['/tmp/changes/demo', 'runtime-fix']);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(argv, [ENSURE, '/tmp/changes/demo', 'runtime-fix']);
  });

  it('forwards force without manufacturing an optional name', { skip }, () => {
    const { result, argv } = runIsolate(['/tmp/changes/demo', '--force']);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(argv, [ENSURE, '/tmp/changes/demo', '--force']);
  });
});
