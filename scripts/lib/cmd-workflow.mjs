import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  WORKFLOW_MODES,
  acceptWorkflowRecommendation,
  recommendWorkflowPath,
  readWorkflowSelection,
  recordWorkflowSelection,
  saveWorkflowRecommendation,
} from './workflow-recommendation.mjs';
import { readState, writeState } from './state-loader.mjs';

const OPTIONS = {
  'task-count': { type: 'string' },
  'file-count': { type: 'string' },
  'config-doc-only': { type: 'string' },
  'schema-api-change': { type: 'string' },
  'new-module': { type: 'string' },
  'behavioral-constraint-change': { type: 'string' },
  'cross-module-change': { type: 'string' },
  uncertainty: { type: 'string' },
  'request-kind': { type: 'string' },
  mode: { type: 'string' },
  confirm: { type: 'boolean', default: false },
  reason: { type: 'string' },
  'acknowledge-recommendation': { type: 'boolean', default: false },
  source: { type: 'string' },
  verification: { type: 'string' },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
};

const BOOLEAN_FACTS = {
  'config-doc-only': ['yes', 'no', 'unknown'],
  'schema-api-change': ['yes', 'no', 'unknown'],
  'new-module': ['yes', 'no', 'unknown'],
  'behavioral-constraint-change': ['yes', 'no', 'unknown'],
  'cross-module-change': ['yes', 'no', 'unknown'],
};

const SELECTABLE_WORKFLOW_MODES = Object.freeze(['full', 'hotfix', 'tweak', 'quick']);

class UsageError extends Error {}

export async function run(args) {
  let parsed;
  try {
    parsed = parseArgs({ args, options: OPTIONS, allowPositionals: true });
  } catch (error) {
    return fail(error.message, 2);
  }

  const { positionals, values } = parsed;
  const [subcommand, changeDir] = positionals;
  if (values.help || subcommand === undefined) return printHelp();
  if (!['recommend', 'select', 'accept', 'show'].includes(subcommand)) {
    return fail('Usage: ssf workflow <recommend|select|accept|show> <change-dir>', 2);
  }
  if (positionals.length !== 2 || !changeDir) {
    return fail('Usage: ssf workflow <recommend|select|accept|show> <change-dir>', 2);
  }

  try {
    requireStateFile(changeDir);
    const state = readState(changeDir);

    if (subcommand === 'accept' && isExplicitWorkflow(state.workflow)) {
      return fail('workflow is already explicitly selected', 1);
    }
    if (subcommand === 'select' && isExplicitWorkflow(state.workflow) && !canEscalateToFull(state, values)) {
      return fail('workflow is already explicitly selected', 1);
    }
    if (subcommand === 'recommend' && state.workflow === 'full') {
      return print({ source: 'explicit-state', workflow: state.workflow }, values.json);
    }
    if (subcommand === 'recommend') return recommend(changeDir, values);
    if (subcommand === 'show') return show(changeDir, state, values.json);
    if (subcommand === 'accept') return accept(changeDir, state, values);
    return select(changeDir, state, values);
  } catch (error) {
    if (error instanceof UsageError) return fail(error.message, 2);
    return fail(error.message, 1);
  }
}

function recommend(changeDir, values) {
  const record = saveWorkflowRecommendation(changeDir, factsFrom(values));
  return print({ source: 'recommendation', ...record }, values.json);
}

function select(changeDir, state, values) {
  if (!SELECTABLE_WORKFLOW_MODES.includes(values.mode)) {
    throw new UsageError(`--mode must be one of: ${SELECTABLE_WORKFLOW_MODES.join(', ')}`);
  }
  const record = recordWorkflowSelection(changeDir, {
    mode: values.mode,
    reason: values.reason,
    confirmed: values.confirm,
    acknowledged: values['acknowledge-recommendation'],
    verificationStrategy: parseVerification(values.verification),
  });
  persistWorkflowSelection(changeDir, state, record);
  return print({ ok: true, source: 'user-confirmed', record }, values.json);
}

