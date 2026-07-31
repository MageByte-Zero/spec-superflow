import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { computeArtifactsHash, computeContractHash } from './hash.mjs';
import { getOverlayPaths, getPlanScopedPaths } from './sdd-overlay.mjs';
import { readState } from './state-loader.mjs';

export const EXECUTION_MODES = ['inline', 'batch-inline', 'sdd'];

const WAVE_STRATEGIES = new Set(['parallel', 'serial']);
const REVIEW_STATUSES = new Set(['pass', 'fail']);
const MAX_REPAIR_FAILURES = 5;

export function createPlan(changeDir, input) {
  const state = readState(changeDir);
  const plan = {
    mode: input?.mode,
    source: input?.source,
    rationale: input?.rationale,
    waves: input?.waves,
    artifacts_hash: computeArtifactsHash(changeDir),
    contract_hash: computeContractHash(changeDir),
    workflow: state.workflow,
    revision: input?.revision ?? state.revision ?? 1,
  };
  if (input?.recommendation !== undefined) plan.recommendation = input.recommendation;
  if (input?.recommendationReceipt !== undefined) plan.recommendation_receipt = input.recommendationReceipt;
  if (input?.selection !== undefined) plan.selection = input.selection;
  const failures = validateStructure(plan);
  if (failures.length > 0) throw new Error(`Invalid execution plan: ${failures.join('; ')}`);
  plan.hash = hashPlan(plan);
  return plan;
}

