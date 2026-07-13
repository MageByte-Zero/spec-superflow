#!/usr/bin/env node
// scripts/guard/guard.mjs — dimension-based phase transition guard
// Usage: node guard.mjs check <change-dir> <from-state> <to-state> [--json]
import { parseArgs } from 'node:util';
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

// Transition matrix: <from>:<to> → required check dimensions
const TRANSITION_CHECKS = {
  // Forward transitions
  'exploring:specifying':           ['artifacts-exist'],
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
  'closing:specifying':             [],

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
  },
  tweak: {
    'exploring:approved-for-build': [],
    // Tweak remains a low-risk fast path: it is intentionally exempt from
    // execution-plan and per-wave review receipt requirements.
    'approved-for-build:executing': ['artifacts-exist', 'contract-fresh', 'dp-gate-passed'],
    'executing:closing': ['tasks-complete', 'tests-passing', 'specs-merged'],
    'debugging:executing': ['contract-fresh'],
  },
};

const TRANSITION_WORKFLOW_REQUIREMENTS = {
  'exploring:bridging': ['hotfix'],
  'exploring:approved-for-build': ['tweak'],
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

function resolveDimensions(key, workflow) {
  return WORKFLOW_TRANSITION_CHECKS[workflow]?.[key] ?? TRANSITION_CHECKS[key];
}

async function main() {
  const { positionals, values } = parseArgs({
    options: {
      json: { type: 'boolean', default: false },
      workflow: { type: 'string', default: 'full' },
    },
    allowPositionals: true,
  });

  const subcommand = positionals[0];
  if (subcommand !== 'check') {
    console.error('Usage: guard.mjs check <change-dir> <from-state> <to-state> [--json] [--workflow <mode>]');
    process.exit(2);
  }

  const changeDir = positionals[1];
  const fromState = positionals[2];
  const toState = positionals[3];
  const useJson = values.json;
  const workflow = values.workflow;

  const VALID_WORKFLOWS = ['full', 'hotfix', 'tweak'];
  if (!VALID_WORKFLOWS.includes(workflow)) {
    console.error(`Invalid workflow: ${workflow}. Must be one of: ${VALID_WORKFLOWS.join(', ')}`);
    process.exit(2);
  }

  if (!changeDir || !fromState || !toState) {
    console.error('Usage: guard.mjs check <change-dir> <from-state> <to-state> [--json]');
    process.exit(2);
  }

  const key = `${fromState}:${toState}`;
  const dimensions = resolveDimensions(key, workflow);

  if (!dimensions) {
    const valid = Object.keys(TRANSITION_CHECKS).join(', ');
    const msg = `Unknown transition: ${fromState} -> ${toState}. Valid transitions: ${valid}`;
    if (useJson) console.log(JSON.stringify({ pass: false, checks: [], error: msg }));
    else console.error(msg);
    process.exit(1);
  }

  const workflowCheck = checkWorkflowAllowed(key, workflow);
  if (!workflowCheck.pass) {
    if (useJson) {
      console.log(JSON.stringify({ pass: false, checks: workflowCheck.checks }, null, 2));
    } else {
      console.error('Guard checks failed:');
      for (const c of workflowCheck.checks) {
        for (const f of c.failures) {
          console.error(`  [FAIL] ${c.dimension}: ${f}`);
        }
      }
    }
    process.exit(1);
  }

  if (dimensions.length === 0) {
    const result = { pass: true, checks: [] };
    if (useJson) console.log(JSON.stringify(result));
    else console.log('All checks passed (no checks required for this transition).');
    process.exit(0);
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
    console.log(JSON.stringify({ pass, checks }, null, 2));
  } else {
    if (pass) {
      console.log('All checks passed.');
    } else {
      console.error('Guard checks failed:');
      for (const c of checks) {
        if (!c.pass) {
          for (const f of c.failures) {
            console.error(`  [FAIL] ${c.dimension}: ${f}`);
          }
        }
      }
    }
  }

  process.exit(pass ? 0 : 1);
}

main().catch(err => {
  console.error('Guard error:', err.message);
  process.exit(1);
});
