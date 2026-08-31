#!/usr/bin/env node
// scripts/guard/guard.mjs — dimension-based phase transition guard
// Usage: node guard.mjs check <change-dir> <from-state> <to-state> [--json]
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { checkArtifactsExist } from './checks/artifacts-exist.mjs';
import { checkSchemaValid } from './checks/schema-valid.mjs';
import { checkTasksComplete } from './checks/tasks-complete.mjs';
import { checkTasksCheckboxFormat } from './checks/tasks-checkbox-format.mjs';
import { checkTestsPassing } from './checks/tests-passing.mjs';
import { checkContractFresh } from './checks/contract-fresh.mjs';
import { check as checkDpGate } from './checks/dp-gate-passed.mjs';
import { checkSpecsMerged } from './checks/specs-merged.mjs';
import { checkContractCurrent } from './checks/contract-current.mjs';
import { checkDp3Approved } from './checks/dp3-approved.mjs';
import { checkExecutionPlanReady } from './checks/execution-plan-ready.mjs';
import { checkExecutionReviewsPassed } from './checks/execution-reviews-passed.mjs';
import { readState } from '../lib/state-loader.mjs';
import {
  hasLightweightCompletionEvidence,
  isDirectWorkflowReceipt,
  readWorkflowSelection,
} from '../lib/workflow-recommendation.mjs';

// Transition matrix: <from>:<to> → required check dimensions
const TRANSITION_CHECKS = {
  // Forward transitions
  'exploring:specifying':           [],
  'specifying:bridging':            ['artifacts-exist', 'schema-valid'],
  'bridging:approved-for-build':    ['artifacts-exist', 'schema-valid', 'contract-fresh', 'dp-gate-passed'],
  'approved-for-build:executing':   ['artifacts-exist', 'contract-fresh', 'dp-gate-passed', 'execution-plan-ready', 'tasks-checkbox-format'],
  'executing:closing':              ['tasks-complete', 'tests-passing', 'specs-merged', 'execution-plan-ready', 'execution-reviews-passed'],

  // Debugging side-path
  'executing:debugging':            [],
  'debugging:executing':            ['contract-fresh', 'execution-plan-ready'],

  // Fast-path transitions are workflow-gated; full workflow must reject them explicitly.
  'exploring:bridging':             [],
  'exploring:approved-for-build':   [],

  // Rewind transitions (scope change, contract drift, verification failure)
  'specifying:exploring':           [],
  'bridging:specifying':            [],
  'approved-for-build:specifying':  [],
  'approved-for-build:bridging':    [],
  'executing:specifying':           [],
  'executing:bridging':             [],

  // Abandon transitions (terminal)
  'exploring:abandoned':            [],
  'specifying:abandoned':           [],
  'bridging:abandoned':             [],
  'approved-for-build:abandoned':   [],
  'executing:abandoned':            [],
  'debugging:abandoned':            [],
};

const WORKFLOW_TRANSITION_CHECKS = {
  hotfix: {
    'exploring:bridging': [],
    'bridging:approved-for-build': ['contract-current', 'dp3-approved'],
    // hotfix 可能没有完整 tasks.md（review-findings-fix R2）：tasks-checkbox-format 仅挂 full 主表。
    'approved-for-build:executing': ['contract-current', 'dp3-approved', 'execution-plan-ready'],
    'executing:closing': ['tests-passing', 'specs-merged', 'execution-plan-ready', 'execution-reviews-passed'],
    // rewind/abandon（workflow-aware-guard B2）：legacy hotfix 行为不变，显式列出避免依赖 full fallback。
    'specifying:exploring': [],
    'bridging:specifying': [],
    'approved-for-build:specifying': [],
    'approved-for-build:bridging': [],
    'executing:specifying': [],
    'executing:bridging': [],
    'exploring:abandoned': [],
    'specifying:abandoned': [],
    'bridging:abandoned': [],
    'approved-for-build:abandoned': [],
    'executing:abandoned': [],
    'debugging:abandoned': [],
  },
  tweak: {
    'exploring:approved-for-build': [],
    'approved-for-build:executing': [],
    'executing:closing': ['direct-test-result'],
    'debugging:executing': [],
    // rewind/abandon（workflow-aware-guard B2）：纠正路径与退出路径保留，维度为空。
    'specifying:approved-for-build': [],
    'specifying:exploring': [],
    'bridging:specifying': [],
    'approved-for-build:specifying': [],
    'executing:specifying': [],
    'exploring:abandoned': [],
    'specifying:abandoned': [],
    'approved-for-build:abandoned': [],
    'executing:abandoned': [],
    'debugging:abandoned': [],
  },
};

