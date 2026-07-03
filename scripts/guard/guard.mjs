#!/usr/bin/env node
// scripts/guard/guard.mjs — dimension-based phase transition guard
// Usage: node guard.mjs check <change-dir> <from-state> <to-state> [--json]
import { parseArgs } from 'node:util';
import { checkArtifactsExist } from './checks/artifacts-exist.mjs';
import { checkTasksComplete } from './checks/tasks-complete.mjs';
import { checkTestsPassing } from './checks/tests-passing.mjs';
import { checkContractFresh } from './checks/contract-fresh.mjs';
import { check as checkDpGate } from './checks/dp-gate-passed.mjs';

// Transition matrix: <from>:<to> → required check dimensions
const TRANSITION_CHECKS = {
  // Forward transitions
  'exploring:specifying':           ['artifacts-exist'],
  'specifying:bridging':            ['artifacts-exist', 'schema-valid'],
  'bridging:approved-for-build':    ['artifacts-exist', 'schema-valid', 'contract-fresh', 'dp-gate-passed'],
  'approved-for-build:executing':   ['artifacts-exist', 'contract-fresh', 'dp-gate-passed'],
  'executing:closing':              ['tasks-complete', 'tests-passing'],

  // Debugging side-path
  'executing:debugging':            [],
  'debugging:executing':            ['contract-fresh'],

  // Fast-path transitions (hotfix / tweak)
  'exploring:bridging':             ['artifacts-exist'],
  'exploring:approved-for-build':   ['artifacts-exist'],

  // Rewind transitions (scope change, contract drift, verification failure)
  'specifying:exploring':           [],
  'bridging:specifying':            [],
  'approved-for-build:bridging':    [],
  'executing:specifying':           [],
  'executing:bridging':             [],
  'closing:specifying':             [],
};

function applyWorkflowMode(checks, workflow) {
  if (workflow === 'full') return checks;

  const SKIP_DIMENSIONS = {
    hotfix: ['schema-valid'],
    tweak: ['schema-valid', 'contract-fresh', 'artifacts-exist'],
  };

  const skip = SKIP_DIMENSIONS[workflow] || [];
  return checks.map(check => {
    if (skip.includes(check.dimension)) {
      return { ...check, pass: true, skipped: true, failures: [] };
    }
    return check;
  });
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
  const dimensions = TRANSITION_CHECKS[key];

  if (!dimensions) {
    const valid = Object.keys(TRANSITION_CHECKS).join(', ');
    const msg = `Unknown transition: ${fromState} -> ${toState}. Valid transitions: ${valid}`;
    if (useJson) console.log(JSON.stringify({ pass: false, checks: [], error: msg }));
    else console.error(msg);
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
    'tasks-complete': (dir) => checkTasksComplete(dir),
    'tests-passing': (dir) => checkTestsPassing(dir),
    'dp-gate-passed': (dir) => checkDpGate(dir, fromState, toState),
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

  const finalChecks = applyWorkflowMode(checks, workflow);
  pass = finalChecks.every(c => c.pass);

  if (useJson) {
    console.log(JSON.stringify({ pass, checks: finalChecks }, null, 2));
  } else {
    if (pass) {
      console.log('All checks passed.');
    } else {
      console.error('Guard checks failed:');
      for (const c of finalChecks) {
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