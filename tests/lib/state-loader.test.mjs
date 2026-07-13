// tests/lib/state-loader.test.mjs
// Tests for scripts/lib/state-loader.mjs
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir;

describe('state-loader: readState()', () => {
  let stateLoader;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-state-test-'));
    const modulePath = join(process.cwd(), 'scripts/lib/state-loader.mjs');
    stateLoader = await import(modulePath);
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns defaults when no state file exists', () => {
    const state = stateLoader.readState(tempDir);
    assert.equal(state.state, 'exploring');
    assert.equal(state.workflow, 'auto');
    assert.equal(state.batches_completed, 0);
    assert.equal(state.execution_mode, null);
    assert.equal(state.execution_plan_hash, null);
    assert.equal(state.execution_plan_revision, null);
  });

  it('infers change_name from directory when no state file', () => {
    const changeDir = join(tempDir, 'my-feature');
    const state = stateLoader.readState(changeDir);
    assert.equal(state.change_name, 'my-feature');
  });

  it('parses existing state file correctly', () => {
    const stateYaml = [
      'state: executing',
      'workflow: full',
      'artifacts_hash: sha256:abc123',
      'batches_completed: 3',
      'test_result: pass',
      'change_name: export-csv',
      'dp_0_confirmed: true',
      'dp_1_result: confirmed: add csv export',
    ].join('\n');

    writeFileSync(join(tempDir, '.spec-superflow.yaml'), stateYaml);

    const state = stateLoader.readState(tempDir);

    assert.equal(state.state, 'executing');
    assert.equal(state.workflow, 'full');
    assert.equal(state.artifacts_hash, 'sha256:abc123');
    assert.equal(state.batches_completed, 3);
    assert.equal(state.test_result, 'pass');
    assert.equal(state.change_name, 'export-csv');
    assert.equal(state.dp_0_confirmed, 'true');
    assert.equal(state.dp_1_result, 'confirmed: add csv export');
  });

  it('handles null values in YAML', () => {
    const stateYaml = [
      'state: exploring',
      'artifacts_hash: null',
      'contract_hash: null',
      'dp_0_timestamp: null',
    ].join('\n');

    writeFileSync(join(tempDir, '.spec-superflow.yaml'), stateYaml);

    const state = stateLoader.readState(tempDir);

    assert.equal(state.artifacts_hash, null);
    assert.equal(state.contract_hash, null);
    assert.equal(state.dp_0_timestamp, null);
  });

  it('ignores comments and empty lines in YAML', () => {
    const stateYaml = [
      '# This is a comment',
      '',
      'state: specifying',
      '  ',
      '# Another comment',
      'workflow: tweak',
    ].join('\n');

    writeFileSync(join(tempDir, '.spec-superflow.yaml'), stateYaml);

    const state = stateLoader.readState(tempDir);

    assert.equal(state.state, 'specifying');
    assert.equal(state.workflow, 'tweak');
  });

  it('merges partial state file with defaults', () => {
    const stateYaml = 'state: approved-for-build\nworkflow: hotfix';

    writeFileSync(join(tempDir, '.spec-superflow.yaml'), stateYaml);

    const state = stateLoader.readState(tempDir);
    assert.equal(state.state, 'approved-for-build');
    assert.equal(state.workflow, 'hotfix');
    // Unspecified fields should use defaults
    assert.equal(state.batches_completed, 0);
    assert.equal(state.test_result, null);
  });
});

