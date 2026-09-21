import { existsSync, mkdirSync, readFileSync, lstatSync, realpathSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { parseTasks } from './task-parser.mjs';
import { createPlan, readPlan, validatePlan, writePlan, writePlanRevision, describeReviews } from './execution-plan.mjs';
import { resolveIsolationChange } from './isolation-context.mjs';
import { computeArtifactsHash, computeContractHash } from './hash.mjs';
import { runGuard } from '../guard/guard.mjs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  WORKFLOW_MODES,
  recordDirectRequest,
  acceptWorkflowRecommendation,
  escalateLightweightWorkflow,
  hasLightweightCompletionEvidence,
  recommendWorkflowPath,
  recordLightweightCompletionEvidence,
  readWorkflowSelection,
  recordWorkflowSelection,
  saveWorkflowRecommendation,
  isDirectWorkflowReceipt,
} from './workflow-recommendation.mjs';
import { readState, writeState } from './state-loader.mjs';

const OPTIONS = {
  path: { type: 'string' },
  scope: { type: 'string' },
  'accept-risk': { type: 'boolean', default: false },
  'task-count': { type: 'string' },
  'file-count': { type: 'string' },
  'config-doc-only': { type: 'string' },
  'schema-api-change': { type: 'string' },
  'new-module': { type: 'string' },
  'behavioral-constraint-change': { type: 'string' },
  'cross-module-change': { type: 'string' },
  uncertainty: { type: 'string' },
  'request-kind': { type: 'string' },
  'affected-path': { type: 'string', multiple: true },
  'production-behavior': { type: 'string' },
  'public-boundary': { type: 'string' },
  installer: { type: 'string' },
  'state-machine': { type: 'string' },
  'external-side-effect': { type: 'string' },
  'data-permission-config-semantics': { type: 'string' },
  'expected-behavior-clear': { type: 'string' },
  'verification-reproducible': { type: 'string' },
  'impact-paths-complete': { type: 'string' },
  mode: { type: 'string' },
  confirm: { type: 'boolean', default: false },
  reason: { type: 'string' },
  'scope-confirmation': { type: 'string' },
  'focused-review': { type: 'string' },
  'verification-command': { type: 'string' },
  'verification-result': { type: 'string' },
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

const SELECTABLE_WORKFLOW_MODES = Object.freeze([...WORKFLOW_MODES]);

const LIGHTWEIGHT_EXCLUSION_OPTIONS = {
  'production-behavior': 'production_behavior',
  'public-boundary': 'public_boundary',
  installer: 'installer',
  'state-machine': 'state_machine',
  'external-side-effect': 'external_side_effect',
  'data-permission-config-semantics': 'data_permission_config_semantics',
  'expected-behavior-clear': 'expected_behavior_clear',
  'verification-reproducible': 'verification_reproducible',
  'impact-paths-complete': 'impact_paths_complete',
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
  if (!['start', 'complete', 'recommend', 'select', 'accept', 'evidence', 'escalate', 'show'].includes(subcommand)) {
    return fail('Usage: ssf workflow <start|complete|recommend|select|accept|evidence|escalate|show> <change-dir>', 2);
  }
  if (positionals.length !== 2 || !changeDir) {
    return fail('Usage: ssf workflow <start|complete|recommend|select|accept|evidence|escalate|show> <change-dir>', 2);
  }

  try {
    if (subcommand === 'start') return start(changeDir, values);
    requireStateFile(changeDir);
    if (subcommand === 'complete') return complete(changeDir, values);
    const state = readState(changeDir);

    if (subcommand === 'accept' && isExplicitWorkflow(state.workflow)
      && !canRepairWorkflowSelection(changeDir, state, subcommand, values)) {
      return fail('workflow is already explicitly selected', 1);
    }
    if (subcommand === 'select' && isExplicitWorkflow(state.workflow)
      && !canEscalateToFull(state, values)
      && !canRepairWorkflowSelection(changeDir, state, subcommand, values)) {
      return fail('workflow is already explicitly selected', 1);
    }
    if (subcommand === 'recommend' && state.workflow === 'full') {
      return print({ source: 'explicit-state', workflow: state.workflow }, values.json);
    }
    if (subcommand === 'recommend') return recommend(changeDir, values);
    if (subcommand === 'show') return show(changeDir, state, values.json);
    if (subcommand === 'accept') return accept(changeDir, state, values);
    if (subcommand === 'evidence') return evidence(changeDir, state, values);
    if (subcommand === 'escalate') return escalate(changeDir, state, values);
    return select(changeDir, state, values);
  } catch (error) {
    if (error instanceof UsageError) return fail(error.message, 2);
    return fail(error.message, 1);
  }
}

function safeText(value, label) {
  if (typeof value !== 'string' || !value.trim() || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)) throw new UsageError(`${label} requires non-empty single-line text`);
  return value.trim();
}

