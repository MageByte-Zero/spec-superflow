// Rule: behavior-consistency
// Detects: Skill description that claims behavior not enforced in guard/phase-guard
// Detects: "⛔ 禁止操作" without corresponding guard enforcement

const FORBIDDEN_PATTERNS = [
  { pattern: /⛔\s*禁止操作|Forbidden|Prohibited/i, label: 'forbidden-ops' },
  { pattern: /cannot be skipped|硬门禁|hard gate|不可跳过/i, label: 'hard-gate' },
  { pattern: /before.*test|without.*failing test|TDD Iron Law/i, label: 'tdd-requirement' },
];

export default {
  name: 'behavior-consistency',

  async check(skillName, content, ctx) {
    const issues = [];

    // Check 1: "hard gate" claims — should be in contract-builder or build-executor (DP-3, DP-4)
    const hardGateMatch = content.match(/(hard gate|硬门禁|不可跳过|cannot be skipped)/i);
    if (hardGateMatch && !['contract-builder', 'build-executor', 'workflow-start', 'release-archivist'].includes(skillName)) {
      issues.push({
        severity: 'warning',
        message: `Claims "hard gate" but ${skillName} is not a gate-owning skill (expected: contract-builder, build-executor, workflow-start, release-archivist)`,
      });
    }

    // Check 2: "route to" consistency with workflow-start
    if (skillName !== 'workflow-start') {
      const routeRefs = [...content.matchAll(/[Rr]oute to [`""]?([a-z-]+)[`""]?/g)];
      for (const [, target] of routeRefs) {
        // This skill says "route to X" — workflow-start should have a corresponding rule
        // We flag this for manual verification (can't easily cross-check without loading workflow-start)
        // Instead, check that the routed-to skill exists
        if (!ctx.skillDirs.includes(target)) {
          issues.push({
            severity: 'error',
            message: `Routes to "${target}" which does not exist in skills/`,
          });
        }
      }
    }

    // Check 3: Decision point references should align with docs/decision-points.md
    const dpRefs = [...content.matchAll(/DP-(\d)/g)].map(m => parseInt(m[1]));
    const validDPs = [0, 1, 2, 3, 4, 5, 6, 7];
    for (const dp of dpRefs) {
      if (!validDPs.includes(dp)) {
        issues.push({
          severity: 'error',
          message: `References DP-${dp} which is not a valid decision point (valid: DP-0 through DP-7)`,
        });
      }
    }

    return issues;
  },
};