// fast-path workflow（quick/lightweight/tweak/direct hotfix）不经过规划阶段：
// 命中此表的转换一律拒绝，并提示正确的 fast-path 入口（workflow-aware-guard B1）。
const FAST_PATH_REJECTED_TRANSITIONS = {
  'exploring:specifying':
    'this workflow does not include the planning phase; use exploring -> approved-for-build instead (or rewind to exploring first)',
  'specifying:bridging':
    'this workflow does not include the planning phase; use exploring -> approved-for-build instead (or rewind to exploring first)',
};

const DIRECT_SHORT_PATH_CHECKS = {
  'exploring:approved-for-build': ['direct-short-path'],
  // 回退跳级纠正（workflow-aware-guard B2，design 决策 3）：receipt 有效性已由 workflow
  // select/accept 把关，此 key 只提供"误入 specifying 后少走一步回退"的合法纠正路径。
  'specifying:approved-for-build': [],
  'approved-for-build:executing': ['direct-short-path'],
  'executing:closing': ['direct-short-path', 'direct-test-result'],
  'debugging:executing': ['direct-short-path'],
  // rewind/abandon（workflow-aware-guard B2）：行为与现状一致（放行）。
  'specifying:exploring': [],
  'bridging:specifying': [],
  'approved-for-build:specifying': [],
  'executing:specifying': [],
  'exploring:abandoned': [],
  'specifying:abandoned': [],
  'bridging:abandoned': [],
  'approved-for-build:abandoned': [],
  'executing:abandoned': [],
  'debugging:abandoned': [],
};

const LIGHTWEIGHT_SHORT_PATH_CHECKS = {
  ...DIRECT_SHORT_PATH_CHECKS,
  'executing:closing': ['direct-short-path', 'direct-test-result', 'lightweight-completion-evidence'],
};

const TRANSITION_WORKFLOW_REQUIREMENTS = {
  'exploring:bridging': ['hotfix'],
  'exploring:approved-for-build': ['tweak', 'quick', 'hotfix', 'lightweight'],
};

function checkWorkflowAllowed(key, workflow) {
  const allowed = TRANSITION_WORKFLOW_REQUIREMENTS[key];
  if (!allowed || allowed.includes(workflow)) return { pass: true, checks: [] };
  return {
    pass: false,
    checks: [{
      dimension: 'workflow-mode',
      pass: false,
      failures: [`${key.replace(':', ' -> ')} is a fast-path transition allowed only for workflow ${allowed.join(' or ')}; current workflow is ${workflow}`],
    }],
  };
}

// 导出表引用供测试断言维度归属（review-findings-fix R2）。
export function getTransitionCheckTables() {
  return {
    full: TRANSITION_CHECKS,
    hotfix: WORKFLOW_TRANSITION_CHECKS.hotfix,
    tweak: WORKFLOW_TRANSITION_CHECKS.tweak,
    directShortPath: DIRECT_SHORT_PATH_CHECKS,
    lightweightShortPath: LIGHTWEIGHT_SHORT_PATH_CHECKS,
    fastPathRejected: FAST_PATH_REJECTED_TRANSITIONS,
  };
}

// fast-path workflow 拒绝规划阶段转换（workflow-aware-guard B1）。返回形状与
// checkWorkflowAllowed 一致：{ pass: false, checks: [...] } 或 null（不适用）。
function checkFastPathRejected(key) {
  const reason = FAST_PATH_REJECTED_TRANSITIONS[key];
  if (!reason) return null;
  return {
    pass: false,
    checks: [{
      dimension: 'workflow-mode',
      pass: false,
      failures: [`${key.replace(':', ' -> ')} is rejected for this fast-path workflow: ${reason}`],
    }],
  };
}

// fast-path workflow 的转换解析不回退 full 主表（workflow-aware-guard B2，design 决策 2）。
function unknownTransitionFailure(key, workflow) {
  return {
    pass: false,
    checks: [{
      dimension: 'workflow-transition-unknown',
      pass: false,
      failures: [`transition '${key}' is not defined for workflow '${workflow}'; this workflow does not fall back to the full transition table`],
    }],
  };
}

