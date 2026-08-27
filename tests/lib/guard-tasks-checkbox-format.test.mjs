// tests/lib/guard-tasks-checkbox-format.test.mjs
// Unit + integration tests for the tasks-checkbox-format guard dimension
// Covers changes/state-tracking-consistency specs R3 (state-tracking-consistency)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkTasksCheckboxFormat } from '../../scripts/guard/checks/tasks-checkbox-format.mjs';
import { runGuard as runGuardInProcess } from '../../scripts/guard/guard.mjs';

let dir;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'ssf-guard-checkbox-'));
});

after(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function seedChangeDir({ tasksContent }) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'specs', 'test'), { recursive: true });
  writeFileSync(join(dir, '.spec-superflow.yaml'), 'state: approved-for-build\nworkflow: full\nchange_name: test\n');
  writeFileSync(join(dir, 'proposal.md'), '## Why\nThis proposal seeds the checkbox guard integration fixture.\n## What Changes\n- Seed.\n');
  writeFileSync(join(dir, 'design.md'), '# Design\n\n## Context\nSeed.\n');
  writeFileSync(join(dir, 'specs', 'test', 'spec.md'), '## ADDED Requirements\n\n### Requirement: Seed\nThe system SHALL seed.\n\n#### Scenario: Seed\n- **WHEN** seeding\n- **THEN** seeded\n');
  writeFileSync(join(dir, 'execution-contract.md'), '# Execution Contract\n\n## Intent Lock\n\nSeed contract.\n');
  if (tasksContent !== undefined) {
    writeFileSync(join(dir, 'tasks.md'), tasksContent);
  }
}

function runGuard(fromState, toState) {
  const output = { stdout: '', stderr: '' };
  const io = {
    stdout: { write: text => { output.stdout += text; } },
    stderr: { write: text => { output.stderr += text; } },
  };
  try {
    const result = runGuardInProcess(['check', dir, fromState, toState, '--json'], io);
    return { exitCode: result.exitCode, output: JSON.parse(output.stdout.trim()) };
  } catch (error) {
    return { exitCode: 1, output: JSON.parse(output.stdout.trim()) };
  }
}

describe('checkTasksCheckboxFormat (unit)', () => {
  it('passes when tasks.md contains an unchecked checkbox line "- [ ]"', () => {
    seedChangeDir({ tasksContent: '# Tasks\n\n### 1.1 First task\n- [ ] Do the thing\n' });
    const result = checkTasksCheckboxFormat(dir);
    assert.deepEqual(result, { pass: true, failures: [] });
  });

  it('passes when tasks.md contains a checked checkbox line "- [x]"', () => {
    seedChangeDir({ tasksContent: '# Tasks\n\n- [X] Done task\n' });
    const result = checkTasksCheckboxFormat(dir);
    assert.deepEqual(result, { pass: true, failures: [] });
  });

  it('passes when checkbox line is indented', () => {
    seedChangeDir({ tasksContent: '# Tasks\n\n  - [ ] indented task\n' });
    const result = checkTasksCheckboxFormat(dir);
    assert.deepEqual(result, { pass: true, failures: [] });
  });

  it('fails with template hint when tasks.md only has numbered headings and no checkbox lines', () => {
    seedChangeDir({ tasksContent: '# Tasks\n\n### 1. 任务一\n### 2. 任务二\n' });
    const result = checkTasksCheckboxFormat(dir);
    assert.equal(result.pass, false);
    assert.equal(result.failures.length > 0, true);
    assert.match(result.failures.join(' '), /checkbox 格式/);
    assert.match(result.failures.join(' '), /tasks\.md 需使用模板 checkbox 格式（- \[ \] 任务）/);
  });

  it('fails when tasks.md exists but is empty', () => {
    seedChangeDir({ tasksContent: '' });
    const result = checkTasksCheckboxFormat(dir);
    assert.equal(result.pass, false);
    assert.match(result.failures.join(' '), /checkbox 格式/);
  });

  it('fails with a missing-file hint when tasks.md does not exist', () => {
    seedChangeDir({ tasksContent: undefined });
    const result = checkTasksCheckboxFormat(dir);
    assert.equal(result.pass, false);
    assert.match(result.failures.join(' '), /missing|缺失/i);
    assert.match(result.failures.join(' '), /checkbox 格式/);
  });
});

describe('guard: tasks-checkbox-format on approved-for-build -> executing (integration)', () => {
  it('blocks the transition when tasks.md has no checkbox lines, reporting the template hint', () => {
    seedChangeDir({ tasksContent: '# Tasks\n\n### 1.1 Only numbered heading, no checkbox\n' });
    const result = runGuard('approved-for-build', 'executing');
    const check = result.output.checks.find(c => c.dimension === 'tasks-checkbox-format');
    assert.ok(check, 'tasks-checkbox-format dimension must run for approved-for-build -> executing');
    assert.equal(check.pass, false);
    assert.match(check.failures.join(' '), /checkbox 格式/);
    assert.equal(result.exitCode, 1);
  });

  it('lets the tasks-checkbox-format dimension pass when tasks.md uses checkbox format', () => {
    seedChangeDir({ tasksContent: '# Tasks\n\n- [ ] 1.1 Real task\n' });
    const result = runGuard('approved-for-build', 'executing');
    const check = result.output.checks.find(c => c.dimension === 'tasks-checkbox-format');
    assert.ok(check, 'tasks-checkbox-format dimension must run for approved-for-build -> executing');
    assert.equal(check.pass, true, JSON.stringify(check));
  });

  it('does not apply to transitions outside the full mainline a2e (e.g. exploring -> specifying)', () => {
    seedChangeDir({ tasksContent: undefined });
    const result = runGuard('exploring', 'specifying');
    assert.ok(!result.output.checks.some(c => c.dimension === 'tasks-checkbox-format'));
  });
});
