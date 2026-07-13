import { readCurrentReview, readPlan, validatePlan } from '../../lib/execution-plan.mjs';

/**
 * Verifies that every wave in the current execution plan has a passing review
 * receipt. A failed or malformed receipt is a blocking result, never a signal
 * that a later wave may proceed to closing.
 */
export function checkExecutionReviewsPassed(changeDir) {
  const plan = readPlan(changeDir);
  if (!plan) {
    // This dimension only evaluates receipts. Full/hotfix transitions pair it
    // with execution-plan-ready, which rejects a missing plan; tweak omits
    // this dimension entirely. Keep the missing-plan result owned by that
    // dedicated dimension rather than duplicating it here.
    return { pass: true, failures: [] };
  }

  const validation = validatePlan(changeDir, plan);
  if (!validation.valid) {
    return { pass: false, failures: validation.failures };
  }

  const failures = [];
  for (const wave of plan.waves) {
    const receipt = readCurrentReview(changeDir, wave.id, plan);
    if (!receipt) {
      failures.push(`review receipt missing for planned wave '${wave.id}'. Record a passing review before closing.`);
      continue;
    }
    if (receipt?.status !== 'pass') {
      failures.push(`review receipt for planned wave '${wave.id}' has status '${receipt?.status ?? 'missing'}'; expected 'pass'.`);
    }
  }

  return { pass: failures.length === 0, failures };
}
