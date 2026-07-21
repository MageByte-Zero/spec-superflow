import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOverlayPaths } from '../../scripts/lib/sdd-overlay.mjs';
import { readState } from '../../scripts/lib/state-loader.mjs';
import { recordWorkflowSelection, saveWorkflowRecommendation } from '../../scripts/lib/workflow-recommendation.mjs';

const CLI = join(process.cwd(), 'scripts/spec-superflow.mjs');
let changeDir;

function runSsf(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, stderr: '', json: tryJson(stdout) };
  } catch (error) {
    const stdout = error.stdout?.toString() ?? '';
    return {
      exitCode: error.status ?? 1,
      stdout,
      stderr: error.stderr?.toString() ?? '',
      json: tryJson(stdout),
    };
  }
}

function tryJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function writeState(contents = 'state: exploring\nworkflow: auto\n') {
  writeFileSync(join(changeDir, '.spec-superflow.yaml'), contents);
}

function snapshotWorkflowFiles() {
  const receiptPath = getOverlayPaths(changeDir).workflowSelection;
  return {
    state: readFileSync(join(changeDir, '.spec-superflow.yaml'), 'utf8'),
    receipt: existsSync(receiptPath) ? readFileSync(receiptPath, 'utf8') : null,
  };
}

function assertWorkflowFilesUnchanged(before) {
  assert.equal(readFileSync(join(changeDir, '.spec-superflow.yaml'), 'utf8'), before.state);
  const receiptPath = getOverlayPaths(changeDir).workflowSelection;
  assert.equal(existsSync(receiptPath) ? readFileSync(receiptPath, 'utf8') : null, before.receipt);
}

function recommend(args = []) {
  return runSsf(['workflow', 'recommend', changeDir,
    '--task-count', '2', '--file-count', '2', '--config-doc-only', 'no',
    '--schema-api-change', 'no', '--new-module', 'no', '--uncertainty', 'low',
    '--json', ...args]);
}

beforeEach(() => {
  changeDir = mkdtempSync(join(tmpdir(), 'ssf-workflow-cmd-'));
  writeState();
});

afterEach(() => {
  rmSync(changeDir, { recursive: true, force: true });
});

