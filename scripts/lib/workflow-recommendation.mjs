import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { getOverlayPaths } from './sdd-overlay.mjs';

export const WORKFLOW_MODES = Object.freeze(['full', 'hotfix', 'tweak', 'quick']);

const BOOLEAN_FACTS = ['config_doc_only', 'schema_api_change', 'new_module', 'behavioral_constraint_change', 'cross_module_change'];
const FACT_KEYS = ['task_count', 'file_count', ...BOOLEAN_FACTS, 'uncertainty'];

export function normalizeWorkflowFacts(input = {}) {
  return {
    task_count: normalizeCount(input.task_count),
    file_count: normalizeCount(input.file_count),
    config_doc_only: normalizeEnum(input.config_doc_only, ['yes', 'no', 'unknown']),
    schema_api_change: normalizeEnum(input.schema_api_change, ['yes', 'no', 'unknown']),
    new_module: normalizeEnum(input.new_module, ['yes', 'no', 'unknown']),
    // These are intentionally optional for legacy callers. Agents MUST set them when
    // the request reveals a requirement/spec/design or cross-module impact.
    behavioral_constraint_change: normalizeEnum(input.behavioral_constraint_change ?? 'no', ['yes', 'no', 'unknown']),
    cross_module_change: normalizeEnum(input.cross_module_change ?? 'no', ['yes', 'no', 'unknown']),
    uncertainty: normalizeEnum(input.uncertainty, ['low', 'high', 'unknown']),
    request_kind: normalizeRequestKind(input.request_kind),
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
  if (facts.config_doc_only === 'yes' && facts.task_count <= 4 && facts.file_count <= 4) {
    return ready(base, 'tweak', 'Config/doc-only work is within the tweak thresholds.');
  }
  if (facts.request_kind === 'incident' && facts.config_doc_only === 'no'
    && facts.task_count <= 2 && facts.file_count <= 2) {
    return ready(base, 'hotfix', 'Bounded incident work is within the hotfix thresholds.');
  }
  if (facts.config_doc_only === 'no' && facts.task_count <= 3 && facts.file_count <= 3) {
    return ready(base, 'quick', 'Bounded low-risk code work is within the quick thresholds.');
  }
  return ready(base, 'full', 'The observed scope exceeds the fast-path thresholds.');
}

export function saveWorkflowRecommendation(changeDir, facts) {
  const recommendation = recommendWorkflowPath(facts);
  const record = withHash({
    schema_version: 1,
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
  if (record?.facts && !Object.hasOwn(record.facts, 'request_kind')) {
    return {
      ...record,
      facts: { ...record.facts, request_kind: 'standard' },
    };
  }
  return record;
}

export function recordWorkflowSelection(changeDir, { mode, reason, confirmed, acknowledged, verificationStrategy }) {
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
  if (mode === 'quick' && (loaded.record.facts.task_count > 3 || loaded.record.facts.file_count > 3
    || loaded.record.facts.config_doc_only === 'yes')) {
    throw new Error('Quick is limited to at most 3 non-document code tasks/files; split the change or choose Full');
  }
  if (riskOverride && !isVerificationStrategy(verificationStrategy)) {
    throw new Error('risk-acknowledged Quick selection requires --verification tdd|new-test|bounded');
  }
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
      selected_at: new Date().toISOString(),
    },
  });
  writeRecord(changeDir, selected);
  return selected;
}

export function acceptWorkflowRecommendation(changeDir, { source, verificationStrategy = 'bounded' }) {
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
  if (!['quick', 'hotfix'].includes(mode) || state?.workflow !== mode) return false;
  if (record?.status !== 'ready') return false;
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

function isVerificationStrategy(value) {
  return ['tdd', 'new-test', 'bounded'].includes(value);
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
