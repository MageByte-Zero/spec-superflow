import fs from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describeWaves, readPlan, validatePlan } from './execution-plan.mjs';
import { listCheckpoints, listHandoffs } from './sdd-overlay.mjs';
import { readState } from './state-loader.mjs';

const RECOGNIZABLE_ARTIFACTS = [
  '.spec-superflow.yaml',
  'proposal.md',
  'tasks.md',
  'execution-contract.md',
];

export class RecoveryError extends Error {
  constructor(code, message, details = {}, exitCode = 1) {
    super(message);
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

export function resolveChangeTarget(input, cwd = process.cwd()) {
  if (hasText(input)) return inspectExplicitTarget(input, cwd);

  const candidates = listRecognizableChanges(join(cwd, 'changes'))
    .filter(change => !['closing', 'abandoned'].includes(change.state));
  if (candidates.length === 1) return { ...candidates[0], selection: 'only-active' };
  if (candidates.length === 0) {
    throw new RecoveryError('NO_ACTIVE_CHANGE', 'No active change found', { candidates: [] });
  }
  throw new RecoveryError('AMBIGUOUS_CHANGE', 'Multiple active changes found', {
    candidates: candidates.map(change => change.name).sort(),
  });
}

export function createRecoverySummary(changeDir) {
  const state = readState(changeDir);
  const terminal = ['closing', 'abandoned'].includes(state.state);
  const checkpoints = listCheckpoints(changeDir)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const handoffs = partitionHandoffs(listHandoffs(changeDir));
  const execution = inspectExecution(changeDir, state.state);
  const blockers = terminal ? [] : buildBlockers(changeDir, handoffs, execution);

  const nextAction = selectNextAction(changeDir, state, terminal, checkpoints[0], blockers);
  return {
    ok: blockers.length === 0,
    change: { name: basename(changeDir), path: resolve(changeDir) },
    state: state.state,
    workflow: state.workflow,
    terminal,
    checkpoint: checkpoints[0]
      ? { status: checkpoints[0].stale ? 'stale' : 'current', record: checkpoints[0] }
      : null,
    handoffs,
    execution,
    blockers,
    next_action: nextAction,
    continuation: selectContinuation(terminal, blockers, execution, nextAction),
  };
}

function partitionHandoffs(records) {
  const handoffs = { active: [], result_ready: [], resolved: [] };
  for (const record of records) {
    if (record.status === 'active') handoffs.active.push(record);
    if (record.status === 'result-ready') handoffs.result_ready.push(record);
    if (record.status === 'resolved') handoffs.resolved.push(record);
  }
  for (const status of Object.keys(handoffs)) {
    handoffs[status].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return handoffs;
}

function inspectExecution(changeDir, state) {
  const required = ['approved-for-build', 'executing', 'debugging'].includes(state);
  let plan = null;
  try {
    plan = readPlan(changeDir);
    if (!plan) {
      return {
        required,
        present: false,
        current: false,
        revision: null,
        next_eligible_wave: null,
        failures: ['execution plan is missing'],
      };
    }

    const validation = validatePlan(changeDir, plan);
    const waves = validation.valid ? describeWaves(changeDir, plan) : [];
    return {
      required,
      present: true,
      current: validation.valid,
      revision: plan.revision ?? null,
      next_eligible_wave: waves.find(wave => wave.eligible)?.id ?? null,
      failures: validation.failures,
    };
  } catch (error) {
    return {
      required,
      present: true,
      current: false,
      revision: plan?.revision ?? null,
      next_eligible_wave: null,
      failures: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function buildBlockers(changeDir, handoffs, execution) {
  const handoffBlockers = handoffs.result_ready.map(handoff => ({
    code: 'HANDOFF_REVIEW_REQUIRED',
    handoff: handoff.id,
    message: `Handoff '${handoff.id}' is ready for review`,
    command: `ssf handoff resolve ${changeDir} ${handoff.id} --decision <accept|reject|defer>`,
  }));
  if (!execution.required || execution.current) return handoffBlockers;

  return [
    ...handoffBlockers,
    {
      code: execution.present ? 'EXECUTION_PLAN_STALE' : 'EXECUTION_PLAN_REQUIRED',
      message: execution.present
        ? 'Execution plan is invalid or stale'
        : 'A current execution plan is required',
      failures: execution.failures,
    },
  ];
}

function selectNextAction(changeDir, state, terminal, checkpoint, blockers) {
  if (terminal) {
    return { skill: 'none', command: null, reason: 'Change is terminal' };
  }
  if (blockers[0]?.code === 'HANDOFF_REVIEW_REQUIRED') {
    return {
      skill: 'workflow-start',
      command: blockers[0].command,
      reason: blockers[0].message,
    };
  }
  if (blockers[0]?.code === 'EXECUTION_PLAN_REQUIRED' || blockers[0]?.code === 'EXECUTION_PLAN_STALE') {
    return {
      skill: 'build-executor',
      command: null,
      reason: 'Rebuild a current execution plan before implementation',
    };
  }

  const routes = {
    exploring: 'need-explorer',
    specifying: 'spec-writer',
    bridging: 'contract-builder',
    'approved-for-build': 'build-executor',
    executing: 'build-executor',
    debugging: 'bug-investigator',
  };
  const route = routes[state.state] ?? 'workflow-start';
  const checkpointContext = checkpoint && !checkpoint.stale
    ? ` Current checkpoint: ${checkpoint.next}`
    : '';
  return {
    skill: route,
    command: null,
    reason: `Route from ${state.state}.${checkpointContext}`,
  };
}

function selectContinuation(terminal, blockers, execution, nextAction) {
  if (terminal) {
    return { kind: 'terminal', wave: null, reason: 'Change is terminal' };
  }
  if (blockers.length > 0) {
    const blocker = blockers[0];
    return {
      kind: 'blocked',
      wave: null,
      reason: blocker.message,
      ...(blocker.command ? { command: blocker.command } : {}),
    };
  }
  if (execution.next_eligible_wave) {
    return {
      kind: 'automatic',
      wave: execution.next_eligible_wave,
      reason: 'Current execution plan has an eligible wave',
    };
  }
  return { kind: 'automatic', wave: null, reason: nextAction.reason };
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function inspectExplicitTarget(input, cwd) {
  const requested = input.trim();
  const directPath = resolve(cwd, requested);
  const changesPath = resolve(cwd, 'changes', requested);
  const targetPath = [directPath, changesPath].find(isRecognizableChange);

  if (!targetPath) {
    throw new RecoveryError('TARGET_NOT_FOUND', 'Change target was not found', {
      input: requested,
    });
  }

  return describeChange(targetPath, 'explicit');
}

function listRecognizableChanges(changesDir) {
  if (!isDirectory(changesDir)) return [];

  return fs.readdirSync(changesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(changesDir, entry.name))
    .filter(isRecognizableChange)
    .map(changeDir => describeChange(changeDir));
}

function isRecognizableChange(changeDir) {
  return isDirectory(changeDir) && RECOGNIZABLE_ARTIFACTS
    .some(artifact => fs.existsSync(join(changeDir, artifact)));
}

function isDirectory(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function describeChange(changeDir, selection) {
  return {
    name: basename(changeDir),
    path: changeDir,
    state: readState(changeDir).state,
    ...(selection ? { selection } : {}),
  };
}
