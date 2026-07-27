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
    '--schema-api-change', 'no', '--new-module', 'no',
    '--behavioral-constraint-change', 'no', '--cross-module-change', 'no',
    '--uncertainty', 'low',
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
  it('advertises both direct acceptance and an explicit risk-acknowledged Quick selection', () => {
    const result = runSsf(['--help']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /workflow select .*full\|hotfix\|tweak\|quick/);
    assert.match(result.stdout, /workflow accept <change-dir> --source direct-request/);
  });

  it('accepts a recommended quick path from a direct request without --confirm', () => {
    const recommended = recommend();
    assert.equal(recommended.exitCode, 0, recommended.stderr);
    assert.equal(recommended.json.recommendation.mode, 'quick');

    const accepted = runSsf(['workflow', 'accept', changeDir,
      '--source', 'direct-request', '--verification', 'bounded', '--json']);
    assert.equal(accepted.exitCode, 0, accepted.stderr);
    assert.equal(readState(changeDir).workflow, 'quick');
    assert.equal(accepted.json.record.selection.accepted_automatically, true);
    assert.equal(accepted.json.record.selection.source, 'direct-request');

    const guard = runSsf(['runtime', 'guard', 'check', changeDir, 'exploring', 'approved-for-build', '--workflow', 'quick', '--json']);
    assert.equal(guard.exitCode, 0, guard.stderr);
    assert.equal(guard.json.pass, true);
  });

  it('recommends hotfix for an incident and accepts it without a planning approval', () => {
    const recommended = recommend(['--request-kind', 'incident']);
    assert.equal(recommended.exitCode, 0, recommended.stderr);
    assert.equal(recommended.json.recommendation.mode, 'hotfix');
    const accepted = runSsf(['workflow', 'accept', changeDir, '--source', 'direct-request', '--verification', 'new-test', '--json']);
    assert.equal(accepted.exitCode, 0, accepted.stderr);
    assert.equal(readState(changeDir).workflow, 'hotfix');
    assert.equal(accepted.json.record.selection.verification_strategy, 'new-test');
  });

  it('allows a risk-acknowledged Quick selection only with a user-chosen verification strategy', () => {
    const recommended = recommend(['--behavioral-constraint-change', 'yes']);
    assert.equal(recommended.exitCode, 0, recommended.stderr);
    assert.equal(recommended.json.recommendation.mode, 'full');
    assert.equal(readState(changeDir).workflow, 'auto');

    const rejected = runSsf(['workflow', 'select', changeDir, '--mode', 'quick',
      '--confirm', '--reason', 'bounded code fix', '--acknowledge-recommendation', '--json']);
    assert.equal(rejected.exitCode, 1);
    assert.match(rejected.stderr, /verification/i);

    const selected = runSsf(['workflow', 'select', changeDir, '--mode', 'quick',
      '--confirm', '--reason', 'user accepts the documented API risk',
      '--acknowledge-recommendation', '--verification', 'new-test', '--json']);
    assert.equal(selected.exitCode, 0, selected.stderr);
    assert.equal(selected.json.record.selection.risk_override, true);
    assert.equal(selected.json.record.selection.verification_strategy, 'new-test');
    assert.equal(readState(changeDir).workflow, 'quick');

    const guard = runSsf(['runtime', 'guard', 'check', changeDir, 'exploring', 'approved-for-build', '--workflow', 'quick', '--json']);
    assert.equal(guard.exitCode, 0, guard.stderr);
    assert.equal(guard.json.pass, true);
  });

  it('refreshes a direct Quick recommendation and escalates to Full when risk grows', () => {
    assert.equal(recommend().exitCode, 0);
    assert.equal(runSsf(['workflow', 'accept', changeDir,
      '--source', 'direct-request', '--verification', 'bounded']).exitCode, 0);

    const refreshed = runSsf(['workflow', 'recommend', changeDir,
      '--task-count', '4', '--file-count', '4', '--config-doc-only', 'no',
      '--schema-api-change', 'no', '--new-module', 'no',
      '--behavioral-constraint-change', 'no', '--cross-module-change', 'no',
      '--uncertainty', 'low', '--json']);
    assert.equal(refreshed.exitCode, 0, refreshed.stderr);
    assert.equal(refreshed.json.recommendation.mode, 'full');

    const upgraded = runSsf(['workflow', 'select', changeDir, '--mode', 'full',
      '--confirm', '--reason', 'scope now exceeds Quick boundary', '--json']);
    assert.equal(upgraded.exitCode, 0, upgraded.stderr);
    assert.equal(readState(changeDir).workflow, 'full');
    assert.equal(upgraded.json.record.selection.mode, 'full');
  });

  it('never permits a four-file change to override into Quick', () => {
    const recommended = runSsf(['workflow', 'recommend', changeDir,
      '--task-count', '4', '--file-count', '4', '--config-doc-only', 'no',
      '--schema-api-change', 'no', '--new-module', 'no',
      '--behavioral-constraint-change', 'no', '--cross-module-change', 'no',
      '--uncertainty', 'low', '--json']);
    assert.equal(recommended.exitCode, 0, recommended.stderr);
    assert.equal(recommended.json.recommendation.mode, 'full');

    const selected = runSsf(['workflow', 'select', changeDir, '--mode', 'quick',
      '--confirm', '--reason', 'try to keep this light', '--acknowledge-recommendation',
      '--verification', 'bounded', '--json']);
    assert.equal(selected.exitCode, 1);
    assert.match(selected.stderr, /at most 3/i);
    assert.equal(readState(changeDir).workflow, 'auto');
  });

  it('requires explicit new risk facts before recommending a direct Quick path', () => {
    const result = runSsf(['workflow', 'recommend', changeDir,
      '--task-count', '2', '--file-count', '2', '--config-doc-only', 'no',
      '--schema-api-change', 'no', '--new-module', 'no', '--uncertainty', 'low', '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.status, 'needs-input');
    assert.deepEqual(result.json.missing_facts, ['behavioral_constraint_change', 'cross_module_change']);
  });

  it('never permits a Full recommendation to be downgraded to Tweak', () => {
    const recommended = runSsf(['workflow', 'recommend', changeDir,
      '--task-count', '5', '--file-count', '5', '--config-doc-only', 'no',
      '--schema-api-change', 'yes', '--new-module', 'no',
      '--behavioral-constraint-change', 'no', '--cross-module-change', 'no',
      '--uncertainty', 'low', '--json']);
    assert.equal(recommended.exitCode, 0, recommended.stderr);
    assert.equal(recommended.json.recommendation.mode, 'full');

    const selected = runSsf(['workflow', 'select', changeDir, '--mode', 'tweak',
      '--confirm', '--reason', 'try to keep it light', '--acknowledge-recommendation', '--json']);
    assert.equal(selected.exitCode, 1);
    assert.match(selected.stderr, /Tweak.*config\/doc|Tweak.*4/i);
    assert.equal(readState(changeDir).workflow, 'auto');
  });

  it('shows complete ready recommendations in human-readable recommend and show output', () => {
    const recommended = runSsf(['workflow', 'recommend', changeDir,
      '--task-count', '2', '--file-count', '2', '--config-doc-only', 'no',
      '--schema-api-change', 'no', '--new-module', 'no',
      '--behavioral-constraint-change', 'no', '--cross-module-change', 'no', '--uncertainty', 'low']);
    assert.equal(recommended.exitCode, 0, recommended.stderr);
    assert.match(recommended.stdout, /Observed:/);
    assert.match(recommended.stdout, /Available:.*full.*hotfix.*tweak.*quick/);
    assert.match(recommended.stdout, /Recommended: quick/);
    assert.match(recommended.stdout, /Why:.*bounded low-risk code work/i);

    const shown = runSsf(['workflow', 'show', changeDir]);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.match(shown.stdout, /Observed:/);
    assert.match(shown.stdout, /Available:.*full.*hotfix.*tweak.*quick/);
    assert.match(shown.stdout, /Recommended: quick/);
    assert.match(shown.stdout, /Why:.*bounded low-risk code work/i);
    assert.match(shown.stdout, /Hash valid: true/i);
  });

  it('returns needs-input without changing auto workflow', () => {
    const result = runSsf(['workflow', 'recommend', changeDir,
      '--task-count', '2', '--config-doc-only', 'no', '--schema-api-change', 'unknown',
      '--new-module', 'no', '--behavioral-constraint-change', 'no', '--cross-module-change', 'no',
      '--uncertainty', 'low', '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.status, 'needs-input');
    assert.deepEqual(result.json.missing_facts, ['file_count', 'schema_api_change']);
    assert.equal(readState(changeDir).workflow, 'auto');
  });

  it('restores needs-input context in human and JSON show output', () => {
    const recommended = runSsf(['workflow', 'recommend', changeDir,
      '--task-count', '2', '--config-doc-only', 'no', '--schema-api-change', 'unknown',
      '--new-module', 'no', '--behavioral-constraint-change', 'no', '--cross-module-change', 'no',
      '--uncertainty', 'low', '--json']);
    assert.equal(recommended.exitCode, 0, recommended.stderr);

    const human = runSsf(['workflow', 'show', changeDir]);
    assert.equal(human.exitCode, 0, human.stderr);
    assert.match(human.stdout, /Workflow status: needs-input/i);
    assert.match(human.stdout, /Observed:.*task_count=2.*file_count=null/i);
    assert.match(human.stdout, /Available:.*full.*hotfix.*tweak.*quick/i);
    assert.match(human.stdout, /Missing facts: file_count, schema_api_change/i);
    assert.match(human.stdout, /Hash valid: true/i);

    const json = runSsf(['workflow', 'show', changeDir, '--json']);
    assert.equal(json.exitCode, 0, json.stderr);
    assert.equal(json.json.status, 'needs-input');
    assert.equal(json.json.workflow, 'auto');
    assert.deepEqual(json.json.record.missing_facts, ['file_count', 'schema_api_change']);
    assert.equal(json.json.record.facts.task_count, 2);
    assert.equal(json.json.record.recommendation, null);
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

    const human = runSsf(['workflow', 'show', changeDir]);
    assert.equal(human.exitCode, 0, human.stderr);
    assert.match(human.stdout, /explicitly set to full/i);
    assert.match(human.stdout, /Hash valid: false/i);
    assert.match(human.stdout, /hash mismatch/i);
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

  it('treats a missing receipt as needs-input with all fixed facts missing', () => {
    let result = runSsf(['workflow', 'show', changeDir, '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.status, 'needs-input');
    assert.equal(result.json.source, 'missing-receipt');
    assert.deepEqual(result.json.missing_facts, [
      'task_count', 'file_count', 'config_doc_only', 'schema_api_change',
      'new_module', 'behavioral_constraint_change', 'cross_module_change', 'uncertainty',
    ]);
    assert.deepEqual(result.json.available_modes, ['full', 'hotfix', 'tweak', 'quick']);
    assert.equal(result.json.recommendation, null);
    assert.equal(result.json.receipt.exists, false);

    result = runSsf(['workflow', 'show', changeDir]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Workflow status: needs-input/i);
    assert.match(result.stdout, /Missing facts: task_count, file_count, config_doc_only, schema_api_change, new_module, behavioral_constraint_change, cross_module_change, uncertainty/i);
    assert.match(result.stdout, /Hash valid: unavailable/i);
  });

  it('restores invalid receipt evidence in human and JSON show output', () => {
    saveWorkflowRecommendation(changeDir, {
      task_count: 2, file_count: 2, config_doc_only: 'no', schema_api_change: 'no',
      new_module: 'no', behavioral_constraint_change: 'no', cross_module_change: 'no', uncertainty: 'low',
    });
    const receiptPath = getOverlayPaths(changeDir).workflowSelection;
    const tampered = JSON.parse(readFileSync(receiptPath, 'utf8'));
    tampered.facts.file_count = 99;
    writeFileSync(receiptPath, JSON.stringify(tampered));

    const human = runSsf(['workflow', 'show', changeDir]);
    assert.equal(human.exitCode, 1);
    assert.match(human.stdout, /Workflow status: invalid/i);
    assert.match(human.stdout, /Observed:.*file_count=99/i);
    assert.match(human.stdout, /Available:.*full.*hotfix.*tweak.*quick/i);
    assert.match(human.stdout, /Recommended: quick/i);
    assert.match(human.stdout, /Why:/i);
    assert.match(human.stdout, /Hash valid: false/i);
    assert.match(human.stdout, /hash mismatch/i);

    const json = runSsf(['workflow', 'show', changeDir, '--json']);
    assert.equal(json.exitCode, 1);
    assert.equal(json.json.status, 'invalid');
    assert.equal(json.json.receipt.valid, false);
    assert.equal(json.json.receipt.record.facts.file_count, 99);
    assert.match(json.json.receipt.failures.join(' '), /hash mismatch/i);
  });

  it('restores selection-pending evidence in human and JSON show output', () => {
    saveWorkflowRecommendation(changeDir, {
      task_count: 2, file_count: 2, config_doc_only: 'no', schema_api_change: 'no',
      new_module: 'no', behavioral_constraint_change: 'no', cross_module_change: 'no', uncertainty: 'low',
    });
    recordWorkflowSelection(changeDir, {
      mode: 'full', reason: 'recoverable selection', confirmed: true, acknowledged: true,
    });

    const human = runSsf(['workflow', 'show', changeDir]);
    assert.equal(human.exitCode, 0, human.stderr);
    assert.match(human.stdout, /Workflow status: selection-pending/i);
    assert.match(human.stdout, /Observed:/i);
    assert.match(human.stdout, /Available:.*full.*hotfix.*tweak.*quick/i);
    assert.match(human.stdout, /Recommended: quick/i);
    assert.match(human.stdout, /Why:/i);
    assert.match(human.stdout, /Selection:.*mode=full.*reason=recoverable selection/i);
    assert.match(human.stdout, /Hash valid: true/i);

    const json = runSsf(['workflow', 'show', changeDir, '--json']);
    assert.equal(json.exitCode, 0, json.stderr);
    assert.equal(json.json.status, 'selection-pending');
    assert.equal(json.json.workflow, 'auto');
    assert.equal(json.json.record.selection.mode, 'full');
    assert.equal(json.json.record.selection.reason, 'recoverable selection');
  });

  it('restores directly accepted Quick evidence in human and JSON show output', () => {
    assert.equal(recommend().exitCode, 0);

    let result = runSsf(['workflow', 'accept', changeDir,
      '--source', 'direct-request', '--verification', 'bounded', '--json']);
    assert.equal(result.exitCode, 0, result.stderr);

    const human = runSsf(['workflow', 'show', changeDir]);
    assert.equal(human.exitCode, 0, human.stderr);
    assert.match(human.stdout, /Workflow status: selected/i);
    assert.match(human.stdout, /Observed:/i);
    assert.match(human.stdout, /Available:.*full.*hotfix.*tweak.*quick/i);
    assert.match(human.stdout, /Recommended: quick/i);
    assert.match(human.stdout, /Why:/i);
    assert.match(human.stdout, /Selection:.*mode=quick.*source=direct-request/i);
    assert.match(human.stdout, /Hash valid: true/i);

    result = runSsf(['workflow', 'show', changeDir, '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.status, 'selected');
    assert.equal(result.json.workflow, 'quick');
    assert.equal(result.json.record.selection.mode, 'quick');
    assert.equal(result.json.record.selection.followed_recommendation, true);
  });

  it('initializes a brand-new change before showing all missing workflow facts', () => {
    rmSync(changeDir, { recursive: true, force: true });
    assert.equal(existsSync(changeDir), false);

    const initialized = runSsf(['state', 'init', changeDir, '--json']);
    assert.equal(initialized.exitCode, 0, initialized.stderr);
    const state = readState(changeDir);
    assert.equal(state.workflow, 'auto');
    assert.equal(state.dp_0_confirmed, null);

    const shown = runSsf(['workflow', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.status, 'needs-input');
    assert.deepEqual(shown.json.missing_facts, [
      'task_count', 'file_count', 'config_doc_only', 'schema_api_change',
      'new_module', 'behavioral_constraint_change', 'cross_module_change', 'uncertainty',
    ]);
    assert.equal(readState(changeDir).dp_0_confirmed, null);
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
    const selected = runSsf(['workflow', 'accept', changeDir,
      '--source', 'direct-request', '--verification', 'bounded', '--json']);
    assert.equal(selected.exitCode, 0, selected.stderr);
    const decisions = readState(changeDir).dp_0_decisions;
    assert.match(decisions, /scope=issue 70/);
    assert.match(decisions, /artifact_language=zh-CN/);
    assert.equal((decisions.match(/workflow_path=/g) ?? []).length, 1);
    assert.match(decisions, /workflow_path=quick; recommended=quick; followed_recommendation=true/);
  });
});
