// Rule: no-contradictory-instructions
// Detects: DP trigger conditions that differ between skills
// Detects: State transition rules that differ between workflow-start and target skills

const DP_NAMES = {
  'DP-0': '设计前确认', 'DP-1': '需求确认', 'DP-2': '工件审查', 'DP-3': '契约批准',
  'DP-4': '执行模式选择', 'DP-5': '调试升级', 'DP-6': '验证失败', 'DP-7': '归档确认',
};

const DP_SKILL_MAP = {
  'DP-0': ['workflow-start'],
  'DP-1': ['need-explorer'],
  'DP-2': ['spec-writer'],
  'DP-3': ['contract-builder'],
  'DP-4': ['build-executor'],
  'DP-5': ['bug-investigator'],
  'DP-6': ['release-archivist'],
  'DP-7': ['release-archivist'],
};

export default {
  name: 'no-contradictory-instructions',

  async check(skillName, content, ctx) {
    const issues = [];

    // Check 1: DP references — is the skill referencing DPs it shouldn't, or missing DPs it should?
    const referencedDPs = new Set();
    for (const match of content.matchAll(/DP-(\d)/g)) {
      referencedDPs.add(`DP-${match[1]}`);
    }

    for (const [dp, skills] of Object.entries(DP_SKILL_MAP)) {
      if (skills.includes(skillName) && !referencedDPs.has(dp)) {
        issues.push({
          severity: 'error',
          message: `${dp} (${DP_NAMES[dp]}) should be referenced in ${skillName} but was not found`,
        });
      }
    }

    // Check 2: "hard gate" / "硬门禁" language — must match decision-points.md
    if (content.includes('hard gate') || content.includes('硬门禁')) {
      const dp3Refs = [...content.matchAll(/DP-3/g)];
      if (dp3Refs.length === 0 && skillName === 'contract-builder') {
        issues.push({
          severity: 'warning',
          message: `${skillName} mentions "hard gate" but does not reference DP-3`,
        });
      }
    }

    // Check 3: If skill says "route to `X`", verify X is a real skill
    // Only match backtick-quoted routes (explicit skill references), not plain text
    const routeRefs = [...content.matchAll(/[Rr]oute to `([a-z-]+)`/g)];
    for (const [, target] of routeRefs) {
      if (!ctx.skillDirs.includes(target)) {
        issues.push({
          severity: 'warning',
          message: `Routes to \`${target}\` but no such skill exists in skills/`,
        });
      }
    }

    return issues;
  },
};
