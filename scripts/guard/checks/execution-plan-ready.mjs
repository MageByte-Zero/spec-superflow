import { readPlan, validatePlan } from '../../lib/execution-plan.mjs';
import { readState } from '../../lib/state-loader.mjs';

/**
 * Verifies that DP-4 refers to the current, persisted execution plan.
 *
 * A non-empty DP-4 field is not sufficient: it must name the current plan
 * revision, whose hashes, workflow, mode, and state summary remain current.
 */
export function checkExecutionPlanReady(changeDir) {
  const plan = readPlan(changeDir);
  if (!plan) {
    return {
      pass: false,
      failures: ['execution plan is missing. Record a current plan with "ssf execution plan" before entering executing.'],
    };
  }

  const validation = validatePlan(changeDir, plan);
  if (!validation.valid) {
    return { pass: false, failures: validation.failures };
  }

  const state = readState(changeDir);
  const expectedRevision = `plan revision ${plan.revision}`;
  const decision = typeof state.dp_4_result === 'string' ? state.dp_4_result : '';
  const revisionReference = new RegExp(`\\bplan revision\\s+${escapeRegExp(String(plan.revision))}\\b`, 'i');
  if (!revisionReference.test(decision)) {
    return {
      pass: false,
      failures: [`DP-4 must precisely reference current ${expectedRevision}; recorded value is '${decision || 'null'}'. Re-record the execution plan.`],
    };
  }

  return { pass: true, failures: [] };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
