import { readIsolationContext, resolveIsolationChange } from './isolation-context.mjs';
import { workflowPolicy } from './workflow-policy.mjs';
import fs from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describeWaves, describeReviews, readPlan, validatePlan } from './execution-plan.mjs';
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
    .filter(change => !['closing', 'abandoned'].includes(change.state)
      || (change.state === 'closing' && ['pending', 'verify-pending', 'cleanup-pending'].includes(readIsolationContext(change.path)?.finish_status)));
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
  const stateFile = join(changeDir, '.spec-superflow.yaml');
  const knownStates = ['exploring', 'specifying', 'bridging', 'approved-for-build', 'executing', 'debugging', 'closing', 'abandoned'];
  if (!fs.existsSync(stateFile) || !/^state:\s*\S+/m.test(fs.readFileSync(stateFile, 'utf8')) || !knownStates.includes(state.state)) {
    const reason = 'Workflow state is missing or invalid; recover recorded state and approvals before continuing';
    return { ok: false, change: { name: basename(changeDir), path: resolve(changeDir) }, state: state.state, workflow: state.workflow, terminal: false,
      checkpoint: null, handoffs: { active: [], result_ready: [], resolved: [] }, execution: { required: false, current: false, failures: [reason] },
      blockers: [{ code: 'STATE_RECOVERY_REQUIRED', message: reason }], next_action: { skill: 'none', command: null, reason },
      continuation: { kind: 'blocked', wave: null, reason } };
  }
  const terminal = ['closing', 'abandoned'].includes(state.state);
  const checkpoints = (terminal ? [] : listCheckpoints(changeDir))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const handoffs = partitionHandoffs(terminal ? [] : listHandoffs(changeDir));
  const execution = terminal ? { required: false, present: false, current: false, failures: [] } : inspectExecution(changeDir, state);
  const blockers = terminal ? [] : buildBlockers(changeDir, handoffs, execution);
  if (!terminal && workflowPolicy(changeDir, state).missingDirectReceipt) {
    blockers.unshift({
      code: 'WORKFLOW_RECEIPT_REQUIRED',
      message: `Workflow evidence for '${state.workflow}' is missing or invalid. Re-observe the facts, run workflow recommend, then accept/select the same persisted mode`,
      command: null,
    });
  }

  const nextAction = selectNextAction(changeDir, state, terminal, checkpoints[0], blockers, execution);
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
  const required = ['approved-for-build', 'executing', 'debugging'].includes(state.state)
    && workflowPolicy(changeDir, state).requiresExecutionPlan;
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
    const reviews = validation.valid ? describeReviews(changeDir, plan) : [];
    return {
      required,
      present: true,
      current: validation.valid,
      revision: plan.revision ?? null,
      review_policy: plan.review_policy ?? 'wave',
      waves, reviews,
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
  if (execution.current) {
    const reviewBlockers = (execution.reviews ?? []).flatMap(review => {
      if (review.blockers.length) return [{ code: 'REVIEW_EVIDENCE_INVALID', message: review.blockers.join('; '), wave: review.id }];
      if (review.repair.status === 'adjudication-required' && !review.adjudication?.active) {
        return [{ code: 'REVIEW_ADJUDICATION_REQUIRED', wave: review.id, message: `Review '${review.id}' requires human adjudication before retry` }];
      }
      return [];
    });
    return [...handoffBlockers, ...reviewBlockers];
  }
  if (!execution.required) return handoffBlockers;

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

function selectNextAction(changeDir, state, terminal, checkpoint, blockers, execution) {
  if (terminal && state.state === 'closing') {
    const isolation = readIsolationContext(changeDir);
    if (isolation?.finish_status === 'verify-pending') {
      return { skill: 'bug-investigator', command: `ssf state transition ${changeDir} debugging`, reason: 'Physical verification is unfinished; diagnose before retrying finish' };
    }
    if (isolation && isolation.finish_status !== 'complete') {
      return { skill: 'release-archivist', command: `ssf finish ${changeDir}`, reason: `Physical finish is ${isolation.finish_status}` };
    }
  }
  if (terminal) {
    return { skill: 'none', command: null, reason: 'Change is terminal' };
  }
  if (['HANDOFF_REVIEW_REQUIRED', 'WORKFLOW_RECEIPT_REQUIRED'].includes(blockers[0]?.code)) {
    return {
      skill: 'workflow-start',
      command: blockers[0].command,
      reason: blockers[0].message,
    };
  }
  if (state.state === 'debugging') {
    return { skill: 'bug-investigator', command: null, reason: 'Diagnose the failure before resuming implementation' };
  }
  if (blockers[0]?.code === 'EXECUTION_PLAN_STALE') {
    const failures = execution.failures.join('; ');
    const stage = failures.includes('artifacts hash mismatch') ? 'specifying'
      : failures.includes('contract hash mismatch') ? 'bridging' : null;
    if (stage) return { skill: stage === 'bridging' ? 'contract-builder' : 'spec-writer',
      command: `ssf state transition ${changeDir} ${stage}`, reason: `Approved inputs changed; recover ${stage} before revising the existing plan` };
  }
  if (blockers[0]?.code === 'EXECUTION_PLAN_REQUIRED' || blockers[0]?.code === 'EXECUTION_PLAN_STALE') {
    return {
      skill: 'build-executor',
      command: null,
      reason: 'Rebuild a current execution plan before implementation',
    };
  }

  if (execution.present && execution.current) {
    const waves = execution.waves;
    if (execution.review_policy === 'final' && waves.every(wave => wave.completed)) {
      const reviewed = execution.reviews.find(review => review.id === 'final')?.receipt?.status === 'pass';
      return { skill: reviewed ? 'release-archivist' : 'code-reviewer', command: null, reason: reviewed ? 'Final review passed; close out the change' : 'Implementation completed; final whole-range review required' };
    }
    const eligibleWave = waves.find(wave => wave.eligible);
    if (eligibleWave) {
      return {
        skill: 'build-executor',
        command: null,
        reason: `Current execution plan has eligible wave '${eligibleWave.id}'`,
      };
    }
    const allReviewed = waves.length > 0 && waves.every(wave => wave.receipt?.status === 'pass');
    if (allReviewed) {
      return {
        skill: 'build-executor',
        command: null,
        reason: 'All waves reviewed, close out the change',
      };
    }
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
    return nextAction.command
      ? { kind: 'blocked', wave: null, command: nextAction.command, reason: nextAction.reason }
      : { kind: 'terminal', wave: null, reason: 'Change is terminal' };
  }
  if (nextAction.skill === 'bug-investigator' && !blockers.some(blocker =>
    ['REVIEW_ADJUDICATION_REQUIRED', 'REVIEW_EVIDENCE_INVALID', 'WORKFLOW_RECEIPT_REQUIRED'].includes(blocker.code))) {
    return { kind: 'automatic', wave: null, reason: nextAction.reason };
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
  try { changeDir = resolveIsolationChange(changeDir); }
  catch (error) { throw new RecoveryError('ISOLATION_RECOVERY_REQUIRED', error.message); }
  return {
    name: basename(changeDir),
    path: changeDir,
    state: readState(changeDir).state,
    ...(selection ? { selection } : {}),
  };
}