function resolveDimensions(key, workflow, directShortPath) {
  if (workflow === 'quick') {
    const fastPathRejection = checkFastPathRejected(key);
    if (fastPathRejection) return fastPathRejection;
    const dimensions = DIRECT_SHORT_PATH_CHECKS[key];
    if (!dimensions) return unknownTransitionFailure(key, workflow);
    return dimensions;
  }
  if (workflow === 'lightweight') {
    const fastPathRejection = checkFastPathRejected(key);
    if (fastPathRejection) return fastPathRejection;
    const dimensions = LIGHTWEIGHT_SHORT_PATH_CHECKS[key];
    if (!dimensions) return unknownTransitionFailure(key, workflow);
    return dimensions;
  }
  if (workflow === 'tweak') {
    const fastPathRejection = checkFastPathRejected(key);
    if (fastPathRejection) return fastPathRejection;
    const dimensions = WORKFLOW_TRANSITION_CHECKS.tweak[key];
    if (!dimensions) return unknownTransitionFailure(key, workflow);
    return dimensions;
  }
  // legacy hotfix 保留专用表 + full fallback 链（约束：行为完全不变），但
  // fast-path 拒绝表优先——hotfix 不经过 specifying，规划阶段转换同样拒绝。
  if (workflow === 'hotfix') {
    const fastPathRejection = checkFastPathRejected(key);
    if (fastPathRejection) return fastPathRejection;
    if (key === 'exploring:approved-for-build') {
      return DIRECT_SHORT_PATH_CHECKS[key];
    }
    if (directShortPath) {
      return DIRECT_SHORT_PATH_CHECKS[key] ?? WORKFLOW_TRANSITION_CHECKS.hotfix[key] ?? TRANSITION_CHECKS[key];
    }
    return WORKFLOW_TRANSITION_CHECKS.hotfix[key] ?? TRANSITION_CHECKS[key];
  }
  return TRANSITION_CHECKS[key];
}

export function isDirectShortPath(record, state) {
  return isDirectWorkflowReceipt(record, state);
}

function directShortPathCheck(changeDir, workflow) {
  const state = readState(changeDir);
  const receipt = readWorkflowSelection(changeDir);
  if (!receipt.valid || !isDirectShortPath(receipt.record, state) || state.workflow !== workflow) {
    return {
      pass: false,
      failures: ['a valid direct receipt matching the current workflow is required for this short-path transition'],
    };
  }
  return { pass: true, failures: [] };
}

function directTestResultCheck(changeDir) {
  const testResult = readState(changeDir).test_result;
  if (typeof testResult === 'string' && testResult.trim().toLowerCase().startsWith('pass')) {
    return { pass: true, failures: [] };
  }
  return {
    pass: false,
    failures: ['fast-path closing requires test_result starting with pass; DP-6 is not a substitute. Fix: run `ssf state set <change-dir> test_result "pass: <verification summary>"` before transitioning to closing'],
  };
}

function lightweightCompletionEvidenceCheck(changeDir) {
  const receipt = readWorkflowSelection(changeDir);
  if (!receipt.valid || !hasLightweightCompletionEvidence(receipt.record)) {
    return {
      pass: false,
      failures: ['lightweight closing requires exactly one focused review and a persisted passing verification command/result'],
    };
  }
  return { pass: true, failures: [] };
}

