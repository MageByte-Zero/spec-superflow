// Rule: no-redundant-checks
// Detects: Skill-internal validation that duplicates guard checks
// Detects: Same checklist items repeated across multiple skills

const GUARD_CHECK_DIMENSIONS = [
  'artifacts-exist', 'schema-valid', 'contract-fresh', 'tasks-complete', 'tests-passing',
];

const REDUNDANT_PATTERNS = [
  { pattern: /proposal\.md.*has.*## Why/i, dimension: 'schema-valid' },
  { pattern: /specs?\/.*valid/i, dimension: 'schema-valid' },
  { pattern: /contract.*fresh|stale.*contract|contract.*stale/i, dimension: 'contract-fresh' },
  { pattern: /tasks?.*complete|all.*checked/i, dimension: 'tasks-complete' },
  { pattern: /tests?.*pass/i, dimension: 'tests-passing' },
  { pattern: /artifacts?.*exist|file.*present/i, dimension: 'artifacts-exist' },
];

export default {
  name: 'no-redundant-checks',

  async check(skillName, content, ctx) {
    const issues = [];

    // Skills that are expected to do validation (NOT redundant):
    // - spec-writer: validates artifacts it just created (primary validation)
    // - guard: this IS the guard system
    // Redundancy only applies when a skill re-checks what guard already checks
    const SKILLS_THAT_OWN_VALIDATION = ['spec-writer', 'workflow-start'];

    if (SKILLS_THAT_OWN_VALIDATION.includes(skillName)) {
      return issues; // These skills legitimately validate
    }

    // For other skills, flag explicit re-checks of guard dimensions
    for (const { pattern, dimension } of REDUNDANT_PATTERNS) {
      if (pattern.test(content)) {
        // Check if this is the skill's own checklist (allowed) or a duplicated guard check
        const checklistSection = content.match(/##\s*(?:Self-Review|Quality Gate|Validation|Checklist|检查)/i);
        if (checklistSection) {
          issues.push({
            severity: 'warning',
            message: `Skill includes "${dimension}" check — guard.mjs already performs this check on transition. Consider referencing guard instead of re-checking.`,
          });
        }
      }
    }

    return issues;
  },
};