export function readPlan(changeDir) {
  const filePath = getOverlayPaths(changeDir).executionPlan;
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read execution plan: ${error.message}`);
  }
}

export function writePlan(changeDir, plan) {
  const failures = validateStructure(plan);
  const expectedHash = tryHashPlan(plan);
  if (expectedHash === null) failures.push('execution plan content cannot be hashed');
  else if (plan?.hash !== expectedHash) failures.push('execution plan content hash mismatch');
  if (failures.length > 0) throw new Error(`Invalid execution plan: ${failures.join('; ')}`);

  const paths = getOverlayPaths(changeDir);
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(paths.reviews, { recursive: true });
  atomicWrite(paths.executionPlan, `${JSON.stringify(plan, null, 2)}\n`);
  writeExecutionPlanSummary(changeDir, plan);
  return readPlan(changeDir);
}

export function validatePlan(changeDir, plan) {
  const failures = validateStructure(plan);
  const actualHash = tryHashPlan(plan);
  if (actualHash === null) failures.push('execution plan content cannot be hashed');
  else if (plan?.hash !== actualHash) failures.push('execution plan content hash mismatch');

  const state = readState(changeDir);
  if (state.execution_plan_hash !== plan?.hash) {
    failures.push('execution plan summary does not match state');
  }
  if (state.execution_mode !== plan?.mode) {
    failures.push('execution plan mode does not match state');
  }
  if (plan?.artifacts_hash !== computeArtifactsHash(changeDir)) {
    failures.push('execution plan is stale: artifacts hash mismatch');
  }
  if (plan?.contract_hash !== computeContractHash(changeDir)) {
    failures.push('execution plan is stale: contract hash mismatch');
  }
  if (plan?.workflow !== state.workflow) {
    failures.push('execution plan workflow does not match state');
  }
  if (state.execution_plan_revision !== plan?.revision) {
    failures.push('execution plan revision does not match state');
  }
  if (state.revision != null && plan?.revision !== state.revision) {
    failures.push('execution plan revision does not match state');
  }
  if (plan?.workflow !== 'tweak') {
    if (plan?.recommendation === undefined) failures.push('execution plan recommendation is required for full/hotfix');
    if (plan?.recommendation_receipt === undefined) failures.push('execution plan recommendation receipt is required for full/hotfix');
    if (plan?.selection === undefined) failures.push('execution plan selection is required for full/hotfix');
  }
  if (plan?.recommendation_receipt !== undefined) {
    if (plan.recommendation_receipt.artifacts_hash !== plan.artifacts_hash) failures.push('execution plan recommendation receipt artifacts hash does not match plan');
    if (plan.recommendation_receipt.contract_hash !== plan.contract_hash) failures.push('execution plan recommendation receipt contract hash does not match plan');
    if (plan.recommendation_receipt.workflow !== plan.workflow) failures.push('execution plan recommendation receipt workflow does not match plan');
    if (stableJson(plan.recommendation_receipt.waves) !== stableJson(plan.waves)) failures.push('execution plan recommendation receipt waves do not match plan');
    if (stableJson(plan.recommendation_receipt.recommendation) !== stableJson(plan.recommendation)) failures.push('execution plan recommendation receipt does not match plan recommendation');
    const expectedRecommendationPlanRevision = plan.source === 'user-confirmed-revision'
      ? plan.revision - 1
      : null;
    if (plan.recommendation_receipt.execution_plan_revision_at_recommendation !== expectedRecommendationPlanRevision) {
      failures.push('execution plan recommendation receipt does not match the immediately prior plan revision');
    }
  }
  if (plan?.selection !== undefined && plan?.recommendation?.recommendation?.mode) {
    const followedRecommendation = plan.mode === plan.recommendation.recommendation.mode;
    if (plan.selection.followed_recommendation !== followedRecommendation) failures.push('execution plan selection does not match recommended mode');
    if (plan.selection.acknowledged_non_recommendation !== !followedRecommendation) failures.push('execution plan selection acknowledgement does not match recommended mode');
  }
  return { valid: failures.length === 0, failures, plan };
}

export function recordReview(changeDir, waveId, receipt) {
  const plan = readPlan(changeDir);
  const validation = validatePlan(changeDir, plan);
  if (!validation.valid) throw new Error(`Cannot record a review for an invalid execution plan: ${validation.failures.join('; ')}`);
  const wave = Array.isArray(plan?.waves) && plan.waves.find(candidate => candidate?.id === waveId);
  if (!wave) throw new Error(`Review receipt references unknown wave '${waveId}'`);
  const blockedBy = blockedDependencies(changeDir, plan, wave);
  if (blockedBy.length > 0) {
    throw new Error(`Wave '${waveId}' cannot be reviewed before dependencies have passing receipts: ${blockedBy.join(', ')}`);
  }
  if (!REVIEW_STATUSES.has(receipt?.status)) {
    throw new Error("Review receipt status must be 'pass' or 'fail'");
  }
  for (const field of ['base', 'head']) requireText(receipt?.[field], `receipt.${field}`);
  const paths = getOverlayPaths(changeDir);
  const planPaths = getPlanScopedPaths(changeDir, plan);
  mkdirSync(paths.reviews, { recursive: true });
  mkdirSync(planPaths.reviews, { recursive: true });
  const reportEvidence = validateReviewReportEvidence(changeDir, receipt?.report);
  const { base, head } = validateReviewRange(changeDir, receipt.base, receipt.head);
  const currentReview = readCurrentReviewEvidence(changeDir, waveId, plan);
  if (currentReview.blocker) {
    throw new Error(`Wave '${waveId}' cannot be reviewed while its failed report evidence is invalid: ${currentReview.blocker}`);
  }
  const previousReceipt = currentReview.receipt;
  const previousRepair = readRepairState(changeDir, plan, waveId);
  if (previousRepair?.status === 'adjudication-required') {
    throw new Error(`Wave '${waveId}' requires adjudication before another review can be recorded`);
  }
  if (previousReceipt?.status === 'pass') {
    throw new Error(`Wave '${waveId}' already has a passing review receipt`);
  }
  validateRepairContinuity(previousReceipt, previousRepair, { status: receipt.status, base, head, report: reportEvidence.path });

  const savedReceipt = {
    status: receipt.status,
    base,
    head,
    report: reportEvidence.path,
    report_sha256: reportEvidence.sha256,
    plan_hash: plan.hash,
    plan_revision: plan.revision,
    recorded_at: new Date().toISOString(),
  };
  // Keep the established root receipt as a compatibility mirror, while the
  // authoritative current-plan copy preserves history across plan revisions.
  // Both retain the same receipt shape, including report integrity evidence.
  const serializedReceipt = `${JSON.stringify(savedReceipt, null, 2)}\n`;
  atomicWrite(join(paths.reviews, `${safeFileName(waveId)}.json`), serializedReceipt);
  atomicWrite(join(planPaths.reviews, `${safeFileName(waveId)}.json`), serializedReceipt);
  updateRepairState(changeDir, plan, waveId, previousRepair, previousReceipt, savedReceipt);
  if (savedReceipt.status === 'pass') {
    // Task briefs, diff packages, and progress notes are regenerable for this
    // exact plan. Receipt and repair evidence deliberately live beside, not in,
    // this directory and must remain available to closing/repair guards.
    rmSync(getPlanScopedPaths(changeDir, plan).workspace, { recursive: true, force: true });
  }
  return savedReceipt;
}

/**
 * Returns the current plan's receipt for one wave. Receipts from a previous
 * revision/hash are never evidence for the current plan.
 */
export function readCurrentReview(changeDir, waveId, plan = readPlan(changeDir)) {
  return readCurrentReviewEvidence(changeDir, waveId, plan).receipt;
}

function readCurrentReviewEvidence(changeDir, waveId, plan = readPlan(changeDir)) {
  if (!plan) return { receipt: null, blocker: null };
  const currentScope = getPlanScopedPaths(changeDir, plan);
  const currentPath = join(currentScope.reviews, `${safeFileName(waveId)}.json`);
  const legacyPath = join(getOverlayPaths(changeDir).reviews, `${safeFileName(waveId)}.json`);
  // Newer callers may have written a scoped receipt, but the established
  // root receipt remains the compatibility source until a future format
  // migration. In either case the plan identity below is mandatory.
  const filePath = existsSync(currentPath) ? currentPath : legacyPath;
  if (!existsSync(filePath)) return { receipt: null, blocker: null };
  try {
    const receipt = JSON.parse(readFileSync(filePath, 'utf8'));
    if (receipt?.plan_hash !== plan.hash || receipt?.plan_revision !== plan.revision) return { receipt: null, blocker: null };
    const range = validateReviewRange(changeDir, receipt?.base, receipt?.head);
    if (receipt.base !== range.base || receipt.head !== range.head) return { receipt: null, blocker: null };
    // Reports remain evidence only while their safety and content identity can
    // be re-established. A missing hash is accepted for legacy receipts, but
    // all newly written receipts bind the report body to the review result.
    const evidence = validateReviewReportEvidence(changeDir, receipt.report);
    if (receipt.report_sha256 !== undefined && receipt.report_sha256 !== evidence.sha256) {
      throw new Error('review report evidence content no longer matches its receipt');
    }
    return { receipt, blocker: null };
  } catch (error) {
    // A corrupted pass receipt is treated as absent so the wave can be
    // reviewed again. A failed receipt is different: reopening it would erase
    // the repair-chain evidence and permit an unaudited retry.
    try {
      const receipt = JSON.parse(readFileSync(filePath, 'utf8'));
      if (receipt?.plan_hash === plan.hash && receipt?.plan_revision === plan.revision && receipt?.status === 'fail') {
        return { receipt: null, blocker: `failed review report evidence is invalid: ${error.message}` };
      }
    } catch {
      // An unreadable receipt has no trustworthy status to preserve.
    }
    return { receipt: null, blocker: null };
  }
}

/**
 * Machine-readable execution status used by `ssf execution show`. A wave is
 * eligible when it has no current receipt, or its current receipt failed and
 * is therefore retryable, and all declared dependencies have passing receipts.
 */
export function describeWaves(changeDir, plan = readPlan(changeDir)) {
  if (!plan || !Array.isArray(plan.waves)) return [];
  return plan.waves.map(wave => {
    const review = readCurrentReviewEvidence(changeDir, wave.id, plan);
    const receipt = review.receipt;
    const blockers = [
      ...blockedDependencies(changeDir, plan, wave),
      ...(review.blocker ? [review.blocker] : []),
    ];
    const repair = describeRepairState(changeDir, plan, wave.id, receipt);
    const retryable = receipt?.status === 'fail' && repair.status !== 'adjudication-required';
    return {
      id: wave.id,
      strategy: wave.strategy,
      tasks: wave.tasks,
      depends_on: wave.depends_on,
      eligible: (receipt === null || retryable) && blockers.length === 0,
      retryable,
      receipt,
      blockers,
      repair,
    };
  });
}

function validateRepairContinuity(previousReceipt, previousRepair, nextReceipt) {
  if (previousReceipt?.status !== 'fail') return;
  const previousHead = previousRepair?.previous_head ?? previousReceipt.head;
  if (!previousHead) throw new Error('Repair state is missing the previous review head');

  // A failed re-review must examine a repair that starts at the prior review
  // head. A pass may also certify the exact original range: this preserves the
  // established fail→pass receipt flow for a corrected review finding.
  const repeatsPreviousRange = nextReceipt.status === 'pass'
    && nextReceipt.base === previousReceipt.base
    && nextReceipt.head === previousReceipt.head;
  if (nextReceipt.base !== previousHead && !repeatsPreviousRange) {
    throw new Error('Repair review base must equal the previous review head so repair ranges are continuous');
  }
}

function updateRepairState(changeDir, plan, waveId, previousRepair, previousReceipt, receipt) {
  const paths = getPlanScopedPaths(changeDir, plan);
  mkdirSync(paths.repairState, { recursive: true });
  const statePath = join(paths.repairState, `${safeFileName(waveId)}.json`);
  const now = new Date().toISOString();
  const priorFailures = Array.isArray(previousRepair?.failures) ? previousRepair.failures : [];
  let state;

  if (receipt.status === 'fail') {
    const failures = [...priorFailures, reviewEvidence(receipt)];
    state = {
      plan_hash: plan.hash,
      plan_revision: plan.revision,
      wave_id: waveId,
      status: failures.length >= MAX_REPAIR_FAILURES ? 'adjudication-required' : 'repairing',
      failure_count: failures.length,
      previous_head: receipt.head,
      previous_report: receipt.report,
      failures,
      updated_at: now,
    };
  } else if (previousReceipt?.status === 'fail' || previousRepair?.failure_count > 0) {
    state = {
      plan_hash: plan.hash,
      plan_revision: plan.revision,
      wave_id: waveId,
      status: 'resolved',
      failure_count: priorFailures.length,
      previous_head: receipt.head,
      previous_report: previousRepair?.previous_report ?? priorFailures.at(-1)?.report ?? null,
      failures: priorFailures,
      resolution: reviewEvidence(receipt),
      updated_at: now,
    };
  } else {
    // A first-pass receipt does not begin a repair chain. Do not manufacture
    // repair evidence for it, but still leave no stale state for this wave.
    if (existsSync(statePath)) rmSync(statePath, { force: true });
    return null;
  }
  atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

function reviewEvidence(receipt) {
  return {
    base: receipt.base,
    head: receipt.head,
    report: receipt.report,
    recorded_at: receipt.recorded_at,
  };
}

function readRepairState(changeDir, plan, waveId) {
  if (!plan) return null;
  const statePath = join(getPlanScopedPaths(changeDir, plan).repairState, `${safeFileName(waveId)}.json`);
  if (!existsSync(statePath)) return null;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (state?.plan_hash !== plan.hash || state?.plan_revision !== plan.revision || state?.wave_id !== waveId) return null;
    if (!['repairing', 'resolved', 'adjudication-required'].includes(state.status)) return null;
    if (!Number.isInteger(state.failure_count) || state.failure_count < 1 || !Array.isArray(state.failures)
      || state.failures.length !== state.failure_count || !isNonEmptyText(state.previous_head)
      || !isNonEmptyText(state.previous_report)) return null;
    return state;
  } catch {
    return null;
  }
}

function describeRepairState(changeDir, plan, waveId, receipt) {
  const state = readRepairState(changeDir, plan, waveId);
  if (state) return state;
  if (receipt?.status === 'fail') {
    // A valid legacy fail receipt predates repair-state. It remains retryable
    // for compatibility, but has no fabricated audit history.
    return {
      status: 'repairing', failure_count: 1, previous_head: receipt.head,
      previous_report: receipt.report, failures: [],
    };
  }
  return {
    status: 'not-needed', failure_count: 0, previous_head: null,
    previous_report: null, failures: [],
  };
}

function validateReviewReportEvidence(changeDir, report) {
  requireText(report, 'receipt.report');
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(report)) {
    throw new Error('Review report evidence path is unsafe');
  }

  const { changeRoot, reviewsDir } = getPhysicalReviewsDirectory(changeDir);
  const reportPath = isAbsolute(report) ? resolve(report) : resolve(changeRoot, report);

  let metadata;
  try {
    metadata = lstatSync(reportPath);
  } catch (error) {
    throw new Error(`Review report evidence cannot be read: ${error.message}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Review report evidence must be a regular file');
  }
  if (metadata.size === 0) {
    throw new Error('Review report evidence must be non-empty');
  }
  const realReportPath = realpathSync(reportPath);
  const realOverlayRelativePath = relative(reviewsDir, realReportPath);
  if (realOverlayRelativePath === '' || realOverlayRelativePath === '..' || realOverlayRelativePath.startsWith(`..${sep}`) || isAbsolute(realOverlayRelativePath)) {
    throw new Error('Review report evidence must resolve inside the change review overlay');
  }
  return {
    path: relative(changeRoot, realReportPath),
    sha256: `sha256:${createHash('sha256').update(readFileSync(realReportPath)).digest('hex')}`,
  };
}

