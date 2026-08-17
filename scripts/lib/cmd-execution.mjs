import { parseArgs } from 'node:util';
import { adjudicateWave, createPlan, describeWaves, EXECUTION_MODES, readPlan, recordReview, validatePlan, writePlan } from './execution-plan.mjs';
import {
  createRecommendationReceipt,
  readCurrentRecommendationReceipt,
  writeRecommendationReceipt,
} from './execution-recommendation.mjs';
import { readState, writeState } from './state-loader.mjs';

const SUBCOMMANDS = ['recommend', 'plan', 'show', 'revise', 'review', 'adjudicate'];

export function run(args, io = { stdout: process.stdout, stderr: process.stderr }) {
  const { positionals, values } = parseArgs({
    args,
    options: {
      mode: { type: 'string' },
      reason: { type: 'string' },
      wave: { type: 'string', multiple: true },
      confirm: { type: 'boolean', default: false },
      'acknowledge-recommendation': { type: 'boolean', default: false },
      base: { type: 'string' },
      head: { type: 'string' },
      report: { type: 'string' },
      verdict: { type: 'string' },
      decision: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  const subcommand = positionals[0];
  const changeDir = positionals[1];

  if (values.help || subcommand === undefined) {
    printHelp(io);
    return { exitCode: 0 };
  }
  if (!SUBCOMMANDS.includes(subcommand)) return usage(`Unknown execution subcommand: ${subcommand}`, io);
  if (!changeDir) return usage('Usage: ssf execution <subcommand> <change-dir> [options]', io);

  switch (subcommand) {
    case 'recommend':
      recommendAndPrint(changeDir, values, io);
      return { exitCode: 0 };
    case 'plan':
      createAndPrintPlan(changeDir, values, false, io);
      return { exitCode: 0 };
    case 'show':
      return showPlan(changeDir, values.json, io);
    case 'revise':
      createAndPrintPlan(changeDir, values, true, io);
      return { exitCode: 0 };
    case 'review':
      recordAndPrintReview(changeDir, values, io);
      return { exitCode: 0 };
    case 'adjudicate':
      adjudicateAndPrint(changeDir, values, io);
      return { exitCode: 0 };
  }
}

function adjudicateAndPrint(changeDir, values, io) {
  requireOption(values.wave?.[0], '--wave');
  if (values.wave.length !== 1) throw new Error('Adjudication requires exactly one --wave value');
  if (values.decision !== 'allow-review') throw new Error("--decision must be 'allow-review'");
  requireOption(values.reason, '--reason');
  requireSafeReason(values.reason);
  if (!values.confirm) throw new Error('Adjudication requires --confirm after human review of the failure chain');
  const adjudication = adjudicateWave(changeDir, values.wave[0], {
    decision: values.decision,
    reason: values.reason,
    confirmed: true,
  });
  print(values.json, { ok: true, wave: values.wave[0], adjudication },
    `Review authorization for ${values.wave[0]} recorded: ${adjudication.id}.`, io);
}

function createAndPrintPlan(changeDir, values, revise, io) {
  requireMode(values.mode);
  requireOption(values.reason, '--reason');
  requireSafeReason(values.reason);
  const waves = parseWaves(values.wave);
  const existing = readPlan(changeDir);
  if (revise) {
    if (!existing) throw new Error('Cannot revise an execution plan before it is created');
    if (values.mode !== 'sdd') {
      throw new Error('Execution plan revisions must retain or upgrade to sdd; execution-plan downgrades are not allowed');
    }
  } else if (existing) {
    throw new Error('An execution plan already exists; use "ssf execution revise" to create a new SDD revision');
  }
  const recommendationReceipt = readCurrentRecommendationReceipt(changeDir, waves, revise ? existing.revision : null);
  const recommendation = recommendationReceipt.recommendation;
  if (!recommendation.available_modes.includes(values.mode)) {
    throw new Error(`${values.mode} is not an available execution mode for this change; choose one of: ${recommendation.available_modes.join(', ')}`);
  }

  if (!values.confirm) {
    throw new Error('Execution mode selection requires --confirm after reviewing "ssf execution recommend" output');
  }
  const followedRecommendation = values.mode === recommendation.recommendation.mode;
  if (!followedRecommendation && !values['acknowledge-recommendation']) {
    throw new Error(`${values.mode} differs from the ${recommendation.recommendation.mode} recommendation; pass --acknowledge-recommendation to record the informed choice`);
  }
  if (followedRecommendation && values['acknowledge-recommendation']) {
    throw new Error('--acknowledge-recommendation is only valid when selecting a non-recommended mode');
  }

  const plan = createPlan(changeDir, {
    mode: values.mode,
    source: revise ? 'user-confirmed-revision' : 'user-confirmed',
    rationale: values.reason,
    waves,
    recommendation,
    recommendationReceipt,
    selection: {
      confirmed: true,
      followed_recommendation: followedRecommendation,
      acknowledged_non_recommendation: !followedRecommendation,
    },
    revision: revise ? existing.revision + 1 : undefined,
  });
  const saved = writePlan(changeDir, plan);
  writeExecutionSummary(changeDir, saved);
  print(values.json, { ok: true, plan: saved }, `Execution plan revision ${saved.revision} recorded (${saved.mode}).`, io);
}

function recommendAndPrint(changeDir, values, io) {
  const waves = values.wave?.length ? parseWaves(values.wave) : [];
  const receipt = writeRecommendationReceipt(changeDir, createRecommendationReceipt(changeDir, waves));
  const recommendation = receipt.recommendation;
  const lines = [
    'Available execution modes:',
    ...recommendation.available_modes.map(mode => `- ${mode}`),
    `Recommended: ${recommendation.recommendation.mode}`,
    ...recommendation.recommendation.reasons.map(reason => `- ${reason}`),
  ];
  print(values.json, { ok: true, recommendation, receipt }, lines.join('\n'), io);
}

function showPlan(changeDir, json, io) {
  const plan = readPlan(changeDir);
  if (!plan) throw new Error('No execution plan has been recorded');
  const validation = validatePlan(changeDir, plan);
  const current = validation.valid;
  const waves = describeWaves(changeDir, plan);
  print(json, { ok: current, current, plan, valid: current, failures: validation.failures, waves },
    validation.valid ? `Execution plan revision ${plan.revision} is current.` : validation.failures.join('\n'), io);
  return { exitCode: validation.valid ? 0 : 1 };
}

function recordAndPrintReview(changeDir, values, io) {
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
  print(values.json, { ok: true, wave: values.wave[0], receipt }, `Review for ${values.wave[0]} recorded: ${receipt.status}.`, io);
}

function writeExecutionSummary(changeDir, plan) {
  const summary = `${plan.mode}: plan revision ${plan.revision}; ${plan.source}; ${plan.rationale}`;
  const state = readState(changeDir);
  state.revision = plan.revision;
  state.execution_mode = plan.mode;
  state.execution_plan_hash = plan.hash;
  state.execution_plan_revision = plan.revision;
  state.dp_4_result = summary;
  state.dp_4_timestamp = new Date().toISOString();
  writeState(changeDir, state);
}

function parseWaves(values) {
  if (!values || values.length === 0) throw new Error('At least one --wave <id>:<strategy>:<task,...> is required');
  return values.map(value => {
    const [id, strategy, taskList, dependencyList, ...extra] = value.split(':');
    if (extra.length > 0 || !id || !strategy || !taskList) {
      throw new Error(`Invalid --wave '${value}'; expected <id>:<strategy>:<task,...>[:<depends-on,...>]`);
    }
    const tasks = taskList.split(',').map(task => task.trim()).filter(Boolean);
    if (tasks.length === 0) throw new Error(`Invalid --wave '${value}'; at least one task is required`);
    const depends_on = dependencyList === undefined ? [] : dependencyList.split(',').map(id => id.trim()).filter(Boolean);
    if (dependencyList !== undefined && depends_on.length === 0) {
      throw new Error(`Invalid --wave '${value}'; dependencies must name at least one wave`);
    }
    return { id, strategy, tasks, depends_on };
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

function requireSafeReason(reason) {
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(reason)) {
    throw new Error('--reason must not contain control characters or line separators');
  }
}

function usage(message, io) {
  io.stderr.write(`${message}\n`);
  printHelp(io);
  return { exitCode: 2 };
}

function print(json, value, message, io) {
  io.stdout.write(`${json ? JSON.stringify(value) : message}\n`);
}

function printHelp(io) {
  io.stdout.write(`Usage:
  ssf execution recommend <dir> [--wave <id>:<strategy>:<task,...>[:<depends-on,...>]] [--json]
  ssf execution plan <dir> --mode <mode> --confirm --reason <text> --wave <id>:<strategy>:<task,...>[:<depends-on,...>] [--acknowledge-recommendation]
  ssf execution show <dir> [--json]
  ssf execution revise <dir> --mode sdd --confirm --reason <text> --wave <id>:<strategy>:<task,...>[:<depends-on,...>] [--acknowledge-recommendation]
  ssf execution review <dir> --wave <id> --base <sha> --head <sha> --report <path> --verdict pass|fail
  ssf execution adjudicate <dir> --wave <id> --decision allow-review --confirm --reason <text>\n`);
}