function canEscalateToFull(state, values) {
  return values.mode === 'full' && ['quick', 'hotfix', 'tweak'].includes(state.workflow);
}

function accept(changeDir, state, values) {
  const record = acceptWorkflowRecommendation(changeDir, {
    source: values.source,
    verificationStrategy: parseVerification(values.verification),
  });
  persistWorkflowSelection(changeDir, state, record);
  return print({ ok: true, source: 'direct-request', record }, values.json);
}

function persistWorkflowSelection(changeDir, state, record) {
  const summary = `workflow_path=${record.selection.mode}; recommended=${record.recommendation.mode}; followed_recommendation=${record.selection.followed_recommendation}`;
  state.workflow = record.selection.mode;
  state.dp_0_decisions = appendDecision(state.dp_0_decisions, summary);
  writeState(changeDir, state);
}

function show(changeDir, state, json) {
  const receipt = readWorkflowSelection(changeDir);
  if (!receipt.exists) {
    if (isExplicitWorkflow(state.workflow)) {
      return print({ source: 'explicit-state', workflow: state.workflow }, json);
    }
    return print({
      source: 'missing-receipt',
      ...recommendWorkflowPath({}),
      workflow: state.workflow ?? 'auto',
      receipt,
    }, json);
  }
  if (!receipt.valid) {
    if (isExplicitWorkflow(state.workflow)) {
      return print({
        source: 'explicit-state', workflow: state.workflow, record: receipt.record, receipt,
      }, json);
    }
    print({
      status: 'invalid', workflow: state.workflow ?? 'auto', record: receipt.record, receipt,
    }, json);
    process.exitCode = 1;
    return;
  }

  const record = receipt.record;
  const selectedMode = record.selection?.mode;
  if (selectedMode && state.workflow === selectedMode) {
    return print({ status: 'selected', source: 'receipt', workflow: state.workflow, record }, json);
  }
  if (isExplicitWorkflow(state.workflow)) {
    return print({ source: 'explicit-state', workflow: state.workflow, record }, json);
  }
  if (selectedMode) {
    return print({ status: 'selection-pending', workflow: state.workflow ?? 'auto', record }, json);
  }
  return print({ status: record.status, workflow: state.workflow ?? 'auto', record }, json);
}

function factsFrom(values) {
  return {
    task_count: parseCount(values['task-count'], 'task-count'),
    file_count: parseCount(values['file-count'], 'file-count'),
    config_doc_only: parseFact(values['config-doc-only'], 'config-doc-only'),
    schema_api_change: parseFact(values['schema-api-change'], 'schema-api-change'),
    new_module: parseFact(values['new-module'], 'new-module'),
    behavioral_constraint_change: parseFact(values['behavioral-constraint-change'], 'behavioral-constraint-change'),
    cross_module_change: parseFact(values['cross-module-change'], 'cross-module-change'),
    uncertainty: parseFact(values.uncertainty, 'uncertainty'),
    request_kind: parseRequestKind(values['request-kind']),
  };
}

function parseVerification(value) {
  if (value === undefined) return null;
  if (!['tdd', 'new-test', 'bounded'].includes(value)) {
    throw new UsageError('verification must be one of: tdd, new-test, bounded');
  }
  return value;
}

function parseRequestKind(value) {
  if (value === undefined) return 'standard';
  if (!['standard', 'incident'].includes(value)) {
    throw new UsageError('request-kind must be one of: standard, incident');
  }
  return value;
}

function parseCount(value, name) {
  if (value === undefined) return null;
  if (!/^\d+$/.test(value)) throw new UsageError(`${name} must be a non-negative integer`);
  const count = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new UsageError(`${name} must be a non-negative integer`);
  }
  return count;
}

