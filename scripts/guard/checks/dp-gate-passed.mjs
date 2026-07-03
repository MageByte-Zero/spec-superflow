// scripts/guard/checks/dp-gate-passed.mjs — check that required decision points are recorded before allowing a transition
import { readState } from '../../lib/state-loader.mjs';

/**
 * Mapping of transitions that require specific DPs to be recorded.
 * Each entry lists the DP fields that must have a non-null value.
 */
const REQUIRED_DPS = {
  // DP-4: Execution mode must be selected before entering executing
  'approved-for-build→executing': ['dp_4_result'],
  // DP-3: Contract must be approved before executing (hard gate)
  'bridging→approved-for-build': ['dp_3_result'],
};

export function check(changeDir, fromState, toState) {
  const key = `${fromState}→${toState}`;
  const required = REQUIRED_DPS[key];

  if (!required) {
    return { pass: true, failures: [] };
  }

  const state = readState(changeDir);
  const failures = [];

  for (const dpField of required) {
    const value = state[dpField];
    if (value === null || value === undefined || value === '') {
      const dpNum = dpField.match(/dp_(\d+)_/)?.[1] || '?';
      failures.push(`DP-${dpNum} (${dpField}) is not recorded — this decision point must be confirmed before ${fromState} → ${toState}`);
    }
  }

  return { pass: failures.length === 0, failures };
}
