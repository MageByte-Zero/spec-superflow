import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeArtifactsHash, computeContractHash } from './hash.mjs';
import { getOverlayPaths } from './sdd-overlay.mjs';
import { readState } from './state-loader.mjs';

export const EXECUTION_MODES = ['inline', 'batch-inline', 'sdd'];

const WAVE_STRATEGIES = new Set(['parallel', 'serial']);
const REVIEW_STATUSES = new Set(['pass', 'fail']);

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
  const previousPlan = readPlan(changeDir);
  if (previousPlan && (previousPlan.revision !== plan.revision || previousPlan.hash !== plan.hash)) {
    // Review evidence is scoped to exactly one plan revision. Removing it on
    // revision prevents an old wave ID from satisfying a changed plan.
    rmSync(paths.reviews, { recursive: true, force: true });
  }
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
  validateReviewReportEvidence(receipt?.report);

  const savedReceipt = {
    status: receipt.status,
    base: receipt.base,
    head: receipt.head,
    report: receipt.report,
    plan_hash: plan.hash,
    plan_revision: plan.revision,
    recorded_at: new Date().toISOString(),
  };
  const paths = getOverlayPaths(changeDir);
  mkdirSync(paths.reviews, { recursive: true });
  atomicWrite(join(paths.reviews, `${safeFileName(waveId)}.json`), `${JSON.stringify(savedReceipt, null, 2)}\n`);
  return savedReceipt;
}

/**
 * Returns the current plan's receipt for one wave. Receipts from a previous
 * revision/hash are never evidence for the current plan.
 */
export function readCurrentReview(changeDir, waveId, plan = readPlan(changeDir)) {
  if (!plan) return null;
  const filePath = join(getOverlayPaths(changeDir).reviews, `${safeFileName(waveId)}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const receipt = JSON.parse(readFileSync(filePath, 'utf8'));
    if (receipt?.plan_hash !== plan.hash || receipt?.plan_revision !== plan.revision) return null;
    // A passing receipt is current evidence only while its referenced report
    // remains safe and readable. Recheck it here because reports can be
    // deleted or replaced after the receipt was recorded.
    if (receipt?.status === 'pass') validateReviewReportEvidence(receipt.report);
    return receipt;
  } catch {
    return null;
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
    const receipt = readCurrentReview(changeDir, wave.id, plan);
    const blockers = blockedDependencies(changeDir, plan, wave);
    const retryable = receipt?.status === 'fail';
    return {
      id: wave.id,
      strategy: wave.strategy,
      tasks: wave.tasks,
      depends_on: wave.depends_on,
      eligible: (receipt === null || retryable) && blockers.length === 0,
      retryable,
      receipt,
      blockers,
    };
  });
}

function validateReviewReportEvidence(report) {
  requireText(report, 'receipt.report');
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(report)) {
    throw new Error('Review report evidence path is unsafe');
  }

  let metadata;
  try {
    metadata = lstatSync(report);
  } catch (error) {
    throw new Error(`Review report evidence cannot be read: ${error.message}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Review report evidence must be a regular file');
  }
  if (metadata.size === 0) {
    throw new Error('Review report evidence must be non-empty');
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
  if (plan.mode !== 'sdd' && plan.source !== 'user-override') {
    failures.push(`${plan.mode || 'execution plan'} requires an explicit user override`);
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
  if (Array.isArray(value)) return `[${value.map(item => stableJson(item, seen)).join(',')}]`;
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

function requireText(value, field) {
  if (!isNonEmptyText(value)) throw new Error(`${field} is required`);
}

function safeFileName(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}
