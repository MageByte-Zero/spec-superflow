// Rule: exception-handling
// Detects: Missing error handling for common failure scenarios
// Each skill should cover: parse failures, missing files, user interruption

const REQUIRED_EXCEPTION_PATTERNS = [
  {
    id: 'parse-failure',
    patterns: [/解析失败|parse (error|fail)|malformed|格式不正确/i],
    message: 'No guidance for parse/malformed-input failures',
  },
  {
    id: 'missing-files',
    patterns: [/文件缺失|file (not found|missing)|missing (file|artifact)/i],
    message: 'No guidance for missing file/artifact scenarios',
  },
  {
    id: 'user-interruption',
    patterns: [/用户中断|user (interrupt|cancel|stop)|恢复|resume|restart/i],
    message: 'No guidance for user interruption and session recovery',
  },
  {
    id: 'validation-failure',
    patterns: [/验证失败|validation (fail|error)|check fail/i],
    message: 'No guidance for validation failure scenarios',
  },
];

export default {
  name: 'exception-handling',

  async check(skillName, content, ctx) {
    const issues = [];

    // Every skill should have at least basic error guidance
    for (const { id, patterns, message } of REQUIRED_EXCEPTION_PATTERNS) {
      const hasCoverage = patterns.some(p => p.test(content));

      // parse-failure is required for all skills
      // missing-files is required for skills that read artifacts
      // user-interruption is required for all skills
      // validation-failure is required for spec-writer and contract-builder

      const isRequired =
        id === 'parse-failure' ||
        id === 'user-interruption' ||
        (id === 'missing-files' && /read|inspect|check|parse/i.test(content)) ||
        (id === 'validation-failure' && ['spec-writer', 'contract-builder', 'release-archivist'].includes(skillName));

      if (isRequired && !hasCoverage) {
        issues.push({
          severity: 'warning',
          message,
        });
      }
    }

    return issues;
  },
};
