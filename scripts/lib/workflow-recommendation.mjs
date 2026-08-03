import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { getOverlayPaths } from './sdd-overlay.mjs';

export const WORKFLOW_MODES = Object.freeze(['full', 'hotfix', 'tweak', 'quick', 'lightweight']);

const BOOLEAN_FACTS = ['config_doc_only', 'schema_api_change', 'new_module', 'behavioral_constraint_change', 'cross_module_change'];
const FACT_KEYS = ['task_count', 'file_count', ...BOOLEAN_FACTS, 'uncertainty'];
const LIGHTWEIGHT_EXCLUSION_KEYS = [
  'production_behavior',
  'public_boundary',
  'installer',
  'state_machine',
  'external_side_effect',
  'data_permission_config_semantics',
  'expected_behavior_clear',
  'verification_reproducible',
  'impact_paths_complete',
];
const LIGHTWEIGHT_PATH_PREFIXES = ['tests/', 'docs/', 'test-support/'];

export function normalizeWorkflowFacts(input = {}) {
  return {
    task_count: normalizeCount(input.task_count),
    file_count: normalizeCount(input.file_count),
    config_doc_only: normalizeEnum(input.config_doc_only, ['yes', 'no', 'unknown']),
    schema_api_change: normalizeEnum(input.schema_api_change, ['yes', 'no', 'unknown']),
    new_module: normalizeEnum(input.new_module, ['yes', 'no', 'unknown']),
    behavioral_constraint_change: normalizeEnum(input.behavioral_constraint_change, ['yes', 'no', 'unknown']),
    cross_module_change: normalizeEnum(input.cross_module_change, ['yes', 'no', 'unknown']),
    uncertainty: normalizeEnum(input.uncertainty, ['low', 'high', 'unknown']),
    request_kind: normalizeRequestKind(input.request_kind),
    affected_paths: normalizeAffectedPaths(input.affected_paths),
    exclusion_checks: normalizeExclusionChecks(input.exclusion_checks),
  };
}

function normalizeRequestKind(value) {
  if (value === null || value === undefined) return 'standard';
  if (!['standard', 'incident'].includes(value)) throw new Error('invalid request_kind value');
  return value;
}

export function recommendWorkflowPath(input = {}) {
  const facts = normalizeWorkflowFacts(input);
  const missing_facts = FACT_KEYS.filter((key) => facts[key] === null || facts[key] === 'unknown');
  const base = { available_modes: [...WORKFLOW_MODES], facts, missing_facts };

  if (missing_facts.length) {
    return { ...base, status: 'needs-input', recommendation: null };
  }
  const riskReasons = riskReasonsFor(facts);
  if (riskReasons.length) {
    return ready(base, 'full', 'Risk signals require the user to choose Quick or Full.', riskReasons);
  }
  const lightweight = assessLightweightEligibility(facts);
  if (lightweight.considered && !lightweight.eligible) {
    return ready(base, 'full', 'Lightweight execution requires complete proof of a low-risk internal change.', lightweight.reasons);
  }
  if (facts.config_doc_only === 'yes' && facts.task_count <= 4 && facts.file_count <= 4) {
    return ready(base, 'tweak', 'Config/doc-only work is within the tweak thresholds.');
  }
  if (facts.request_kind === 'incident' && facts.config_doc_only === 'no'
    && facts.task_count <= 2 && facts.file_count <= 2) {
    return ready(base, 'hotfix', 'Bounded incident work is within the hotfix thresholds.');
  }
  if (lightweight.eligible) {
    return ready(base, 'lightweight', 'The change is proven to be low-risk internal test, documentation, or test-support work.');
  }
  if (facts.config_doc_only === 'no' && facts.task_count <= 3 && facts.file_count <= 3) {
    return ready(base, 'quick', 'Bounded low-risk code work is within the quick thresholds.');
  }
  return ready(base, 'full', 'The observed scope exceeds the fast-path thresholds.');
}

export function saveWorkflowRecommendation(changeDir, facts) {
  const recommendation = recommendWorkflowPath(facts);
  const record = withHash({
    schema_version: 2,
    ...recommendation,
    created_at: new Date().toISOString(),
    selection: null,
  });
  writeRecord(changeDir, record);
  return record;
}