function checkChangePath(dir) {
  const root = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: 'pipe' }).trim();
  const rel = relative(realpathSync.native(root), realpathSync.native(dir));
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Change must be strictly inside its repository');
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('Change path must not traverse symlinks');
  }
  if (realpathSync.native(resolveIsolationChange(dir)) !== realpathSync.native(dir)) throw new Error('Use the recorded isolation change directory');
  return root;
}

function start(dir, values) {
  if (!['direct', 'planned'].includes(values.path)) throw new UsageError('--path must be direct or planned');
  checkChangePath(dir);
  const state = readState(dir);
  const existing = readPlan(dir);
  const compact = ['planned', 'direct'].includes(state.workflow_variant);
  if (existsSync(join(dir, '.spec-superflow.yaml')) && !compact
    && (state.workflow !== 'auto' || state.state !== 'exploring')) throw new Error('Existing legacy change: resume it without replacing its authorization or evidence');
  if (['closing', 'abandoned'].includes(state.state)) throw new Error('Change is terminal; create a new change');
  if (state.workflow_variant === 'planned' && values.path === 'direct') throw new Error('Do not discard planned review obligations; complete or explicitly accept risks before a new direct change');
  if (values.path === 'direct') {
    const scope = safeText(values.scope, '--scope');
    if (existing) throw new Error('Direct execution cannot discard an existing plan');
    const loaded = readWorkflowSelection(dir);
    if (compact) {
      if (!loaded.valid || loaded.record?.schema_version !== 3 || loaded.record.selection.scope_confirmation !== scope) throw new Error('Existing direct scope differs or evidence is invalid; preserve it and create a new change');
      return print({ ok: true, state: state.state, path: 'direct' }, values.json);
    } else recordDirectRequest(dir, scope, values.verification ?? 'bounded');
    state.workflow = 'quick'; state.workflow_variant = 'direct';
  } else {
    if (!values.confirm) throw new Error('Record the existing approval of this concrete plan with --confirm --reason; do not ask again if already approved');
    const reason = safeText(values.reason, '--reason');
    for (const file of ['proposal.md', 'tasks.md']) {
      if (!existsSync(join(dir, file)) || !readFileSync(join(dir, file), 'utf8').trim()) throw new Error(`${file} is required for planned execution`);
    }
    const tasks = parseTasks(readFileSync(join(dir, 'tasks.md'), 'utf8'));
    if (!tasks.length || tasks.some(task => !task.id || !/^[ xX]$/.test(task.marker)) || new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error('tasks.md needs unique numbered checkbox tasks');
    const mode = values.mode ?? existing?.mode ?? 'inline';
    if (!['inline', 'batch-inline', 'sdd'].includes(mode)) throw new UsageError('Invalid execution mode');
    if (mode === 'sdd' && values.mode !== 'sdd' && !existing) throw new Error('Delegation requires explicit selection');
    if (state.workflow_variant === 'planned' && !existing) throw new Error('Authoritative execution plan is missing; recover it instead of discarding approval and review history');
    if (existing && existing.schema_version !== 2) throw new Error('Legacy plan must be revised with its existing commands');
    const validation = existing ? validatePlan(dir, existing) : null;
    if (validation?.valid && mode === existing.mode) return print({ ok: true, state: state.state, plan: existing }, values.json);
    if (validation?.failures.some(failure => !/artifacts hash mismatch|contract hash mismatch/.test(failure))) throw new Error('Plan evidence is invalid; recover it instead of resetting review history');
    state.workflow = 'full'; state.workflow_variant = 'planned';
    // Construct before mutating state. The persisted plan holds the one approval
    // and derives the serial task list directly from tasks.md.
    const plan = createPlan(dir, { schemaVersion: 2, mode, source: 'approved-plan', rationale: reason,
      reviewPolicy: mode === 'sdd' ? 'wave' : 'final', revision: (existing?.revision ?? 0) + 1,
      waves: [{ id: 'implementation', strategy: 'serial', tasks: tasks.map(task => task.id), depends_on: [] }],
      workflow: 'full' });
    writeState(dir, state);
    if (existing) writePlanRevision(dir, plan, existing); else writePlan(dir, plan);
  }
  state.state = 'executing'; state.test_result = null; state.dp_6_result = null;
  state.artifacts_hash = computeArtifactsHash(dir); state.contract_hash = computeContractHash(dir);
  state.last_transition = new Date().toISOString();
  writeState(dir, state);
  return print({ ok: true, state: 'executing', path: values.path, mode: readPlan(dir)?.mode ?? 'inline' }, values.json);
}

function complete(dir, values) {
  const root = checkChangePath(dir);
  const state = readState(dir);
  if (!['planned', 'direct'].includes(state.workflow_variant)) throw new Error('Legacy change: use its existing closure commands');
  if (state.state === 'closing') return print({ ok: true, outcome: state.completion_outcome }, values.json);
  if (!['executing', 'debugging'].includes(state.state)) throw new Error('Only active implementation can complete');
  if (state.workflow_variant === 'planned') {
    const plan = readPlan(dir), validation = validatePlan(dir, plan);
    if (!validation.valid) throw new Error(validation.failures.join('; '));
    const invalidEvidence = describeReviews(dir, plan).flatMap(review => review.blockers);
    if (invalidEvidence.length) throw new Error(invalidEvidence.join('; '));
  } else {
    const receipt = readWorkflowSelection(dir);
    if (!receipt.valid || !isDirectWorkflowReceipt(receipt.record, state)) throw new Error('Direct request evidence is invalid');
  }
  if (values['accept-risk']) {
    if (!values.confirm) throw new Error('Accepting known risk requires explicit user approval (--confirm)');
    state.completion_reason = safeText(values.reason, '--reason');
    state.completion_outcome = 'accepted-risk';
  } else {
    const command = safeText(values['verification-command'], '--verification-command');
    const before = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const result = spawnSync(command, { cwd: root, shell: true, stdio: values.json ? 'pipe' : 'inherit', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 600000 });
    if (values.json) process.stderr.write((result.stdout ?? '') + (result.stderr ?? ''));
    state.test_result = `${result.status === 0 ? 'pass' : 'fail'}: ${command}`;
    writeState(dir, state);
    if (result.status !== 0) throw new Error(`Verification failed (${result.error?.message ?? result.signal ?? result.status}); repair within executing and retry when evidence changes`);
    if (state.workflow_variant === 'planned') {
      const prefix = execFileSync('git', ['-C', dir, 'rev-parse', '--show-prefix'], { encoding: 'utf8' }).trim();
      const dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all', '--', '.', `:(exclude,literal)${prefix.replace(/\/$/, '')}`], { encoding: 'utf8' }).trim();
      const after = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      if (before !== after || dirty) throw new Error('Implementation differs from the reviewed snapshot; commit and review affected changes before completion');
    }
    let detail = '';
    const output = { write(text) { detail += text; } };
    const guard = runGuard(['check', dir, 'executing', 'closing', '--json'], { stdout: output, stderr: output });
    if (guard.exitCode !== 0) {
      const report = JSON.parse(detail);
      throw new Error(`Completion evidence is incomplete: ${report.checks.filter(check => !check.pass).flatMap(check => check.failures).join('; ')}`);
    }
    state.completion_outcome = 'verified';
  }
  state.state = 'closing'; state.last_transition = new Date().toISOString(); writeState(dir, state);
  return print({ ok: true, outcome: state.completion_outcome, verification: state.test_result }, values.json);
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
    scopeConfirmation: values['scope-confirmation'],
  });
  persistWorkflowSelection(changeDir, state, record);
  return print({ ok: true, source: 'user-confirmed', record }, values.json);
}

