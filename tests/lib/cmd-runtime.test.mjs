// Runtime facade regression tests. These execute the public CLI so the
// canonical-skill protocol is tested without relying on a plugin-root env var.
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const CLI = join(ROOT, 'scripts', 'spec-superflow.mjs');
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function runRuntime(args, options = {}) {
  return spawnSync(process.execPath, [CLI, 'runtime', ...args], {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
}

describe('ssf runtime', () => {
  it('reads approved assets from the package root without a plugin-root environment variable', () => {
    const result = runRuntime(['asset', 'read', 'templates/execution-contract.md'], {
      env: { CLAUDE_PLUGIN_ROOT: '', PLUGIN_ROOT: '' },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /# 执行合同/);
  });

  it('rejects traversal and assets outside the allowlist', () => {
    const result = runRuntime(['asset', 'read', '../package.json']);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /allowed|allowlist/i);
  });

  it('dispatches infer and guard while preserving their established output', () => {
    const infer = runRuntime(['infer', '/tmp/ssf-runtime-missing-change']);
    const guard = runRuntime(['guard', 'check', 'docs/examples/add-dark-mode', 'exploring', 'specifying', '--json']);

    assert.equal(infer.status, 0, infer.stderr);
    assert.deepEqual(JSON.parse(infer.stdout).mode, 'full');
    assert.equal(guard.status, 0, guard.stderr);
    assert.equal(JSON.parse(guard.stdout).pass, true);
  });

  it('provides read-only config and rejects config writes', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ssf-runtime-config-'));
    tempDirs.push(tempDir);
    const read = runRuntime(['config', '--get', 'execution.inlineThreshold'], { cwd: tempDir });
    const write = runRuntime(['config', '--set', 'execution.inlineThreshold=99'], { cwd: tempDir });

    assert.equal(read.status, 0, read.stderr);
    assert.equal(read.stdout.trim(), '3');
    assert.equal(write.status, 2);
    assert.match(write.stderr, /read-only|--set/i);
  });

  it('uses the existing update-check result without requiring a global ssf command', { skip: process.platform === 'win32' && 'POSIX-only npm shim' }, () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ssf-runtime-update-'));
    tempDirs.push(tempDir);
    const binDir = join(tempDir, 'bin');
    const fakeNpm = join(binDir, 'npm');
    mkdirSync(binDir);
    writeFileSync(fakeNpm, '#!/bin/sh\nprintf "0.9.0\\n"\n', 'utf8');
    chmodSync(fakeNpm, 0o755);

    const result = runRuntime(['check-update'], {
      env: { PATH: `${binDir}${delimiter}${process.env.PATH}` },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /up to date/i);
  });
});
