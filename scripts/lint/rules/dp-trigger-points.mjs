// Rule: dp-trigger-points
// Detects: Missing DP trigger descriptions and record commands in associated skills

const DP_SKILL_MAP = {
  'DP-0': { skills: ['workflow-start'], name: '设计前确认' },
  'DP-1': { skills: ['need-explorer'], name: '需求确认' },
  'DP-2': { skills: ['spec-writer'], name: '工件审查' },
  'DP-3': { skills: ['contract-builder'], name: '契约批准' },
  'DP-4': { skills: ['build-executor'], name: '执行模式选择' },
  'DP-5': { skills: ['bug-investigator'], name: '调试升级' },
  'DP-6': { skills: ['release-archivist'], name: '验证失败' },
  'DP-7': { skills: ['release-archivist'], name: '归档确认' },
};

export default {
  name: 'dp-trigger-points',

  async check(skillName, content, ctx) {
    const issues = [];

    for (const [dp, { skills, name }] of Object.entries(DP_SKILL_MAP)) {
      if (!skills.includes(skillName)) continue;

      // Check 1: Is DP referenced by name/number?
      const dpReferenced = content.includes(dp);

      // Check 2: Is there a record command (ssf state set ... dp_N_*)?
      const dpNum = dp.slice(-1);
      const hasRecordCommand = new RegExp(`dp_${dpNum}_(result|timestamp|confirmed)`).test(content);

      // Check 3: Is the trigger condition described?
      const hasTriggerDesc = new RegExp(
        `触发条件|When (to|should)|Trigger|Use (this|the).*${dp}`,
        'i'
      ).test(content) || content.includes(`DP-${dpNum}`);

      if (!dpReferenced) {
        issues.push({
          severity: 'error',
          message: `${dp} (${name}) is not referenced in ${skillName} — trigger point missing`,
        });
      } else {
        if (!hasTriggerDesc) {
          issues.push({
            severity: 'warning',
            message: `${dp} is mentioned but has no trigger condition description`,
          });
        }
        if (!hasRecordCommand) {
          issues.push({
            severity: 'warning',
            message: `${dp} has no ssf state set dp_${dpNum}_* record command`,
          });
        }
      }
    }

    return issues;
  },
};
