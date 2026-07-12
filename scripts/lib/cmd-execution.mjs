import { parseArgs } from 'node:util';
import { createPlan, EXECUTION_MODES, readPlan, recordReview, validatePlan, writePlan } from './execution-plan.mjs';
import { updateField } from './state-loader.mjs';

const SUBCOMMANDS = ['plan', 'show', 'revise', 'review'];

export async function run(args) {
  const { positionals, values } = parseArgs({
    args,
    options: {
      mode: { type: 'string' },
      reason: { type: 'string' },
      wave: { type: 'string', multiple: true },
      override: { type: 'boolean', default: false },
      base: { type: 'string' },
      head: { type: 'string' },
      report: { type: 'string' },
      verdict: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  const subcommand = positionals[0];
  const changeDir = positionals[1];

  if (values.help || subcommand === undefined) {
    printHelp();
    return;
  }
  if (!SUBCOMMANDS.includes(subcommand)) usage(`Unknown execution subcommand: ${subcommand}`);
  if (!changeDir) usage('Usage: ssf execution <subcommand> <change-dir> [options]');

  switch (subcommand) {
    case 'plan':
      return createAndPrintPlan(changeDir, values, false);
    case 'show':
      return showPlan(changeDir, values.json);
    case 'revise':
      return createAndPrintPlan(changeDir, values, true);
    case 'review':
      return recordAndPrintReview(changeDir, values);
  }
}

function createAndPrintPlan(changeDir, values, revise) {
  requireMode(values.mode);
  requireOption(values.reason, '--reason');
  const waves = parseWaves(values.wave);
  const existing = readPlan(changeDir);
  if (revise) {
    if (!existing) throw new Error('Cannot revise an execution plan before it is created');
    if (!['inline', 'batch-inline'].includes(existing.mode) || values.mode !== 'sdd') {
      throw new Error('Execution plan revisions only allow inline or batch-inline to upgrade to sdd');
    }
  } else if (existing) {
    throw new Error('An execution plan already exists; use "ssf execution revise" for an allowed SDD upgrade');
  }

  if (values.override && values.mode === 'sdd') {
    throw new Error('--override is only valid for inline or batch-inline execution');
  }
  if (!values.override && values.mode !== 'sdd') {
    throw new Error(`${values.mode} requires --override to record an explicit user override`);
  }

  const plan = createPlan(changeDir, {
    mode: values.mode,
    source: values.override ? 'user-override' : 'default',
    rationale: values.reason,
    waves,
    revision: revise ? existing.revision + 1 : undefined,
  });
  const saved = writePlan(changeDir, plan);
  writeExecutionSummary(changeDir, saved);
  print(values.json, { ok: true, plan: saved }, `Execution plan revision ${saved.revision} recorded (${saved.mode}).`);
}

function showPlan(changeDir, json) {
  const plan = readPlan(changeDir);
  if (!plan) throw new Error('No execution plan has been recorded');
  const validation = validatePlan(changeDir, plan);
  print(json, { ok: validation.valid, plan, valid: validation.valid, failures: validation.failures },
    validation.valid ? `Execution plan revision ${plan.revision} is current.` : validation.failures.join('\n'));
  if (!validation.valid) process.exitCode = 1;
}

function recordAndPrintReview(changeDir, values) {
  requireOption(values.wave?.[0], '--wave');
  if (values.wave.length !== 1) throw new Error('Review requires exactly one --wave value');
  requireOption(values.base, '--base');
  requireOption(values.head, '--head');
  requireOption(values.report, '--report');
  if (!['pass', 'fail'].includes(values.verdict)) throw new Error("--verdict must be 'pass' or 'fail'");
  const receipt = recordReview(changeDir, values.wave[0], {
    status: values.verdict,
    base: values.base,
    head: values.head,
    report: values.report,
  });
  print(values.json, { ok: true, wave: values.wave[0], receipt }, `Review for ${values.wave[0]} recorded: ${receipt.status}.`);
}

function writeExecutionSummary(changeDir, plan) {
  const summary = `${plan.mode}: plan revision ${plan.revision}; ${plan.source}; ${plan.rationale}`;
  updateField(changeDir, 'execution_mode', plan.mode);
  updateField(changeDir, 'execution_plan_hash', plan.hash);
  updateField(changeDir, 'execution_plan_revision', String(plan.revision));
  updateField(changeDir, 'dp_4_result', summary);
  updateField(changeDir, 'dp_4_timestamp', new Date().toISOString());
}

function parseWaves(values) {
  if (!values || values.length === 0) throw new Error('At least one --wave <id>:<strategy>:<task,...> is required');
  return values.map(value => {
    const [id, strategy, taskList, ...extra] = value.split(':');
    if (extra.length > 0 || !id || !strategy || !taskList) {
      throw new Error(`Invalid --wave '${value}'; expected <id>:<strategy>:<task,...>`);
    }
    const tasks = taskList.split(',').map(task => task.trim()).filter(Boolean);
    if (tasks.length === 0) throw new Error(`Invalid --wave '${value}'; at least one task is required`);
    return { id, strategy, tasks, depends_on: [] };
  });
}

function requireMode(mode) {
  if (!EXECUTION_MODES.includes(mode)) {
    throw new Error(`--mode must be one of: ${EXECUTION_MODES.join(', ')}`);
  }
}

function requireOption(value, option) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${option} is required`);
}

function usage(message) {
  console.error(message);
  printHelp();
  process.exit(2);
}

function print(json, value, message) {
  console.log(json ? JSON.stringify(value) : message);
}

function printHelp() {
  console.log(`Usage:
  ssf execution plan <dir> --mode <mode> --reason <text> --wave <id>:<strategy>:<task,...> [--override]
  ssf execution show <dir> [--json]
  ssf execution revise <dir> --mode sdd --reason <text> --wave <id>:<strategy>:<task,...>
  ssf execution review <dir> --wave <id> --base <sha> --head <sha> --report <path> --verdict pass|fail`);
}
