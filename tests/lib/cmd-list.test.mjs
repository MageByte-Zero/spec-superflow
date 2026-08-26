// tests/lib/cmd-list.test.mjs
// Tests for scripts/lib/cmd-list.mjs — detectChangeStatus logic
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

let tempDir;

describe('cmd-list: detectChangeStatus()', () => {
  let detectChangeStatus;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-list-test-'));
    const modulePath = join(process.cwd(), 'scripts/lib/cmd-list.mjs');
    const mod = await import(pathToFileURL(modulePath).href);
    detectChangeStatus = mod.detectChangeStatus;
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function writeStateFile(dir, state) {
    const lines = [];
    for (const [key, value] of Object.entries(state)) {
      lines.push(`${key}: ${value}`);
    }
    writeFileSync(join(dir, '.spec-superflow.yaml'), lines.join('\n'));
  }

  it('returns EXPLORING when state file says exploring', () => {
    writeStateFile(tempDir, { state: 'exploring' });
    const result = detectChangeStatus(tempDir);
    assert.equal(result.status, 'EXPLORING');
    assert.ok(result.detail.includes('exploring'));
  });

  it('returns SPECIFYING when state file says specifying', () => {
    writeStateFile(tempDir, { state: 'specifying' });
    const result = detectChangeStatus(tempDir);
    assert.equal(result.status, 'SPECIFYING');
  });

  it('returns BRIDGED when state file says bridging', () => {
    writeStateFile(tempDir, { state: 'bridging' });
    const result = detectChangeStatus(tempDir);
    assert.equal(result.status, 'BRIDGED');
  });

  it('returns APPROVED when state file says approved-for-build', () => {
    writeStateFile(tempDir, { state: 'approved-for-build' });
    const result = detectChangeStatus(tempDir);
    assert.equal(result.status, 'APPROVED');
  });

  it('returns EXECUTING when state file says executing', () => {
    writeStateFile(tempDir, { state: 'executing' });
    const result = detectChangeStatus(tempDir);
    assert.equal(result.status, 'EXECUTING');
  });

  it('returns DEBUGGING when state file says debugging', () => {
    writeStateFile(tempDir, { state: 'debugging' });
    const result = detectChangeStatus(tempDir);
    assert.equal(result.status, 'DEBUGGING');
  });

  it('returns CLOSED when state file says closing', () => {
    writeStateFile(tempDir, { state: 'closing' });
    const result = detectChangeStatus(tempDir);
    assert.equal(result.status, 'CLOSED');
  });

  it('returns ABANDONED when state file says abandoned', () => {
    writeStateFile(tempDir, { state: 'abandoned' });
    const result = detectChangeStatus(tempDir);
    assert.equal(result.status, 'ABANDONED');
  });

  it('includes workflow mode in detail for non-full workflows', () => {
    writeStateFile(tempDir, { state: 'executing', workflow: 'hotfix' });
    const result = detectChangeStatus(tempDir);
    assert.equal(result.status, 'EXECUTING');
    assert.ok(result.detail.includes('hotfix'));
  });

  it('does not include workflow detail for full mode', () => {
    writeStateFile(tempDir, { state: 'executing', workflow: 'full' });
    const result = detectChangeStatus(tempDir);
    assert.equal(result.status, 'EXECUTING');
    assert.equal(result.detail, 'executing');
  });

  // Fallback: when no state file exists, infer from file presence
  // Each test must clean up previous state file to test fallback path
  it('falls back to INCOMPLETE when no state file and no proposal', () => {
    rmSync(join(tempDir, '.spec-superflow.yaml'), { force: true });
    const result = detectChangeStatus(tempDir);
    assert.equal(result.status, 'INCOMPLETE');
    assert.ok(result.detail.includes('Missing proposal.md'));
  });

  it('falls back to SPECIFYING when proposal exists but no contract and no state file', () => {
    rmSync(join(tempDir, '.spec-superflow.yaml'), { force: true });
    writeFileSync(join(tempDir, 'proposal.md'), '## Why\nTest proposal');
    const result = detectChangeStatus(tempDir);
    assert.equal(result.status, 'SPECIFYING');
  });

  it('falls back to ABANDONED when abandonment-summary.md exists', () => {
    rmSync(join(tempDir, '.spec-superflow.yaml'), { force: true });
    writeFileSync(join(tempDir, 'abandonment-summary.md'), '# Abandoned\nGave up on this');
    const result = detectChangeStatus(tempDir);
    assert.equal(result.status, 'ABANDONED');
  });

  it('falls back to UNKNOWN when artifacts exist but no state file', () => {
    rmSync(join(tempDir, '.spec-superflow.yaml'), { force: true });
    rmSync(join(tempDir, 'abandonment-summary.md'), { force: true });
    writeFileSync(join(tempDir, 'proposal.md'), '## Why\nTest proposal');
    writeFileSync(join(tempDir, 'execution-contract.md'), '## Intent Lock\nTest contract');
    const result = detectChangeStatus(tempDir);
    assert.equal(result.status, 'UNKNOWN');
  });
});