export function readWorkflowSelection(changeDir) {
  const path = getOverlayPaths(changeDir).workflowSelection;
  if (!existsSync(path)) {
    return {
      exists: false,
      valid: false,
      record: null,
      failures: ['workflow recommendation is missing'],
    };
  }
  try {
    const rawRecord = JSON.parse(readFileSync(path, 'utf8'));
    const valid = rawRecord.hash === hashRecord(rawRecord);
    const record = valid ? normalizeLegacyRecord(rawRecord) : rawRecord;
    return {
      exists: true,
      valid,
      record,
      failures: valid ? [] : ['workflow recommendation hash mismatch'],
    };
  } catch (error) {
    return {
      exists: true,
      valid: false,
      record: null,
      failures: [error.message],
    };
  }
}

function normalizeLegacyRecord(record) {
  if (record?.facts) {
    return {
      ...record,
      facts: {
        ...record.facts,
        request_kind: record.facts.request_kind ?? 'standard',
        behavioral_constraint_change: record.facts.behavioral_constraint_change ?? 'no',
        cross_module_change: record.facts.cross_module_change ?? 'no',
        affected_paths: record.facts.affected_paths ?? null,
        exclusion_checks: record.facts.exclusion_checks ?? normalizeExclusionChecks(),
      },
    };
  }
  return record;
}

export function recordWorkflowSelection(changeDir, {
  mode,
  reason,
  confirmed,
  acknowledged,
  verificationStrategy,
  scopeConfirmation,
}) {
  const loaded = readWorkflowSelection(changeDir);
  if (!loaded.valid) throw new Error(loaded.failures.join('; '));
  if (loaded.record.status !== 'ready' || !loaded.record.recommendation) {
    throw new Error('workflow recommendation needs more input');
  }
  if (!WORKFLOW_MODES.includes(mode)) throw new Error(`invalid workflow mode: ${mode}`);
  if (confirmed !== true) throw new Error('workflow selection requires --confirm');
  if (!isSafeReason(reason)) {
    throw new Error('workflow selection reason must be non-empty single-line text');
  }
  const followed = mode === loaded.record.recommendation.mode;
  if (!followed && acknowledged !== true) {
    throw new Error('non-recommended workflow selection requires acknowledgement');
  }
  const riskOverride = mode === 'quick' && loaded.record.recommendation.mode !== 'quick';
  assertModeEligible(mode, loaded.record.facts);
  if (riskOverride && !isVerificationStrategy(verificationStrategy)) {
    throw new Error('risk-acknowledged Quick selection requires --verification tdd|new-test|bounded');
  }
  if (mode === 'lightweight' && !isVerificationStrategy(verificationStrategy)) {
    throw new Error('lightweight selection requires --verification tdd|new-test|bounded');
  }
  if (mode === 'lightweight' && !isSafeReason(scopeConfirmation)) {
    throw new Error('lightweight selection requires a non-empty single-line scope confirmation');
  }
  const confirmedAt = new Date().toISOString();
  const selected = withHash({
    ...withoutHash(loaded.record),
    selection: {
      mode,
      reason,
      followed_recommendation: followed,
      acknowledged_non_recommendation: !followed && acknowledged === true,
      accepted_automatically: false,
      risk_override: riskOverride,
      verification_strategy: verificationStrategy ?? (mode === 'quick' ? 'bounded' : null),
      scope_confirmation: mode === 'lightweight' ? scopeConfirmation : null,
      verification_result: null,
      escalation_reason: null,
      confirmed_at: confirmedAt,
      selected_at: confirmedAt,
    },
  });
  writeRecord(changeDir, selected);
  return selected;
}

export function recordLightweightCompletionEvidence(changeDir, {
  focusedReview,
  verificationCommand,
  verificationResult,
}) {
  const loaded = readWorkflowSelection(changeDir);
  if (!loaded.valid) throw new Error(loaded.failures.join('; '));
  const selection = loaded.record.selection;
  if (selection?.mode !== 'lightweight' || loaded.record.recommendation?.mode !== 'lightweight') {
    throw new Error('lightweight completion evidence requires a selected lightweight receipt');
  }
  if (selection.completion !== null && selection.completion !== undefined) {
    throw new Error('lightweight completion evidence is already recorded; a second focused review is not allowed');
  }
  if (!isSafeReason(focusedReview)) {
    throw new Error('lightweight focused review must be non-empty single-line text');
  }
  if (!isSafeReason(verificationCommand)) {
    throw new Error('lightweight verification command must be non-empty single-line text');
  }
  const result = String(verificationResult ?? '').trim().toLowerCase();
  if (result !== 'pass') {
    throw new Error('lightweight completion verification result must be pass');
  }

  const recordedAt = new Date().toISOString();
  const updated = withHash({
    ...withoutHash(loaded.record),
    selection: {
      ...selection,
      completion: {
        focused_review: focusedReview,
        verification: {
          command: verificationCommand,
          result,
        },
        recorded_at: recordedAt,
      },
    },
  });
  writeRecord(changeDir, updated);
  return updated;
}