describe('state-loader: writeState()', () => {
  let stateLoader;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-state-write-'));
    const modulePath = join(process.cwd(), 'scripts/lib/state-loader.mjs');
    stateLoader = await import(modulePath);
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes state file with correct structure', () => {
    const state = {
      state: 'executing',
      workflow: 'full',
      artifacts_hash: 'sha256:def456',
      contract_hash: null,
      batches_completed: 2,
      test_result: null,
      change_name: 'test-change',
      dp_0_confirmed: 'true',
    };

    stateLoader.writeState(tempDir, state);

    const filePath = join(tempDir, '.spec-superflow.yaml');
    assert.ok(existsSync(filePath));

    const content = readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('state: executing'));
    assert.ok(content.includes('workflow: full'));
    assert.ok(content.includes('artifacts_hash: sha256:def456'));
    assert.ok(content.includes('contract_hash: null'));
    assert.ok(content.includes('batches_completed: 2'));
    assert.ok(content.includes('execution_plan_hash: null'));
    assert.ok(content.includes('execution_plan_revision: null'));
    assert.ok(content.includes('change_name: test-change'));
    assert.ok(content.includes('dp_0_confirmed: true'));
  });

  it('writes all DP fields (0-7)', () => {
    const state = {
      state: 'closing',
      dp_0_decisions: 'scope: csv export only, tech: nestjs',
      dp_0_result: 'confirmed: scope ok',
      dp_0_confirmed: 'true',
      dp_0_timestamp: '2026-07-01T08:00:00Z',
      dp_1_result: 'confirmed: csv export',
      dp_2_result: 'approved: artifacts ok',
      dp_3_result: 'contract signed',
      dp_4_result: 'execution started',
      dp_5_result: null,
      dp_6_result: null,
      dp_7_result: null,
    };

    stateLoader.writeState(tempDir, state);

    const content = readFileSync(join(tempDir, '.spec-superflow.yaml'), 'utf-8');
    assert.ok(content.includes('dp_0_decisions: scope: csv export only, tech: nestjs'));
    assert.ok(content.includes('dp_0_result: confirmed: scope ok'));
    assert.ok(content.includes('dp_0_confirmed: true'));
    assert.ok(content.includes('dp_1_result: confirmed: csv export'));
    assert.ok(content.includes('dp_5_result: null'));
  });

  it('round-trips dp_0_result when updated through state loader', () => {
    stateLoader.writeState(tempDir, {
      state: 'exploring',
      dp_0_decisions: 'scope confirmed',
      dp_0_confirmed: 'true',
    });

    stateLoader.updateField(tempDir, 'dp_0_result', 'confirmed: manual');

    const content = readFileSync(join(tempDir, '.spec-superflow.yaml'), 'utf-8');
    const state = stateLoader.readState(tempDir);

    assert.ok(content.includes('dp_0_result: confirmed: manual'));
    assert.equal(state.dp_0_result, 'confirmed: manual');
  });

  it('round-trips state through write then read', () => {
    const original = {
      state: 'bridging',
      workflow: 'hotfix',
      artifacts_hash: 'sha256:xyz789',
      batches_completed: 0,
      dp_1_result: 'confirmed: refactor auth',
      dp_1_timestamp: '2026-07-01T10:00:00Z',
    };

    stateLoader.writeState(tempDir, original);
    const read = stateLoader.readState(tempDir);

    assert.equal(read.state, original.state);
    assert.equal(read.workflow, original.workflow);
    assert.equal(read.artifacts_hash, original.artifacts_hash);
    assert.equal(read.batches_completed, original.batches_completed);
    assert.equal(read.dp_1_result, original.dp_1_result);
    assert.equal(read.dp_1_timestamp, original.dp_1_timestamp);
  });
});

describe('state-loader: updateField()', () => {
  let stateLoader;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-state-update-'));
    const modulePath = join(process.cwd(), 'scripts/lib/state-loader.mjs');
    stateLoader = await import(modulePath);
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('updates a single field without affecting others', () => {
    // Initialize with some state
    stateLoader.writeState(tempDir, {
      state: 'exploring',
      workflow: 'full',
      batches_completed: 0,
    });

    stateLoader.updateField(tempDir, 'state', 'specifying');
    stateLoader.updateField(tempDir, 'batches_completed', 3);

    const state = stateLoader.readState(tempDir);
    assert.equal(state.state, 'specifying');
    assert.equal(state.batches_completed, 3);
    // workflow should still be 'full'
    assert.equal(state.workflow, 'full');
  });
});