function canEscalateToFull(state, values) {
  return values.mode === 'full' && ['quick', 'hotfix', 'tweak'].includes(state.workflow);
}

function canRepairWorkflowSelection(changeDir, state, subcommand, values) {
  const loaded = readWorkflowSelection(changeDir);
  if (!loaded.valid || loaded.record.status !== 'ready' || loaded.record.selection) return false;
  if (loaded.record.recommendation?.mode !== state.workflow) return false;
  if (subcommand === 'accept') return ['quick', 'hotfix'].includes(state.workflow);
  return subcommand === 'select' && values.mode === state.workflow;
}

function accept(changeDir, state, values) {
  const record = acceptWorkflowRecommendation(changeDir, {
    source: values.source,
    verificationStrategy: parseVerification(values.verification),
  });
  persistWorkflowSelection(changeDir, state, record);
  return print({ ok: true, source: 'direct-request', record }, values.json);
}

function evidence(changeDir, state, values) {
  const loaded = readWorkflowSelection(changeDir);
  if (state.workflow !== 'lightweight' || !loaded.valid || !isDirectWorkflowReceipt(loaded.record, state)) {
    throw new Error('lightweight completion evidence requires an active selected lightweight receipt');
  }
  const record = recordLightweightCompletionEvidence(changeDir, {
    focusedReview: values['focused-review'],
    verificationCommand: values['verification-command'],
    verificationResult: values['verification-result'],
  });
  if (!hasLightweightCompletionEvidence(record)) {
    throw new Error('lightweight completion evidence must contain one focused review and a passing verification result');
  }
  return print({ ok: true, source: 'lightweight-completion-evidence', record }, values.json);
}

