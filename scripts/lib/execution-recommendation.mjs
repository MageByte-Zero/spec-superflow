// Evidence-based execution-mode recommendation for DP-4.

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config-loader.mjs';
import { computeArtifactsHash, computeContractHash } from './hash.mjs';
import { getOverlayPaths } from './sdd-overlay.mjs';
import { readState } from './state-loader.mjs';

export function recommendExecutionModes({ workflow, taskCount, inlineThreshold, waves = [] }) {
  const normalizedWorkflow = typeof workflow === 'string' ? workflow : null;
  const normalizedTaskCount = Number.isInteger(taskCount) && taskCount >= 0 ? taskCount : null;
  const threshold = Number.isInteger(inlineThreshold) && inlineThreshold > 0 ? inlineThreshold : 3;
  const normalizedWaves = Array.isArray(waves) ? waves : [];
  const plannedTaskCount = normalizedWaves.reduce((count, wave) => (
    count + (Array.isArray(wave?.tasks) ? wave.tasks.length : 0)
  ), 0);
  const hasParallelWave = normalizedWaves.some(wave => wave?.strategy === 'parallel');
  const hasMultipleWaves = normalizedWaves.length > 1;
  const facts = {
    workflow: normalizedWorkflow,
    documented_task_count: normalizedTaskCount,
    planned_task_count: plannedTaskCount,
    planned_wave_count: normalizedWaves.length,
    has_parallel_wave: hasParallelWave,
    inline_threshold: threshold,
  };

  if (normalizedWorkflow === 'tweak') {
    return result(['inline'], 'inline', [
      'Tweak uses direct inline execution and is exempt from execution-plan and review-receipt gates.',
    ], facts);
  }

  if (hasParallelWave) {
    return result(['inline', 'batch-inline', 'sdd'], 'sdd', [
      'The declared execution waves include parallel work, which SDD can dispatch and review independently.',
    ], facts);
  }

  if (hasMultipleWaves) {
    return result(['inline', 'batch-inline', 'sdd'], 'sdd', [
      'The declared work spans multiple waves, so SDD keeps dependencies and review receipts explicit.',
    ], facts);
  }

  const effectiveTaskCount = plannedTaskCount || normalizedTaskCount;
  if (effectiveTaskCount === 1) {
    return result(['inline', 'batch-inline', 'sdd'], 'inline', [
      'The change has a single sequential task, so inline execution keeps the work focused without dispatch overhead.',
    ], facts);
  }

  if (effectiveTaskCount !== null && effectiveTaskCount > 1 && effectiveTaskCount <= threshold) {
    return result(['inline', 'batch-inline', 'sdd'], 'batch-inline', [
      `The ${effectiveTaskCount} sequential tasks are within the configured inline threshold of ${threshold}.`,
    ], facts);
  }

  return result(['inline', 'batch-inline', 'sdd'], 'sdd', [
    effectiveTaskCount === null
      ? 'The task count cannot be determined, so SDD is recommended until the execution shape is made explicit.'
      : `The ${effectiveTaskCount} tasks exceed the configured inline threshold of ${threshold}.`,
  ], facts);
}

export function recommendExecutionModesForChange(changeDir, waves = []) {
  const state = readState(changeDir);
  const config = loadConfig(changeDir);
  return recommendExecutionModes({
    workflow: state.workflow,
    taskCount: countDocumentedTasks(changeDir),
    inlineThreshold: config.execution.inlineThreshold,
    waves,
  });
}

export function createRecommendationReceipt(changeDir, waves = []) {
  const state = readState(changeDir);
  const receipt = {
    recommendation: recommendExecutionModesForChange(changeDir, waves),
    waves: normalizeWaves(waves),
    artifacts_hash: computeArtifactsHash(changeDir),
    contract_hash: computeContractHash(changeDir),
    workflow: state.workflow,
    execution_plan_revision_at_recommendation: state.execution_plan_revision ?? null,
    created_at: new Date().toISOString(),
  };
  receipt.hash = hashReceipt(receipt);
  return receipt;
}

export function writeRecommendationReceipt(changeDir, receipt) {
  const failures = validateRecommendationReceiptStructure(receipt);
  if (failures.length > 0) throw new Error(`Invalid execution recommendation: ${failures.join('; ')}`);
  const paths = getOverlayPaths(changeDir);
  mkdirSync(paths.root, { recursive: true });
  atomicWrite(paths.executionRecommendation, `${JSON.stringify(receipt, null, 2)}\n`);
  return readRecommendationReceipt(changeDir);
}