function getPhysicalReviewsDirectory(changeDir) {
  let changeRoot;
  try {
    changeRoot = realpathSync(changeDir);
  } catch (error) {
    throw new Error(`Review report evidence cannot resolve the change directory: ${error.message}`);
  }

  let directory = changeRoot;
  for (const component of ['.superpowers', 'sdd', 'reviews']) {
    directory = join(directory, component);
    let metadata;
    try {
      metadata = lstatSync(directory);
    } catch (error) {
      throw new Error(`Review report evidence cannot read the ${component} overlay directory: ${error.message}`);
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('Review report evidence requires physical .superpowers/sdd/reviews overlay directories');
    }
  }
  return { changeRoot, reviewsDir: directory };
}

function validateReviewRange(changeDir, base, head) {
  const gitRoot = getGitRoot(changeDir);
  const resolvedBase = resolveGitCommit(gitRoot, base, 'base');
  const resolvedHead = resolveGitCommit(gitRoot, head, 'head');
  try {
    execFileSync('git', ['-C', gitRoot, 'merge-base', '--is-ancestor', resolvedBase, resolvedHead], {
      stdio: 'ignore',
    });
  } catch {
    throw new Error('Review receipt base must be an ancestor of head');
  }
  return { base: resolvedBase, head: resolvedHead };
}