export function hasLightweightCompletionEvidence(record) {
  const completion = record?.selection?.completion;
  return record?.selection?.mode === 'lightweight'
    && isSafeReason(completion?.focused_review)
    && isSafeReason(completion?.verification?.command)
    && completion?.verification?.result === 'pass'
    && isIsoTimestamp(completion?.recorded_at);
}

export function escalateLightweightWorkflow(changeDir, { reason }) {
  const loaded = readWorkflowSelection(changeDir);
  if (!loaded.valid) throw new Error(loaded.failures.join('; '));
  const selection = loaded.record.selection;
  if (selection?.mode !== 'lightweight') {
    throw new Error('only an active lightweight workflow can be escalated');
  }
  if (!isSafeReason(reason)) {
    throw new Error('lightweight escalation requires a non-empty single-line reason');
  }

  const escalatedAt = new Date().toISOString();
  const escalated = withHash({
    ...withoutHash(loaded.record),
    selection: {
      ...selection,
      mode: 'full',
      reason: `Escalated from lightweight: ${reason}`,
      followed_recommendation: false,
      acknowledged_non_recommendation: false,
      risk_override: false,
      escalation_reason: reason,
      escalated_from: 'lightweight',
      escalated_at: escalatedAt,
      selected_at: escalatedAt,
    },
  });
  writeRecord(changeDir, escalated);
  return escalated;
}

export function acceptWorkflowRecommendation(changeDir, { source, verificationStrategy }) {
  const loaded = readWorkflowSelection(changeDir);
  if (!loaded.valid) throw new Error(loaded.failures.join('; '));
  const recommendation = loaded.record.recommendation;
  if (loaded.record.status !== 'ready' || !recommendation) {
    throw new Error('workflow recommendation needs more input');
  }
  if (!['quick', 'hotfix'].includes(recommendation.mode)) {
    throw new Error('only a recommended quick or hotfix workflow can be accepted directly');
  }
  if (recommendation.mode === 'hotfix' && loaded.record.facts.request_kind !== 'incident') {
    throw new Error('direct hotfix acceptance requires an incident request');
  }
  if (source !== 'direct-request') {
    throw new Error('workflow acceptance source must be direct-request');
  }
  if (!isVerificationStrategy(verificationStrategy)) {
    throw new Error('workflow acceptance verification must be tdd, new-test, or bounded');
  }

  const accepted = withHash({
    ...withoutHash(loaded.record),
    selection: {
      mode: recommendation.mode,
      source,
      followed_recommendation: true,
      acknowledged_non_recommendation: false,
      accepted_automatically: true,
      risk_override: false,
      verification_strategy: verificationStrategy,
      selected_at: new Date().toISOString(),
    },
  });
  writeRecord(changeDir, accepted);
  return accepted;
}

export function isDirectWorkflowReceipt(record, state) {
  const selection = record?.selection;
  const mode = selection?.mode;
  if (!['quick', 'hotfix', 'lightweight'].includes(mode) || state?.workflow !== mode) return false;
  if (record?.status !== 'ready') return false;
  if (mode === 'lightweight') {
    return record?.recommendation?.mode === 'lightweight'
      && selection.accepted_automatically === false
      && isSafeReason(selection.scope_confirmation)
      && isVerificationStrategy(selection.verification_strategy)
      && isIsoTimestamp(selection.confirmed_at)
      && assessLightweightEligibility(record.facts).eligible;
  }
  const directAcceptance = record?.recommendation?.mode === mode
    && selection.accepted_automatically === true && selection.source === 'direct-request';
  const acknowledgedQuick = mode === 'quick' && selection.accepted_automatically === false
    && selection.risk_override === true && isVerificationStrategy(selection.verification_strategy);
  if (!directAcceptance && !acknowledgedQuick) return false;
  return mode !== 'hotfix' || record?.facts?.request_kind === 'incident';
}

function ready(base, mode, reason, riskReasons = []) {
  return { ...base, status: 'ready', recommendation: { mode, reasons: [reason], risk_reasons: riskReasons } };
}

