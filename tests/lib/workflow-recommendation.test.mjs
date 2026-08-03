import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  acceptWorkflowRecommendation,
  escalateLightweightWorkflow,
  recommendWorkflowPath,
  recordWorkflowSelection,
  readWorkflowSelection,
  saveWorkflowRecommendation,
  WORKFLOW_MODES,
} from '../../scripts/lib/workflow-recommendation.mjs';
import { getOverlayPaths } from '../../scripts/lib/sdd-overlay.mjs';

const base = {
  task_count: 2,
  file_count: 2,
  config_doc_only: 'no',
  schema_api_change: 'no',
  new_module: 'no',
  behavioral_constraint_change: 'no',
  cross_module_change: 'no',
  uncertainty: 'low',
};

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function hashRecord(record) {
  const { hash, ...content } = record;
  return `sha256:${createHash('sha256').update(stableJson(content)).digest('hex')}`;
}

describe('workflow path recommendation', () => {
  it('recommends and persists a confirmed lightweight internal change', () => {
    const changeDir = mkdtempSync(join(tmpdir(), 'ssf-workflow-lightweight-'));
    const lightweightFacts = {
      ...base,
      affected_paths: ['tests/lib/workflow-recommendation.test.mjs', 'tests/helpers/workflow-fixture.mjs'],
      exclusion_checks: {
        production_behavior: 'no',
        public_boundary: 'no',
        installer: 'no',
        state_machine: 'no',
        external_side_effect: 'no',
        data_permission_config_semantics: 'no',
        expected_behavior_clear: 'yes',
        verification_reproducible: 'yes',
        impact_paths_complete: 'yes',
      },
    };
    try {
      const recommendation = saveWorkflowRecommendation(changeDir, lightweightFacts);
      assert.equal(recommendation.recommendation.mode, 'lightweight');

      const selected = recordWorkflowSelection(changeDir, {
        mode: 'lightweight',
        reason: 'remove repeated internal test setup',
        scopeConfirmation: 'affected paths and exclusions reviewed once',
        verificationStrategy: 'new-test',
        confirmed: true,
        acknowledged: false,
      });

      assert.equal(selected.selection.mode, 'lightweight');
      assert.deepEqual(selected.facts.affected_paths, lightweightFacts.affected_paths);
      assert.equal(selected.selection.scope_confirmation, 'affected paths and exclusions reviewed once');
      assert.equal(selected.selection.verification_strategy, 'new-test');
      assert.match(selected.selection.confirmed_at, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(readWorkflowSelection(changeDir).record.selection.mode, 'lightweight');
    } finally {
      rmSync(changeDir, { recursive: true, force: true });
    }
  });

  it('routes incomplete or excluded lightweight evidence to Full', () => {
    const incomplete = recommendWorkflowPath({
      ...base,
      affected_paths: ['tests/lib/workflow-recommendation.test.mjs'],
      exclusion_checks: { production_behavior: 'no' },
    });
    assert.equal(incomplete.recommendation.mode, 'full');
    assert.match(incomplete.recommendation.risk_reasons.join(' '), /cannot be proven/i);

    const safeChecks = {
      production_behavior: 'no',
      public_boundary: 'no',
      installer: 'no',
      state_machine: 'no',
      external_side_effect: 'no',
      data_permission_config_semantics: 'no',
      expected_behavior_clear: 'yes',
      verification_reproducible: 'yes',
      impact_paths_complete: 'yes',
    };
    for (const [excludedCheck, value] of Object.entries({
      production_behavior: 'yes',
      public_boundary: 'yes',
      installer: 'yes',
      state_machine: 'yes',
      external_side_effect: 'yes',
      data_permission_config_semantics: 'yes',
      expected_behavior_clear: 'no',
      verification_reproducible: 'no',
      impact_paths_complete: 'no',
    })) {
      const excluded = recommendWorkflowPath({
        ...base,
        affected_paths: ['tests/lib/workflow-recommendation.test.mjs'],
        exclusion_checks: { ...safeChecks, [excludedCheck]: value },
      });
      assert.equal(excluded.recommendation.mode, 'full', excludedCheck);
      assert.match(excluded.recommendation.risk_reasons.join(' '), new RegExp(excludedCheck));
    }
  });

  it('records a discovered lightweight risk before routing the receipt to Full', () => {
    const changeDir = mkdtempSync(join(tmpdir(), 'ssf-workflow-escalation-'));
    const lightweightFacts = {
      ...base,
      affected_paths: ['tests/lib/workflow-recommendation.test.mjs'],
      exclusion_checks: {
        production_behavior: 'no',
        public_boundary: 'no',
        installer: 'no',
        state_machine: 'no',
        external_side_effect: 'no',
        data_permission_config_semantics: 'no',
        expected_behavior_clear: 'yes',
        verification_reproducible: 'yes',
        impact_paths_complete: 'yes',
      },
    };
    try {
      saveWorkflowRecommendation(changeDir, lightweightFacts);
      recordWorkflowSelection(changeDir, {
        mode: 'lightweight',
        reason: 'internal test refactor',
        scopeConfirmation: 'affected paths and exclusions reviewed once',
        verificationStrategy: 'new-test',
        confirmed: true,
        acknowledged: false,
      });

      const escalated = escalateLightweightWorkflow(changeDir, {
        reason: 'public CLI behavior is now affected',
      });

      assert.equal(escalated.selection.mode, 'full');
      assert.equal(escalated.selection.escalated_from, 'lightweight');
      assert.equal(escalated.selection.escalation_reason, 'public CLI behavior is now affected');
      assert.match(escalated.selection.escalated_at, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(readWorkflowSelection(changeDir).record.selection.mode, 'full');
    } finally {
      rmSync(changeDir, { recursive: true, force: true });
    }
  });

  it('recommends quick for a bounded low-risk code change', () => {
    const result = recommendWorkflowPath({ ...base, task_count: 3, file_count: 3 });
    assert.equal(result.recommendation.mode, 'quick');
    assert.deepEqual(result.available_modes, ['full', 'hotfix', 'tweak', 'quick', 'lightweight']);
  });

  it('recommends hotfix only for a bounded incident', () => {
    const result = recommendWorkflowPath({ ...base, request_kind: 'incident' });
    assert.equal(result.recommendation.mode, 'hotfix');
    assert.equal(result.facts.request_kind, 'incident');
  });

  it('accepts a recommended quick path without a confirmation reason', () => {
    const changeDir = mkdtempSync(join(tmpdir(), 'ssf-workflow-accept-'));
    try {
      saveWorkflowRecommendation(changeDir, base);
      const accepted = acceptWorkflowRecommendation(changeDir, {
        source: 'direct-request', verificationStrategy: 'bounded',
      });
      assert.equal(accepted.selection.mode, 'quick');
      assert.equal(accepted.selection.accepted_automatically, true);
      assert.equal(accepted.selection.source, 'direct-request');
    } finally {
      rmSync(changeDir, { recursive: true, force: true });
    }
  });

  it('reads a valid legacy receipt without request_kind as standard', () => {
    const changeDir = mkdtempSync(join(tmpdir(), 'ssf-workflow-legacy-'));
    try {
      const legacy = {
        schema_version: 1,
        available_modes: ['full', 'hotfix', 'tweak'],
        facts: { ...base },
        missing_facts: [],
        status: 'ready',
        recommendation: { mode: 'hotfix', reasons: ['legacy bounded code work'] },
        created_at: '2026-07-01T00:00:00.000Z',
        selection: null,
      };
      legacy.hash = hashRecord(legacy);
      const receiptPath = getOverlayPaths(changeDir).workflowSelection;
      mkdirSync(dirname(receiptPath), { recursive: true });
      writeFileSync(receiptPath, JSON.stringify(legacy), 'utf8');
      const loaded = readWorkflowSelection(changeDir);
      assert.equal(loaded.valid, true);
      assert.equal(loaded.record.facts.request_kind, 'standard');
      assert.throws(
        () => acceptWorkflowRecommendation(changeDir, { source: 'direct-request' }),
        /incident/i,
      );
    } finally {
      rmSync(changeDir, { recursive: true, force: true });
    }
  });

  it('recommends quick for a bounded standard code change', () => {
    const result = recommendWorkflowPath(base);
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.available_modes, WORKFLOW_MODES);
    assert.equal(result.recommendation.mode, 'quick');
  });

  it('recommends tweak for a small config/doc-only change', () => {
    const result = recommendWorkflowPath({ ...base, task_count: 4, file_count: 4, config_doc_only: 'yes' });
    assert.equal(result.recommendation.mode, 'tweak');
  });

  it('recommends full for risk, uncertainty, or threshold overflow', () => {
    for (const facts of [
      { ...base, schema_api_change: 'yes' },
      { ...base, new_module: 'yes' },
      { ...base, uncertainty: 'high' },
      { ...base, task_count: 4 },
    ]) assert.equal(recommendWorkflowPath(facts).recommendation.mode, 'full');
  });

  it('returns needs-input instead of full when facts are unknown', () => {
    const result = recommendWorkflowPath({ ...base, file_count: null, new_module: 'unknown' });
    assert.equal(result.status, 'needs-input');
    assert.equal(result.recommendation, null);
    assert.deepEqual(result.missing_facts, ['file_count', 'new_module']);
  });

  it('requires new behavioral and cross-module facts instead of assuming no risk', () => {
    const result = recommendWorkflowPath({
      ...base,
      behavioral_constraint_change: undefined,
      cross_module_change: undefined,
    });
    assert.equal(result.status, 'needs-input');
    assert.deepEqual(result.missing_facts, ['behavioral_constraint_change', 'cross_module_change']);
  });

  it('persists a hashed recommendation and detects tampering', () => {
    const changeDir = mkdtempSync(join(tmpdir(), 'ssf-workflow-recommend-'));
    try {
      const saved = saveWorkflowRecommendation(changeDir, base);
      assert.match(saved.hash, /^sha256:/);
      assert.equal(readWorkflowSelection(changeDir).valid, true);
      const file = getOverlayPaths(changeDir).workflowSelection;
      const tampered = JSON.parse(readFileSync(file, 'utf8'));
      tampered.facts.file_count = 99;
      writeFileSync(file, JSON.stringify(tampered));
      assert.equal(readWorkflowSelection(changeDir).valid, false);
    } finally {
      rmSync(changeDir, { recursive: true, force: true });
    }
  });

  it('requires acknowledgement for a non-recommended selection', () => {
    const changeDir = mkdtempSync(join(tmpdir(), 'ssf-workflow-select-'));
    try {
      saveWorkflowRecommendation(changeDir, base);
      assert.throws(() => recordWorkflowSelection(changeDir, {
        mode: 'full', reason: 'operator preference', confirmed: true, acknowledged: false,
      }), /acknowledge/i);
      const selected = recordWorkflowSelection(changeDir, {
        mode: 'full', reason: 'operator preference', confirmed: true, acknowledged: true,
      });
      assert.equal(selected.selection.followed_recommendation, false);
    } finally {
      rmSync(changeDir, { recursive: true, force: true });
    }
  });

  it('requires an acknowledged verification strategy for a risk-acknowledged Quick workflow', () => {
    const changeDir = mkdtempSync(join(tmpdir(), 'ssf-workflow-quick-'));
    try {
      saveWorkflowRecommendation(changeDir, { ...base, behavioral_constraint_change: 'yes' });
      assert.throws(() => recordWorkflowSelection(changeDir, {
        mode: 'quick', reason: 'bounded code', confirmed: true, acknowledged: true,
      }), /verification/i);
      const selected = recordWorkflowSelection(changeDir, {
        mode: 'quick', reason: 'bounded code', confirmed: true, acknowledged: true,
        verificationStrategy: 'bounded',
      });
      assert.equal(selected.selection.risk_override, true);
      assert.equal(selected.selection.verification_strategy, 'bounded');
    } finally {
      rmSync(changeDir, { recursive: true, force: true });
    }
  });

  it('requires a direct Quick acceptance to record the user-selected verification strategy', () => {
    const changeDir = mkdtempSync(join(tmpdir(), 'ssf-workflow-verification-'));
    try {
      saveWorkflowRecommendation(changeDir, base);
      assert.throws(
        () => acceptWorkflowRecommendation(changeDir, { source: 'direct-request' }),
        /verification/i,
      );
    } finally {
      rmSync(changeDir, { recursive: true, force: true });
    }
  });

  it('rejects Tweak when the observed facts are not bounded config/doc-only work', () => {
    const changeDir = mkdtempSync(join(tmpdir(), 'ssf-workflow-tweak-boundary-'));
    try {
      saveWorkflowRecommendation(changeDir, {
        ...base,
        task_count: 5,
        file_count: 5,
        schema_api_change: 'yes',
      });
      assert.throws(() => recordWorkflowSelection(changeDir, {
        mode: 'tweak', reason: 'try to keep it light', confirmed: true, acknowledged: true,
      }), /Tweak.*config\/doc|Tweak.*4/i);
    } finally {
      rmSync(changeDir, { recursive: true, force: true });
    }
  });

  it('rejects Unicode control characters and line separators in selection reasons', () => {
    const changeDir = mkdtempSync(join(tmpdir(), 'ssf-workflow-reason-'));
    try {
      saveWorkflowRecommendation(changeDir, base);
      for (const reason of ['contains\u0085c1 control', 'contains\u2028line separator']) {
        assert.throws(() => recordWorkflowSelection(changeDir, {
          mode: 'hotfix', reason, confirmed: true, acknowledged: false,
        }), /single-line/i);
      }
    } finally {
      rmSync(changeDir, { recursive: true, force: true });
    }
  });
});