function getGitRoot(changeDir) {
  try {
    return execFileSync('git', ['-C', changeDir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error('Review receipts require the change directory to be inside a Git work tree');
  }
}

function resolveGitCommit(gitRoot, revision, field) {
  try {
    return execFileSync('git', ['-C', gitRoot, 'rev-parse', '--verify', `${revision}^{commit}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error(`Review receipt ${field} must name an existing Git commit`);
  }
}

function blockedDependencies(changeDir, plan, wave) {
  if (!Array.isArray(wave?.depends_on)) return [];
  return wave.depends_on.filter(dependency => readCurrentReview(changeDir, dependency, plan)?.status !== 'pass');
}

function validateStructure(plan) {
  const failures = [];
  if (!isObject(plan)) return ['execution plan must be an object'];
  if (!EXECUTION_MODES.includes(plan.mode)) failures.push('execution plan mode is invalid');
  if (typeof plan.source !== 'string' || !plan.source.trim()) failures.push('execution plan source is required');
  if (!isNonEmptyText(plan.rationale)) failures.push('execution plan rationale is required');
  if (plan.recommendation !== undefined) {
    if (!isObject(plan.recommendation)) {
      failures.push('execution plan recommendation must be an object');
    } else {
      if (!isObject(plan.recommendation.recommendation) || !EXECUTION_MODES.includes(plan.recommendation.recommendation.mode)) {
        failures.push('execution plan recommendation mode is invalid');
      }
      if (!Array.isArray(plan.recommendation.recommendation?.reasons) || plan.recommendation.recommendation.reasons.some(reason => !isNonEmptyText(reason))) {
        failures.push('execution plan recommendation reasons must be non-empty strings');
      }
      if (!isObject(plan.recommendation.facts)) failures.push('execution plan recommendation facts must be an object');
      if (!Array.isArray(plan.recommendation.available_modes) || plan.recommendation.available_modes.some(mode => !EXECUTION_MODES.includes(mode))) {
        failures.push('execution plan recommendation available_modes are invalid');
      }
    }
  }
  if (plan.recommendation_receipt !== undefined) {
    if (!isObject(plan.recommendation_receipt)) {
      failures.push('execution plan recommendation receipt must be an object');
    } else {
      if (!isObject(plan.recommendation_receipt.recommendation)) failures.push('execution plan recommendation receipt payload is required');
      if (!Array.isArray(plan.recommendation_receipt.waves)) failures.push('execution plan recommendation receipt waves must be an array');
      if (!isNullableHash(plan.recommendation_receipt.artifacts_hash)) failures.push('execution plan recommendation receipt artifacts hash is invalid');
      if (!isNullableHash(plan.recommendation_receipt.contract_hash)) failures.push('execution plan recommendation receipt contract hash is invalid');
      if (!isNonEmptyText(plan.recommendation_receipt.workflow)) failures.push('execution plan recommendation receipt workflow is invalid');
      if (plan.recommendation_receipt.execution_plan_revision_at_recommendation !== null
        && (!Number.isInteger(plan.recommendation_receipt.execution_plan_revision_at_recommendation)
          || plan.recommendation_receipt.execution_plan_revision_at_recommendation < 1)) {
        failures.push('execution plan recommendation receipt plan revision is invalid');
      }
      if (!isNonEmptyText(plan.recommendation_receipt.created_at)) failures.push('execution plan recommendation receipt timestamp is invalid');
      if (typeof plan.recommendation_receipt.hash !== 'string' || !plan.recommendation_receipt.hash.startsWith('sha256:')) failures.push('execution plan recommendation receipt hash is invalid');
    }
  }
  if (plan.selection !== undefined) {
    if (!isObject(plan.selection)) {
      failures.push('execution plan selection must be an object');
    } else {
      if (plan.selection.confirmed !== true) failures.push('execution plan selection must be confirmed');
      if (typeof plan.selection.followed_recommendation !== 'boolean') failures.push('execution plan selection must record recommendation alignment');
      if (typeof plan.selection.acknowledged_non_recommendation !== 'boolean') failures.push('execution plan selection must record non-recommendation acknowledgement');
      if (plan.selection.followed_recommendation === plan.selection.acknowledged_non_recommendation) {
        failures.push('execution plan selection acknowledgement conflicts with recommendation alignment');
      }
    }
  }
  if (!Array.isArray(plan.waves)) {
    failures.push('execution plan waves must be an array');
    return failures;
  }

  const ids = new Set();
  const taskOwners = new Map();
  for (const [index, wave] of plan.waves.entries()) {
    const label = `wave ${index + 1}`;
    if (!isObject(wave)) {
      failures.push(`${label} must be an object`);
      continue;
    }
    if (!isNonEmptyText(wave.id)) failures.push(`${label} id is required`);
    else if (ids.has(wave.id)) failures.push(`duplicate wave id '${wave.id}'`);
    else ids.add(wave.id);
    if (!WAVE_STRATEGIES.has(wave.strategy)) failures.push(`${label} strategy is invalid`);
    if (!Array.isArray(wave.tasks) || wave.tasks.length === 0) {
      failures.push(`${label} must include at least one task`);
    } else {
      if (wave.tasks.some(task => !isNonEmptyText(task))) failures.push(`${label} tasks must be non-empty strings`);
      for (const task of wave.tasks.filter(isNonEmptyText)) {
        const priorWaveId = taskOwners.get(task);
        if (priorWaveId !== undefined) {
          failures.push(`duplicate task id '${task}' appears in waves '${priorWaveId}' and '${wave.id}'`);
        } else {
          taskOwners.set(task, wave.id);
        }
      }
      if (wave.strategy === 'parallel' && new Set(wave.tasks).size !== wave.tasks.length) {
        failures.push(`parallel wave '${wave.id}' contains duplicate tasks`);
      }
    }
    if (!Array.isArray(wave.depends_on)) failures.push(`${label} depends_on must be an array`);
    else if (wave.depends_on.some(id => !isNonEmptyText(id))) failures.push(`${label} dependencies must be non-empty strings`);
  }

  for (const wave of plan.waves.filter(isObject)) {
    if (!Array.isArray(wave.depends_on) || !isNonEmptyText(wave.id)) continue;
    for (const dependency of wave.depends_on) {
      if (dependency === wave.id) failures.push(`wave '${wave.id}' cannot depend on itself`);
      else if (isNonEmptyText(dependency) && !ids.has(dependency)) {
        failures.push(`wave '${wave.id}' depends on unknown wave '${dependency}'`);
      }
    }
  }
  const canCheckCycles = plan.waves.every(wave => isObject(wave)
    && isNonEmptyText(wave.id) && Array.isArray(wave.depends_on));
  if (canCheckCycles && !failures.some(failure => /duplicate wave id|unknown wave|cannot depend on itself/.test(failure))
    && hasDependencyCycle(plan.waves)) {
    failures.push('execution plan waves contain a dependency cycle');
  }
  return failures;
}

function hasDependencyCycle(waves) {
  const dependencies = new Map(waves.map(wave => [wave.id, wave.depends_on]));
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of dependencies.get(id) || []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...dependencies.keys()].some(visit);
}

function hashPlan(plan) {
  const { hash, ...content } = plan;
  return `sha256:${createHash('sha256').update(stableJson(content)).digest('hex')}`;
}

function tryHashPlan(plan) {
  if (!isObject(plan)) return null;
  try {
    return hashPlan(plan);
  } catch {
    return null;
  }
}

function stableJson(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (seen.has(value)) throw new Error('circular plan data');
  seen.add(value);
  if (Array.isArray(value)) {
    const result = `[${value.map(item => stableJson(item, seen)).join(',')}]`;
    seen.delete(value);
    return result;
  }
  const result = `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key], seen)}`).join(',')}}`;
  seen.delete(value);
  return result;
}

function writeExecutionPlanSummary(changeDir, plan) {
  const statePath = join(changeDir, '.spec-superflow.yaml');
  const state = readState(changeDir);
  const original = existsSync(statePath)
    ? readFileSync(statePath, 'utf8')
    : `state: ${state.state}\nworkflow: ${state.workflow}\n`;
  const content = [
    ['revision', plan.revision],
    ['execution_mode', plan.mode],
    ['execution_plan_hash', plan.hash],
    ['execution_plan_revision', plan.revision],
  ].reduce((current, [field, value]) => setStateField(current, field, value), original);
  atomicWrite(statePath, content);
}

function setStateField(content, field, value) {
  const line = `${field}: ${value}`;
  const expression = new RegExp(`^${field}:\\s*.*$`, 'm');
  return expression.test(content)
    ? content.replace(expression, line)
    : `${content.replace(/\n*$/, '\n')}\n${line}\n`;
}

function atomicWrite(targetPath, content) {
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tempPath, content, 'utf8');
  renameSync(tempPath, targetPath);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNullableHash(value) {
  return value === null || (typeof value === 'string' && value.startsWith('sha256:'));
}

function requireText(value, field) {
  if (!isNonEmptyText(value)) throw new Error(`${field} is required`);
}

function safeFileName(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}