export function readRecommendationReceipt(changeDir) {
  const filePath = getOverlayPaths(changeDir).executionRecommendation;
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read execution recommendation: ${error.message}`);
  }
}

export function readCurrentRecommendationReceipt(changeDir, waves = [], expectedPlanRevision = null) {
  const receipt = readRecommendationReceipt(changeDir);
  if (!receipt) {
    throw new Error('Run "ssf execution recommend" for these waves before confirming an execution plan');
  }
  const failures = validateRecommendationReceipt(changeDir, receipt, waves, expectedPlanRevision);
  if (failures.length > 0) {
    throw new Error(`Run "ssf execution recommend" again before confirming an execution plan: ${failures.join('; ')}`);
  }
  return receipt;
}

export function validateRecommendationReceipt(changeDir, receipt, waves = [], expectedPlanRevision = null) {
  const failures = validateRecommendationReceiptStructure(receipt);
  if (receipt?.artifacts_hash !== computeArtifactsHash(changeDir)) failures.push('recommendation artifacts hash is stale');
  if (receipt?.contract_hash !== computeContractHash(changeDir)) failures.push('recommendation contract hash is stale');
  if (receipt?.workflow !== readState(changeDir).workflow) failures.push('recommendation workflow does not match state');
  if (stableJson(receipt?.waves) !== stableJson(normalizeWaves(waves))) failures.push('recommendation waves do not match the proposed execution plan');
  if (receipt?.execution_plan_revision_at_recommendation !== expectedPlanRevision) {
    failures.push('recommendation was not generated after the current execution plan revision');
  }
  return failures;
}

function countDocumentedTasks(changeDir) {
  const tasksPath = join(changeDir, 'tasks.md');
  if (!existsSync(tasksPath)) return null;
  return (readFileSync(tasksPath, 'utf8').match(/^- \[[ xX]\] /gm) || []).length;
}

function result(availableModes, mode, reasons, facts) {
  return {
    available_modes: availableModes,
    recommendation: { mode, reasons },
    facts,
  };
}

export function validateRecommendationReceiptStructure(receipt) {
  const failures = [];
  if (!isObject(receipt)) return ['execution recommendation must be an object'];
  if (!isObject(receipt.recommendation)) failures.push('execution recommendation payload is required');
  else {
    const recommendation = receipt.recommendation;
    if (!Array.isArray(recommendation.available_modes) || recommendation.available_modes.some(mode => !['inline', 'batch-inline', 'sdd'].includes(mode))) {
      failures.push('execution recommendation available modes are invalid');
    }
    if (!isObject(recommendation.recommendation) || !['inline', 'batch-inline', 'sdd'].includes(recommendation.recommendation.mode)) {
      failures.push('execution recommendation mode is invalid');
    }
    if (!Array.isArray(recommendation.recommendation?.reasons) || recommendation.recommendation.reasons.some(reason => typeof reason !== 'string' || !reason.trim())) {
      failures.push('execution recommendation reasons are invalid');
    }
    if (!isObject(recommendation.facts)) failures.push('execution recommendation facts are invalid');
  }
  if (!Array.isArray(receipt.waves)) failures.push('execution recommendation waves are invalid');
  if (!isNullableHash(receipt.artifacts_hash)) failures.push('execution recommendation artifacts hash is invalid');
  if (!isNullableHash(receipt.contract_hash)) failures.push('execution recommendation contract hash is invalid');
  if (typeof receipt.workflow !== 'string' || !receipt.workflow.trim()) failures.push('execution recommendation workflow is invalid');
  if (receipt.execution_plan_revision_at_recommendation !== null
    && (!Number.isInteger(receipt.execution_plan_revision_at_recommendation) || receipt.execution_plan_revision_at_recommendation < 1)) {
    failures.push('execution recommendation plan revision is invalid');
  }
  if (typeof receipt.created_at !== 'string' || !receipt.created_at.trim()) failures.push('execution recommendation timestamp is invalid');
  if (receipt.hash !== hashReceipt(receipt)) failures.push('execution recommendation hash mismatch');
  return failures;
}

function normalizeWaves(waves) {
  return Array.isArray(waves) ? waves.map(wave => ({
    id: wave?.id,
    strategy: wave?.strategy,
    tasks: Array.isArray(wave?.tasks) ? [...wave.tasks] : wave?.tasks,
    depends_on: Array.isArray(wave?.depends_on) ? [...wave.depends_on] : wave?.depends_on,
  })) : [];
}

export function hashReceipt(receipt) {
  const { hash, ...content } = receipt || {};
  return `sha256:${createHash('sha256').update(stableJson(content)).digest('hex')}`;
}

function stableJson(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (seen.has(value)) throw new Error('circular recommendation data');
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

function atomicWrite(targetPath, content) {
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tempPath, content, 'utf8');
  renameSync(tempPath, targetPath);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNullableHash(value) {
  return value === null || (typeof value === 'string' && value.startsWith('sha256:'));
}
