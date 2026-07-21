import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  WORKFLOW_MODES,
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
  uncertainty: { type: 'string' },
  mode: { type: 'string' },
  confirm: { type: 'boolean', default: false },
  reason: { type: 'string' },
  'acknowledge-recommendation': { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
};

const BOOLEAN_FACTS = {
  'config-doc-only': ['yes', 'no', 'unknown'],
  'schema-api-change': ['yes', 'no', 'unknown'],
  'new-module': ['yes', 'no', 'unknown'],
};

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
  if (!['recommend', 'select', 'show'].includes(subcommand)) {
    return fail('Usage: ssf workflow <recommend|select|show> <change-dir>', 2);
  }
  if (positionals.length !== 2 || !changeDir) {
    return fail('Usage: ssf workflow <recommend|select|show> <change-dir>', 2);
  }

  try {
    requireStateFile(changeDir);
    const state = readState(changeDir);

    if (subcommand === 'select' && isExplicitWorkflow(state.workflow)) {
      return fail('workflow is already explicitly selected', 1);
    }
    if (subcommand === 'recommend' && isExplicitWorkflow(state.workflow)) {
      return print({ source: 'explicit-state', workflow: state.workflow }, values.json);
    }
    if (subcommand === 'recommend') return recommend(changeDir, values);
    if (subcommand === 'show') return show(changeDir, state, values.json);
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
  if (!WORKFLOW_MODES.includes(values.mode)) {
    throw new UsageError(`--mode must be one of: ${WORKFLOW_MODES.join(', ')}`);
  }
  const record = recordWorkflowSelection(changeDir, {
    mode: values.mode,
    reason: values.reason,
    confirmed: values.confirm,
    acknowledged: values['acknowledge-recommendation'],
  });
  const summary = `workflow_path=${record.selection.mode}; recommended=${record.recommendation.mode}; followed_recommendation=${record.selection.followed_recommendation}`;
  state.workflow = record.selection.mode;
  state.dp_0_decisions = appendDecision(state.dp_0_decisions, summary);
  writeState(changeDir, state);
  return print({ ok: true, source: 'user-confirmed', record }, values.json);
}

function show(changeDir, state, json) {
  const receipt = readWorkflowSelection(changeDir);
  if (!receipt.exists) {
    if (isExplicitWorkflow(state.workflow)) {
      return print({ source: 'explicit-state', workflow: state.workflow }, json);
    }
    return print({ status: 'missing', workflow: state.workflow ?? 'auto', receipt }, json);
  }
  if (!receipt.valid) {
    if (isExplicitWorkflow(state.workflow)) {
      return print({ source: 'explicit-state', workflow: state.workflow, receipt }, json);
    }
    print({ status: 'invalid', workflow: state.workflow ?? 'auto', receipt }, json);
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
    uncertainty: parseFact(values.uncertainty, 'uncertainty'),
  };
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
  if (value.status === 'needs-input') {
    return `More workflow facts are required: ${value.missing_facts.join(', ')}`;
  }
  if (value.status === 'ready') {
    const record = value.record ?? value;
    const observed = Object.entries(record.facts)
      .map(([name, fact]) => `${name}=${fact}`)
      .join(', ');
    return [
      `Observed: ${observed}`,
      `Available: ${record.available_modes.join(', ')}`,
      `Recommended: ${record.recommendation.mode}`,
      `Why: ${record.recommendation.reasons.join(' ')}`,
    ].join('\n');
  }
  if (value.status) return `Workflow status: ${value.status}.`;
  if (value.source === 'explicit-state') return `Workflow is explicitly set to ${value.workflow}.`;
  if (value.source === 'user-confirmed') return `Workflow selected: ${value.record.selection.mode}.`;
  return JSON.stringify(value);
}

function fail(message, exitCode) {
  console.error(message);
  process.exitCode = exitCode;
}

function printHelp() {
  console.log(`Usage:
  ssf workflow recommend <change-dir> [--task-count <n>] [--file-count <n>] [--config-doc-only yes|no|unknown] [--schema-api-change yes|no|unknown] [--new-module yes|no|unknown] [--uncertainty low|high|unknown] [--json]
  ssf workflow select <change-dir> --mode full|hotfix|tweak --confirm --reason <text> [--acknowledge-recommendation] [--json]
  ssf workflow show <change-dir> [--json]`);
}