describe('ssf workflow', () => {
  it('does not set workflow until the user confirms a selection', () => {
    const recommended = recommend();
    assert.equal(recommended.exitCode, 0, recommended.stderr);
    assert.equal(recommended.json.recommendation.mode, 'hotfix');
    assert.equal(readState(changeDir).workflow, 'auto');

    const beforeUnconfirmed = snapshotWorkflowFiles();
    const unconfirmed = runSsf(['workflow', 'select', changeDir, '--mode', 'hotfix',
      '--reason', 'bounded code fix', '--json']);
    assert.equal(unconfirmed.exitCode, 1);
    assert.match(unconfirmed.stderr, /confirm/i);
    assertWorkflowFilesUnchanged(beforeUnconfirmed);
    assert.equal(readState(changeDir).dp_0_decisions, null);

    const selected = runSsf(['workflow', 'select', changeDir, '--mode', 'hotfix',
      '--confirm', '--reason', 'bounded code fix', '--json']);
    assert.equal(selected.exitCode, 0, selected.stderr);
    assert.equal(readState(changeDir).workflow, 'hotfix');
    assert.match(readState(changeDir).dp_0_decisions, /workflow_path=hotfix/);
  });

  it('shows complete ready recommendations in human-readable recommend and show output', () => {
    const recommended = runSsf(['workflow', 'recommend', changeDir,
      '--task-count', '2', '--file-count', '2', '--config-doc-only', 'no',
      '--schema-api-change', 'no', '--new-module', 'no', '--uncertainty', 'low']);
    assert.equal(recommended.exitCode, 0, recommended.stderr);
    assert.match(recommended.stdout, /Observed:/);
    assert.match(recommended.stdout, /Available:.*full.*hotfix.*tweak/);
    assert.match(recommended.stdout, /Recommended: hotfix/);
    assert.match(recommended.stdout, /Why:.*bounded code work/i);

    const shown = runSsf(['workflow', 'show', changeDir]);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.match(shown.stdout, /Observed:/);
    assert.match(shown.stdout, /Available:.*full.*hotfix.*tweak/);
    assert.match(shown.stdout, /Recommended: hotfix/);
    assert.match(shown.stdout, /Why:.*bounded code work/i);
  });

  it('returns needs-input without changing auto workflow', () => {
    const result = runSsf(['workflow', 'recommend', changeDir,
      '--task-count', '2', '--config-doc-only', 'no', '--schema-api-change', 'unknown',
      '--new-module', 'no', '--uncertainty', 'low', '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.status, 'needs-input');
    assert.deepEqual(result.json.missing_facts, ['file_count', 'schema_api_change']);
    assert.equal(readState(changeDir).workflow, 'auto');
  });

  it('respects an explicitly configured workflow without creating a receipt', () => {
    writeState('state: exploring\nworkflow: full\n');
    const result = runSsf(['workflow', 'recommend', changeDir, '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.source, 'explicit-state');
    assert.equal(result.json.workflow, 'full');
    assert.equal(existsSync(getOverlayPaths(changeDir).workflowSelection), false);

    const select = runSsf(['workflow', 'select', changeDir, '--mode', 'full',
      '--confirm', '--reason', 'do not override', '--json']);
    assert.equal(select.exitCode, 1);
    assert.match(select.stderr, /already explicitly selected/i);
  });

  it('prioritizes explicit state over an invalid stale receipt', () => {
    assert.equal(recommend().exitCode, 0);
    const receiptPath = getOverlayPaths(changeDir).workflowSelection;
    const tampered = JSON.parse(readFileSync(receiptPath, 'utf8'));
    tampered.facts.file_count = 99;
    writeFileSync(receiptPath, JSON.stringify(tampered));
    writeState('state: exploring\nworkflow: full\n');

    const result = runSsf(['workflow', 'show', changeDir, '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.source, 'explicit-state');
    assert.equal(result.json.workflow, 'full');
  });

  it('rejects selection from a tampered receipt without mutating receipt or state', () => {
    assert.equal(recommend().exitCode, 0);
    const receiptPath = getOverlayPaths(changeDir).workflowSelection;
    const tampered = JSON.parse(readFileSync(receiptPath, 'utf8'));
    tampered.facts.file_count = 99;
    writeFileSync(receiptPath, JSON.stringify(tampered));
    const before = snapshotWorkflowFiles();

    const result = runSsf(['workflow', 'select', changeDir, '--mode', 'hotfix',
      '--confirm', '--reason', 'bounded code fix', '--json']);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /hash mismatch/i);
    assertWorkflowFilesUnchanged(before);
    assert.equal(readState(changeDir).dp_0_decisions, null);
  });

  it('requires acknowledgement before accepting a non-recommended selection', () => {
    assert.equal(recommend().exitCode, 0);
    const rejected = runSsf(['workflow', 'select', changeDir, '--mode', 'full',
      '--confirm', '--reason', 'operator preference', '--json']);
    assert.equal(rejected.exitCode, 1);
    assert.match(rejected.stderr, /acknowledge/i);
    assert.equal(readState(changeDir).workflow, 'auto');

    const selected = runSsf(['workflow', 'select', changeDir, '--mode', 'full',
      '--confirm', '--reason', 'operator preference', '--acknowledge-recommendation', '--json']);
    assert.equal(selected.exitCode, 0, selected.stderr);
    assert.equal(selected.json.record.selection.followed_recommendation, false);
    assert.equal(readState(changeDir).workflow, 'full');
  });

  it('shows missing, invalid, selection-pending, and selected receipt states', () => {
    let result = runSsf(['workflow', 'show', changeDir, '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.status, 'missing');

    saveWorkflowRecommendation(changeDir, {
      task_count: 2, file_count: 2, config_doc_only: 'no', schema_api_change: 'no',
      new_module: 'no', uncertainty: 'low',
    });
    const receiptPath = getOverlayPaths(changeDir).workflowSelection;
    const tampered = JSON.parse(readFileSync(receiptPath, 'utf8'));
    tampered.facts.file_count = 99;
    writeFileSync(receiptPath, JSON.stringify(tampered));
    result = runSsf(['workflow', 'show', changeDir, '--json']);
    assert.equal(result.exitCode, 1);
    assert.equal(result.json.status, 'invalid');

    saveWorkflowRecommendation(changeDir, {
      task_count: 2, file_count: 2, config_doc_only: 'no', schema_api_change: 'no',
      new_module: 'no', uncertainty: 'low',
    });
    recordWorkflowSelection(changeDir, {
      mode: 'hotfix', reason: 'recoverable selection', confirmed: true, acknowledged: false,
    });
    result = runSsf(['workflow', 'show', changeDir, '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.status, 'selection-pending');

    result = runSsf(['workflow', 'select', changeDir, '--mode', 'hotfix',
      '--confirm', '--reason', 'recoverable selection', '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    result = runSsf(['workflow', 'show', changeDir, '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.status, 'selected');
  });

  it('rejects a missing state file without creating a ghost state', () => {
    rmSync(join(changeDir, '.spec-superflow.yaml'));
    const result = recommend();
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /state init/i);
    assert.equal(existsSync(join(changeDir, '.spec-superflow.yaml')), false);
    assert.equal(existsSync(getOverlayPaths(changeDir).workflowSelection), false);
  });

  it('rejects invalid count and enum input with usage exit code before writing a receipt', () => {
    for (const args of [
      ['--task-count', '-1'],
      ['--file-count', 'one'],
      ['--config-doc-only', 'maybe'],
      ['--schema-api-change', 'sometimes'],
      ['--new-module', 'possibly'],
      ['--uncertainty', 'medium'],
    ]) {
      const result = recommend(args);
      assert.equal(result.exitCode, 2, `${args.join(' ')}: ${result.stderr}`);
    }
    assert.equal(existsSync(getOverlayPaths(changeDir).workflowSelection), false);
  });

  it('rejects unsafe and overflowing counts without mutating receipt or state', () => {
    assert.equal(recommend().exitCode, 0);
    for (const count of ['9007199254740992', '9'.repeat(400)]) {
      const before = snapshotWorkflowFiles();
      const result = recommend(['--task-count', count]);
      assert.equal(result.exitCode, 2, `${count}: ${result.stderr}`);
      assert.match(result.stderr, /non-negative integer/i);
      assertWorkflowFilesUnchanged(before);
    }
  });

  it('rejects extra positionals without mutating receipt or state', () => {
    let before = snapshotWorkflowFiles();
    const malformedRecommend = runSsf(['workflow', 'recommend', changeDir, 'extra',
      '--task-count', '2', '--file-count', '2', '--config-doc-only', 'no',
      '--schema-api-change', 'no', '--new-module', 'no', '--uncertainty', 'low']);
    assert.equal(malformedRecommend.exitCode, 2, malformedRecommend.stderr);
    assertWorkflowFilesUnchanged(before);

    assert.equal(recommend().exitCode, 0);
    before = snapshotWorkflowFiles();
    const malformedSelect = runSsf(['workflow', 'select', changeDir, '--mode', 'hotfix',
      '--confirm', '--reason', 'bounded', 'code', 'fix', '--json']);
    assert.equal(malformedSelect.exitCode, 2, malformedSelect.stderr);
    assertWorkflowFilesUnchanged(before);
  });

  it('preserves scope and artifact language while replacing the workflow summary idempotently', () => {
    writeState([
      'state: exploring',
      'workflow: auto',
      'dp_0_decisions: scope=issue 70 | artifact_language=zh-CN | workflow_path=full; recommended=full; followed_recommendation=true',
      '',
    ].join('\n'));
    assert.equal(recommend().exitCode, 0);
    const selected = runSsf(['workflow', 'select', changeDir, '--mode', 'hotfix',
      '--confirm', '--reason', 'bounded code fix', '--json']);
    assert.equal(selected.exitCode, 0, selected.stderr);
    const decisions = readState(changeDir).dp_0_decisions;
    assert.match(decisions, /scope=issue 70/);
    assert.match(decisions, /artifact_language=zh-CN/);
    assert.equal((decisions.match(/workflow_path=/g) ?? []).length, 1);
    assert.match(decisions, /workflow_path=hotfix; recommended=hotfix; followed_recommendation=true/);
  });
});