function escalate(changeDir, state, values) {
  if (state.workflow !== 'lightweight') {
    throw new Error('only an active lightweight workflow can be escalated');
  }
  const record = escalateLightweightWorkflow(changeDir, { reason: values.reason });
  const fromState = state.state;
  state.workflow = 'full';
  state.workflow_variant = 'legacy';
  state.state = fromState === 'exploring' ? 'exploring' : 'specifying';
  state.execution_mode = null;
  state.execution_plan_hash = null;
  state.execution_plan_revision = null;
  state.batches_completed = 0;
  state.test_result = null;
  state.spec_merged = false;
  for (const decision of [2, 3, 4, 6, 7]) {
    state[`dp_${decision}_result`] = null;
    state[`dp_${decision}_confirmed`] = null;
    state[`dp_${decision}_timestamp`] = null;
  }
  state.dp_0_decisions = appendDecision(state.dp_0_decisions, 'workflow_path=full; escalated_from=lightweight');
  state.last_transition_from = fromState;
  state.last_transition_to = state.state;
  state.last_transition = new Date().toISOString();
  writeState(changeDir, state);
  return print({ ok: true, source: 'lightweight-escalation', record, workflow: state.workflow, state: state.state }, values.json);
}

function persistWorkflowSelection(changeDir, state, record) {
  const summary = `workflow_path=${record.selection.mode}; recommended=${record.recommendation.mode}; followed_recommendation=${record.selection.followed_recommendation}`;
  state.workflow = record.selection.mode;
  state.workflow_variant = isDirectWorkflowReceipt(record, state) ? 'direct' : 'legacy';
  state.dp_0_decisions = appendDecision(state.dp_0_decisions, summary);
  writeState(changeDir, state);
}

function show(changeDir, state, json) {
  if (state.workflow_variant === 'planned') return print({ path: 'planned', state: state.state, mode: readPlan(changeDir)?.mode, outcome: state.completion_outcome }, json);
  const receipt = readWorkflowSelection(changeDir);
  if (receipt.valid && receipt.record?.schema_version === 3) return print({ path: 'direct', state: state.state, scope: receipt.record.selection.scope_confirmation, outcome: state.completion_outcome }, json);
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
    affected_paths: values['affected-path'] ?? null,
    exclusion_checks: Object.fromEntries(Object.entries(LIGHTWEIGHT_EXCLUSION_OPTIONS)
      .map(([option, key]) => [key, parseFact(values[option], option)])),
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
  const allowed = name === 'uncertainty'
    ? ['low', 'high', 'unknown']
    : (BOOLEAN_FACTS[name] ?? ['yes', 'no', 'unknown']);
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
  console.log('New tasks: ssf workflow start <dir> --path direct --scope <request> | --path planned --confirm --reason <approval> [--mode sdd]\nComplete: ssf workflow complete <dir> --verification-command <command> | --accept-risk --confirm --reason <decision>\nThe following commands are legacy compatibility:');
  console.log(`Usage:
  ssf workflow recommend <change-dir> [--task-count <n>] [--file-count <n>] [--config-doc-only yes|no|unknown] [--schema-api-change yes|no|unknown] [--new-module yes|no|unknown] [--behavioral-constraint-change yes|no] [--cross-module-change yes|no] [--uncertainty low|high|unknown] [--request-kind standard|incident] [--affected-path <path>] [--production-behavior yes|no|unknown] [--public-boundary yes|no|unknown] [--installer yes|no|unknown] [--state-machine yes|no|unknown] [--external-side-effect yes|no|unknown] [--data-permission-config-semantics yes|no|unknown] [--expected-behavior-clear yes|no|unknown] [--verification-reproducible yes|no|unknown] [--impact-paths-complete yes|no|unknown] [--json]
  ssf workflow select <change-dir> --mode full|hotfix|tweak|quick|lightweight --confirm --reason <text> [--scope-confirmation <text>] [--acknowledge-recommendation] [--verification tdd|new-test|bounded] [--json]
  ssf workflow accept <change-dir> --source direct-request [--verification tdd|new-test|bounded] [--json]
  ssf workflow evidence <change-dir> --focused-review <summary> --verification-command <command> --verification-result pass [--json]
  ssf workflow escalate <change-dir> --reason <discovered-risk> [--json]
  ssf workflow show <change-dir> [--json]`);
}
