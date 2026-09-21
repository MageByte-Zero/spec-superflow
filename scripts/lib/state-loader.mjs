// scripts/lib/state-loader.mjs — lightweight .spec-superflow.yaml state file reader/writer
import fs from 'node:fs';
import path from 'node:path';

const STATE_FILE = '.spec-superflow.yaml';

export const SETTABLE_FIELDS = [
  'workflow', 'test_result', 'batches_completed', 'spec_merged',
  ...[0, 1, 2, 3, 6, 7].flatMap(n => ['result', 'timestamp', 'decisions', 'confirmed'].map(field => `dp_${n}_${field}`)),
];

const BUILTIN_DEFAULTS = {
  state: 'exploring',
  workflow: 'auto',
  workflow_variant: null,
  completion_outcome: null,
  completion_reason: null,
  revision: null,
  artifacts_hash: null,
  contract_hash: null,
  execution_mode: null,
  execution_plan_hash: null,
  execution_plan_revision: null,
  batches_completed: 0,
  test_result: null,
  spec_merged: false,
  spec_publication_receipt: null,
  change_name: null,
  last_transition: null,
  last_transition_from: null,
  last_transition_to: null,
  ...Object.fromEntries(Array.from({ length: 8 }, (_, n) =>
    ['result', 'timestamp', 'decisions', 'confirmed'].map(field => [`dp_${n}_${field}`, null])).flat()),
};

/**
 * Read state file, merging with built-in defaults.
 * Returns a complete state object even if the file doesn't exist.
 */
export function readState(changeDir) {
  const filePath = path.join(changeDir, STATE_FILE);
  if (!fs.existsSync(filePath)) {
    return { ...BUILTIN_DEFAULTS, change_name: path.basename(changeDir) };
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = parseYaml(raw);
  return { ...BUILTIN_DEFAULTS, ...parsed };
}

/**
 * Write state object to .spec-superflow.yaml.
 */
export function writeState(changeDir, state) {
  const filePath = path.join(changeDir, STATE_FILE);
  const lines = [];
  lines.push('# .spec-superflow.yaml — lightweight state machine');
  lines.push('# Progress and legacy approvals. Recover missing evidence; never infer approval from artifact existence.');
  lines.push('');
  lines.push('# === Core state ===');
  lines.push(`state: ${state.state || 'exploring'}`);
  lines.push(`workflow: ${state.workflow || 'auto'}`);
  lines.push(`workflow_variant: ${state.workflow_variant ?? 'null'}`);
  lines.push(`completion_outcome: ${state.completion_outcome ?? 'null'}`);
  lines.push(`completion_reason: ${state.completion_reason ?? 'null'}`);
  lines.push(`revision: ${state.revision ?? 'null'}`);
  lines.push('');
  lines.push('# === Hashes (fast staleness detection) ===');
  lines.push(`artifacts_hash: ${state.artifacts_hash ?? 'null'}`);
  lines.push(`contract_hash: ${state.contract_hash ?? 'null'}`);
  lines.push('');
  lines.push('# === Execution progress ===');
  lines.push(`execution_mode: ${state.execution_mode ?? 'null'}`);
  lines.push(`execution_plan_hash: ${state.execution_plan_hash ?? 'null'}`);
  lines.push(`execution_plan_revision: ${state.execution_plan_revision ?? 'null'}`);
  lines.push(`batches_completed: ${state.batches_completed ?? 0}`);
  lines.push(`test_result: ${state.test_result ?? 'null'}`);
  lines.push(`spec_merged: ${state.spec_merged ?? false}`);
  lines.push(`spec_publication_receipt: ${state.spec_publication_receipt ?? 'null'}`);
  lines.push('');
  lines.push('# === Metadata ===');
  lines.push(`change_name: ${state.change_name ?? path.basename(changeDir)}`);
  lines.push(`last_transition: ${state.last_transition ?? 'null'}`);
  lines.push(`last_transition_from: ${state.last_transition_from ?? 'null'}`);
  lines.push(`last_transition_to: ${state.last_transition_to ?? 'null'}`);
  lines.push('');
  lines.push('# === Decision points ===');
  for (const field of Object.keys(BUILTIN_DEFAULTS).filter(key => key.startsWith('dp_'))) {
    lines.push(`${field}: ${state[field] ?? 'null'}`);
  }

  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
}

/**
 * Update a single field in the state file.
 */
export function updateField(changeDir, field, value) {
  const state = readState(changeDir);
  state[field] = value;
  writeState(changeDir, state);
}

/**
 * Rebuild state file from artifacts — recomputes hashes.
 * Requires hash functions to be passed in (avoids circular dependency).
 */
export function rebuildState(changeDir, { computeArtifactsHash, computeContractHash }) {
  const state = readState(changeDir);
  const oldArtifactsHash = state.artifacts_hash;
  state.artifacts_hash = computeArtifactsHash(changeDir);
  state.contract_hash = computeContractHash(changeDir);

  // artifacts hash 变化时，清空依赖旧 hash 的 plan 字段
  if (oldArtifactsHash !== state.artifacts_hash) {
    state.revision = null;
    state.execution_plan_hash = null;
    state.execution_plan_revision = null;
  }

  writeState(changeDir, state);
  return state;
}

// Minimal YAML parser — top-level fields only, zero dependencies.
// Handles strings, null, integers. No nested structures needed.
function parseYaml(content) {
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(\w[\w_]*):\s*(.*)/);
    if (match) {
      const val = match[2].trim();
      if (val === 'null' || val === '') {
        result[match[1]] = null;
      } else if (/^\d+$/.test(val)) {
        result[match[1]] = parseInt(val, 10);
      } else {
        result[match[1]] = val;
      }
    }
  }
  return result;
}