function parseFact(value, name) {
  if (value === undefined) return 'unknown';
  const allowed = name === 'uncertainty' ? ['low', 'high', 'unknown'] : BOOLEAN_FACTS[name];
  if (!allowed.includes(value)) throw new UsageError(`${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

function requireStateFile(changeDir) {
  if (!existsSync(join(changeDir, '.spec-superflow.yaml'))) {
    throw new Error('Workflow state is missing; run "ssf state init <change-dir>" first');
  }
}

function appendDecision(existing, summary) {
  const entries = typeof existing === 'string'
    ? existing.split(/\s+\|\s+/).map(value => value.trim()).filter(Boolean)
    : [];
  return [...entries.filter(value => !value.startsWith('workflow_path=')), summary].join(' | ');
}

function isExplicitWorkflow(workflow) {
  return WORKFLOW_MODES.includes(workflow);
}

function print(value, json) {
  if (json) console.log(JSON.stringify(value));
  else console.log(format(value));
}

function format(value) {
  const record = value.record ?? value;
  if (value.source === 'explicit-state') {
    return [
      `Workflow is explicitly set to ${value.workflow}.`,
      ...formatRecordDetails(value, record),
    ].join('\n');
  }
  if (value.source === 'user-confirmed') return `Workflow selected: ${value.record.selection.mode}.`;
  if (value.status) {
    return [
      `Workflow status: ${value.status}.`,
      ...formatRecordDetails(value, record),
    ].join('\n');
  }
  return JSON.stringify(value);
}

function formatRecordDetails(value, record) {
  const lines = [];
  if (record?.facts) {
    const observed = Object.entries(record.facts)
      .map(([name, fact]) => `${name}=${fact}`)
      .join(', ');
    lines.push(`Observed: ${observed}`);
  }
  if (record?.available_modes) lines.push(`Available: ${record.available_modes.join(', ')}`);
  if (record?.recommendation) {
    lines.push(`Recommended: ${record.recommendation.mode}`);
    lines.push(`Why: ${record.recommendation.reasons.join(' ')}`);
    if (record.recommendation.risk_reasons?.length) {
      lines.push(`Risk: ${record.recommendation.risk_reasons.join('; ')}`);
    }
  }
  if (record?.missing_facts?.length) {
    lines.push(`Missing facts: ${record.missing_facts.join(', ')}`);
  }
  if (record?.selection) {
    const detail = record.selection.accepted_automatically
      ? `source=${record.selection.source}, accepted_automatically=true`
      : `reason=${record.selection.reason}`;
    lines.push(`Selection: mode=${record.selection.mode}, ${detail}, followed_recommendation=${record.selection.followed_recommendation}`);
  }

  if (value.receipt?.exists === false) lines.push('Hash valid: unavailable (receipt missing)');
  else if (value.status === 'invalid' || value.receipt?.valid === false) lines.push('Hash valid: false');
  else if (record?.hash) lines.push('Hash valid: true');
  else if (value.source === 'explicit-state') lines.push('Hash valid: not applicable (explicit state)');

  if (value.receipt?.failures?.length) {
    lines.push(`Receipt failures: ${value.receipt.failures.join('; ')}`);
  }
  return lines;
}

function fail(message, exitCode) {
  console.error(message);
  process.exitCode = exitCode;
}

function printHelp() {
  console.log(`Usage:
  ssf workflow recommend <change-dir> [--task-count <n>] [--file-count <n>] [--config-doc-only yes|no|unknown] [--schema-api-change yes|no|unknown] [--new-module yes|no|unknown] [--behavioral-constraint-change yes|no] [--cross-module-change yes|no] [--uncertainty low|high|unknown] [--request-kind standard|incident] [--json]
  ssf workflow select <change-dir> --mode full|hotfix|tweak|quick --confirm --reason <text> [--acknowledge-recommendation] [--verification tdd|new-test|bounded] [--json]
  ssf workflow accept <change-dir> --source direct-request [--verification tdd|new-test|bounded] [--json]
  ssf workflow show <change-dir> [--json]`);
}
