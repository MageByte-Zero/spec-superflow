import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'scripts/spec-superflow.mjs');
const LEGACY = join(process.cwd(), 'scripts/validate-artifacts');
let tempRoot;

function runNode(args) {
  try {
    const stdout = execFileSync(process.execPath, args, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    return { exitCode: err.status || 1, stdout: err.stdout?.toString() || '', stderr: err.stderr?.toString() || err.message };
  }
}

function writeBaseChange(dir) {
  writeFileSync(join(dir, 'proposal.md'), '## Why\nThis proposal is long enough to pass validation because it explains the user problem clearly.\n## What Changes\n- Add validated behavior');
  writeFileSync(join(dir, 'design.md'), '## Context\nValidation fixture.\n## Goals\nKeep paths canonical.\n## Decisions\n### D1\n- Choice: canonical specs\n- Rationale: one path');
  writeFileSync(join(dir, 'tasks.md'), '## File Structure\n- Modify: scripts/example.mjs\n## Tasks\n- [x] Validate paths');
}

function writeValidSpec(file) {
  writeFileSync(file, '## ADDED Requirements\n\n### Requirement: Canonical path\n\nThe system SHALL validate canonical specs.\n\n#### Scenario: Valid spec\n- **WHEN** validation runs\n- **THEN** the spec is checked');
}

describe('validate commands: spec paths', () => {
  before(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'ssf-validate-paths-'));
  });

  after(() => {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  });

  it('ssf validate rejects flat specs/<capability>.md', () => {
    const dir = mkdtempSync(join(tempRoot, 'flat-'));
    writeBaseChange(dir);
    mkdirSync(join(dir, 'specs'), { recursive: true });
    writeValidSpec(join(dir, 'specs', 'ui-theme.md'));

    const result = runNode([CLI, 'validate', dir]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stdout + result.stderr, /Invalid spec path: specs\/ui-theme\.md/);
    assert.match(result.stdout + result.stderr, /specs\/ui-theme\/spec\.md/);
  });

  it('validate-artifacts rejects specs/ with no canonical spec.md', () => {
    const dir = mkdtempSync(join(tempRoot, 'empty-specs-'));
    writeBaseChange(dir);
    mkdirSync(join(dir, 'specs'), { recursive: true });

    const result = runNode([LEGACY, dir]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stdout + result.stderr, /No canonical spec files found/);
  });

  it('ssf validate accepts canonical specs/<capability>/spec.md', () => {
    const dir = mkdtempSync(join(tempRoot, 'canonical-'));
    writeBaseChange(dir);
    mkdirSync(join(dir, 'specs', 'ui-theme'), { recursive: true });
    writeValidSpec(join(dir, 'specs', 'ui-theme', 'spec.md'));

    const result = runNode([CLI, 'validate', dir]);
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /specs\/ui-theme\/spec\.md/);
  });
});