export function runGuard(args, {
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const { positionals, values } = parseArgs({
    args,
    options: {
      json: { type: 'boolean', default: false },
      workflow: { type: 'string', default: 'full' },
    },
    allowPositionals: true,
  });

  const subcommand = positionals[0];
  if (subcommand !== 'check') {
    stderr.write('Usage: guard.mjs check <change-dir> <from-state> <to-state> [--json] [--workflow <mode>]\n');
    return { exitCode: 2 };
  }

  const changeDir = positionals[1];
  const fromState = positionals[2];
  const toState = positionals[3];
  const useJson = values.json;
  const workflow = values.workflow;

  const VALID_WORKFLOWS = ['full', 'hotfix', 'tweak', 'quick', 'lightweight'];
  if (!VALID_WORKFLOWS.includes(workflow)) {
    stderr.write(`Invalid workflow: ${workflow}. Must be one of: ${VALID_WORKFLOWS.join(', ')}\n`);
    return { exitCode: 2 };
  }

  if (!changeDir || !fromState || !toState) {
    stderr.write('Usage: guard.mjs check <change-dir> <from-state> <to-state> [--json]\n');
    return { exitCode: 2 };
  }

  const key = `${fromState}:${toState}`;
  const directShortPath = isDirectShortPath(readWorkflowSelection(changeDir).record, readState(changeDir));
  const dimensions = resolveDimensions(key, workflow, directShortPath);

  if (!dimensions) {
    const valid = Object.keys(TRANSITION_CHECKS).join(', ');
    const msg = `Unknown transition: ${fromState} -> ${toState}. Valid transitions: ${valid}`;
    if (useJson) stdout.write(`${JSON.stringify({ pass: false, checks: [], error: msg })}\n`);
    else stderr.write(`${msg}\n`);
    return { exitCode: 1 };
  }

  // workflow-aware 拒绝（workflow-mode / workflow-transition-unknown）：resolveDimensions
  // 返回失败形状而非维度数组，直接输出（workflow-aware-guard B1/B2）。
  if (!Array.isArray(dimensions)) {
    if (useJson) stdout.write(`${JSON.stringify(dimensions, null, 2)}\n`);
    else {
      stderr.write('Guard checks failed:\n');
      for (const c of dimensions.checks) {
        for (const f of c.failures) {
          stderr.write(`  [FAIL] ${c.dimension}: ${f}\n`);
        }
      }
    }
    return { exitCode: 1 };
  }

  const workflowCheck = checkWorkflowAllowed(key, workflow);
  if (!workflowCheck.pass) {
    if (useJson) {
      stdout.write(`${JSON.stringify({ pass: false, checks: workflowCheck.checks }, null, 2)}\n`);
    } else {
      stderr.write('Guard checks failed:\n');
      for (const c of workflowCheck.checks) {
        for (const f of c.failures) {
          stderr.write(`  [FAIL] ${c.dimension}: ${f}\n`);
        }
      }
    }
    return { exitCode: 1 };
  }

  if (dimensions.length === 0) {
    const result = { pass: true, checks: [] };
    if (useJson) stdout.write(`${JSON.stringify(result)}\n`);
    else stdout.write('All checks passed (no checks required for this transition).\n');
    return { exitCode: 0 };
  }

  const CHECK_RUNNERS = {
    'artifacts-exist': (dir) => checkArtifactsExist(dir),
    'schema-valid': (dir) => checkSchemaValid(dir),
    'contract-fresh': (dir) => checkContractFresh(dir),
    'contract-current': (dir) => checkContractCurrent(dir),
    'tasks-complete': (dir) => checkTasksComplete(dir),
    'tasks-checkbox-format': (dir) => checkTasksCheckboxFormat(dir),
    'tests-passing': (dir) => checkTestsPassing(dir),
    'specs-merged': (dir) => checkSpecsMerged(dir),
    'dp-gate-passed': (dir) => checkDpGate(dir, fromState, toState),
    'dp3-approved': (dir) => checkDp3Approved(dir),
    'execution-plan-ready': (dir) => checkExecutionPlanReady(dir),
    'execution-reviews-passed': (dir) => checkExecutionReviewsPassed(dir),
    'direct-short-path': (dir) => directShortPathCheck(dir, workflow),
    'direct-test-result': (dir) => directTestResultCheck(dir),
    'lightweight-completion-evidence': (dir) => lightweightCompletionEvidenceCheck(dir),
  };

  const checks = [];
  let pass = true;

  for (const dim of dimensions) {
    const runner = CHECK_RUNNERS[dim];
    const result = runner
      ? runner(changeDir)
      : { pass: false, failures: [`Unknown dimension: ${dim}`] };
    checks.push({ dimension: dim, pass: result.pass, failures: result.failures || [] });
    if (!result.pass) pass = false;
  }

  pass = checks.every(c => c.pass);

  if (useJson) {
    stdout.write(`${JSON.stringify({ pass, checks }, null, 2)}\n`);
  } else {
    if (pass) {
      stdout.write('All checks passed.\n');
    } else {
      stderr.write('Guard checks failed:\n');
      for (const c of checks) {
        if (!c.pass) {
          for (const f of c.failures) {
            stderr.write(`  [FAIL] ${c.dimension}: ${f}\n`);
          }
        }
      }
    }
  }

  return { exitCode: pass ? 0 : 1 };
}

function main() {
  try {
    const result = runGuard(process.argv.slice(2));
    process.exitCode = result.exitCode;
  } catch (err) {
    console.error('Guard error:', err.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) main();