function riskReasonsFor(facts) {
  const reasons = [];
  if (facts.behavioral_constraint_change === 'yes') reasons.push('behavioral constraint changed (PRD, spec, design, data, or permission)');
  if (facts.schema_api_change === 'yes') reasons.push('schema or API changes');
  if (facts.new_module === 'yes') reasons.push('new module');
  if (facts.cross_module_change === 'yes') reasons.push('cross-module change');
  if (facts.uncertainty === 'high') reasons.push('high uncertainty');
  return reasons;
}

function assessLightweightEligibility(facts) {
  const checks = facts.exclusion_checks;
  const paths = facts.affected_paths;
  const considered = paths !== null || LIGHTWEIGHT_EXCLUSION_KEYS.some(key => checks[key] !== 'unknown');
  if (!considered) return { considered: false, eligible: false, reasons: [] };

  const reasons = [];
  if (!Array.isArray(paths) || paths.length === 0) {
    reasons.push('affected paths cannot be proven');
  } else {
    const nonInternal = paths.filter(path => !isLightweightPath(path));
    if (nonInternal.length) reasons.push(`affected paths are outside tests/docs/test-support: ${nonInternal.join(', ')}`);
  }
  for (const key of LIGHTWEIGHT_EXCLUSION_KEYS) {
    const value = checks[key];
    const required = ['expected_behavior_clear', 'verification_reproducible', 'impact_paths_complete'].includes(key) ? 'yes' : 'no';
    if (value === 'unknown') reasons.push(`${key} cannot be proven`);
    else if (value !== required) reasons.push(`${key}=${value}`);
  }
  return { considered: true, eligible: reasons.length === 0, reasons };
}

function isVerificationStrategy(value) {
  return ['tdd', 'new-test', 'bounded'].includes(value);
}

function assertModeEligible(mode, facts) {
  const riskReasons = riskReasonsFor(facts);
  if (mode === 'quick' && (facts.task_count > 3 || facts.file_count > 3 || facts.config_doc_only !== 'no')) {
    throw new Error('Quick is limited to at most 3 non-document code tasks/files; split the change or choose Full');
  }
  if (mode === 'tweak' && (facts.task_count > 4 || facts.file_count > 4
    || facts.config_doc_only !== 'yes' || riskReasons.length > 0)) {
    throw new Error('Tweak requires at most 4 config/doc-only tasks/files with no risk signals; choose Full');
  }
  if (mode === 'hotfix' && (facts.request_kind !== 'incident' || facts.task_count > 2
    || facts.file_count > 2 || facts.config_doc_only !== 'no' || riskReasons.length > 0)) {
    throw new Error('Hotfix requires an incident with at most 2 non-document tasks/files and no risk signals; choose Full');
  }
  if (mode === 'lightweight') {
    const lightweight = assessLightweightEligibility(facts);
    if (!lightweight.eligible) {
      throw new Error(`Lightweight requires complete proof of low-risk internal work; ${lightweight.reasons.join('; ')}`);
    }
  }
}

function normalizeCount(value) {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('task_count and file_count must be non-negative integers');
  }
  return value;
}

function normalizeEnum(value, allowed) {
  if (value === null || value === undefined) return 'unknown';
  if (!allowed.includes(value)) throw new Error(`invalid workflow fact value: ${value}`);
  return value;
}

function normalizeAffectedPaths(value) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0 || value.some(path => typeof path !== 'string' || path.length === 0)) {
    throw new Error('affected_paths must be a non-empty array of paths');
  }
  return [...value];
}

function normalizeExclusionChecks(value = {}) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('exclusion_checks must be an object');
  }
  const result = {};
  for (const key of LIGHTWEIGHT_EXCLUSION_KEYS) {
    result[key] = normalizeEnum(value[key], ['yes', 'no', 'unknown']);
  }
  return result;
}

function isLightweightPath(path) {
  return !path.startsWith('/') && !path.split('/').includes('..')
    && LIGHTWEIGHT_PATH_PREFIXES.some(prefix => path.startsWith(prefix));
}

function withoutHash(record) {
  const { hash, ...content } = record;
  return content;
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function hashRecord(record) {
  return `sha256:${createHash('sha256').update(stableJson(withoutHash(record))).digest('hex')}`;
}

function withHash(content) {
  const record = { ...content };
  return { ...record, hash: hashRecord(record) };
}

function writeRecord(changeDir, record) {
  const target = getOverlayPaths(changeDir).workflowSelection;
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  renameSync(temporary, target);
}

function isSafeReason(value) {
  return typeof value === 'string'
    && value.trim().length > 0
    && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value);
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && Number.isFinite(Date.parse(value));
}
