#!/usr/bin/env node
// scripts/guard/guard.mjs — dimension-based phase transition guard
// Usage: node guard.mjs check <change-dir> <from-state> <to-state> [--json]
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { checkArtifactsExist } from './checks/artifacts-exist.mjs';
import { checkTasksComplete } from './checks/tasks-complete.mjs';
import { checkTestsPassing } from './checks/tests-passing.mjs';
import { checkContractFresh } from './checks/contract-fresh.mjs';
import { check as checkDpGate } from './checks/dp-gate-passed.mjs';
import { checkSpecsMerged } from './checks/specs-merged.mjs';
import { checkContractCurrent } from './checks/contract-current.mjs';
import { checkDp3Approved } from './checks/dp3-approved.mjs';
import { checkExecutionPlanReady } from './checks/execution-plan-ready.mjs';
import { checkExecutionReviewsPassed } from './checks/execution-reviews-passed.mjs';
import { readState } from '../lib/state-loader.mjs';
import { isDirectWorkflowReceipt, readWorkflowSelection } from '../lib/workflow-recommendation.mjs';

// Transition matrix: <from>:<to> → required check dimensions
const TRANSITION_CHECKS = {
  // Forward transitions
  'exploring:specifying':           [],
  'specifying:bridging':            ['artifacts-exist', 'schema-valid'],
  'bridging:approved-for-build':    ['artifacts-exist', 'schema-valid', 'contract-fresh', 'dp-gate-passed'],
  'approved-for-build:executing':   ['artifacts-exist', 'contract-fresh', 'dp-gate-passed', 'execution-plan-ready'],
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
    'approved-for-build:executing': ['contract-current', 'dp3-approved', 'execution-plan-ready'],
    'executing:closing': ['tests-passing', 'specs-merged', 'execution-plan-ready', 'execution-reviews-passed'],
  },
  tweak: {
    'exploring:approved-for-build': [],
    'approved-for-build:executing': [],
    'executing:closing': ['direct-test-result'],
    'debugging:executing': [],
  },
};

const DIRECT_SHORT_PATH_CHECKS = {
  'exploring:approved-for-build': ['direct-short-path'],
  'approved-for-build:executing': ['direct-short-path'],
  'executing:closing': ['direct-short-path', 'direct-test-result'],
  'debugging:executing': ['direct-short-path'],
};

const TRANSITION_WORKFLOW_REQUIREMENTS = {
  'exploring:bridging': ['hotfix'],
  'exploring:approved-for-build': ['tweak', 'quick', 'hotfix'],
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

function resolveDimensions(key, workflow, directShortPath) {
  if (workflow === 'quick') return DIRECT_SHORT_PATH_CHECKS[key] ?? TRANSITION_CHECKS[key];
  if (workflow === 'hotfix' && key === 'exploring:approved-for-build') {
    return DIRECT_SHORT_PATH_CHECKS[key];
  }
  if (workflow === 'hotfix' && directShortPath) {
    return DIRECT_SHORT_PATH_CHECKS[key] ?? WORKFLOW_TRANSITION_CHECKS.hotfix[key] ?? TRANSITION_CHECKS[key];
  }
  return WORKFLOW_TRANSITION_CHECKS[workflow]?.[key] ?? TRANSITION_CHECKS[key];
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
      failures: ['fast-path closing requires test_result starting with pass; DP-6 is not a substitute'],
  };
}

export async function runGuard(args, {
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

  const VALID_WORKFLOWS = ['full', 'hotfix', 'tweak', 'quick'];
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
    'schema-valid': async (dir) => (await import('./checks/schema-valid.mjs')).checkSchemaValid(dir),
    'contract-fresh': (dir) => checkContractFresh(dir),
    'contract-current': (dir) => checkContractCurrent(dir),
    'tasks-complete': (dir) => checkTasksComplete(dir),
    'tests-passing': (dir) => checkTestsPassing(dir),
    'specs-merged': (dir) => checkSpecsMerged(dir),
    'dp-gate-passed': (dir) => checkDpGate(dir, fromState, toState),
    'dp3-approved': (dir) => checkDp3Approved(dir),
    'execution-plan-ready': (dir) => checkExecutionPlanReady(dir),
    'execution-reviews-passed': (dir) => checkExecutionReviewsPassed(dir),
    'direct-short-path': (dir) => directShortPathCheck(dir, workflow),
    'direct-test-result': (dir) => directTestResultCheck(dir),
  };

  const checks = [];
  let pass = true;

  for (const dim of dimensions) {
    const runner = CHECK_RUNNERS[dim];
    const result = runner
      ? await runner(changeDir)
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

async function main() {
  try {
    const result = await runGuard(process.argv.slice(2));
    process.exitCode = result.exitCode;
  } catch (err) {
    console.error('Guard error:', err.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) main();
