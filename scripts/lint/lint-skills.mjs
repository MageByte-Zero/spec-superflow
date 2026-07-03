#!/usr/bin/env node
// lint-skills.mjs — Skill content static analyzer
// Scans skills/*/SKILL.md against registered rules, outputs structured report.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, '..', '..', 'skills');
const RULES_DIR = join(__dirname, 'rules');

async function loadRules() {
  if (!existsSync(RULES_DIR)) return [];
  const ruleFiles = readdirSync(RULES_DIR).filter(f => f.endsWith('.mjs'));
  const rules = [];
  for (const file of ruleFiles.sort()) {
    try {
      const mod = await import(join(RULES_DIR, file));
      if (mod.default && typeof mod.default.check === 'function') {
        rules.push(mod.default);
      }
    } catch (e) {
      console.error(`Warning: failed to load rule ${file}: ${e.message}`);
    }
  }
  return rules;
}

/**
 * @param {Object} options
 * @param {string[]} [options.skills] — specific skill names to lint (default: all)
 * @returns {Promise<{valid: boolean, results: Array, summary: string}>}
 */
export async function lintSkills(options = {}) {
  const rules = await loadRules();
  const allDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const skillDirs = options.skills
    ? allDirs.filter(s => options.skills.includes(s))
    : allDirs;

  const results = [];
  for (const skillName of skillDirs) {
    const skillMd = join(SKILLS_DIR, skillName, 'SKILL.md');
    if (!existsSync(skillMd)) {
      results.push({ skill: skillName, issues: [{ severity: 'error', rule: 'file-existence', message: 'SKILL.md not found' }] });
      continue;
    }

    const content = readFileSync(skillMd, 'utf-8');
    const ctx = { skillDirs: allDirs, skillsDir: SKILLS_DIR };
    const issues = [];

    for (const rule of rules) {
      try {
        const ruleIssues = await rule.check(skillName, content, ctx);
        if (Array.isArray(ruleIssues)) {
          issues.push(...ruleIssues.map(i => ({ ...i, rule: rule.name || 'unknown' })));
        }
      } catch (e) {
        issues.push({ severity: 'error', rule: rule.name || 'unknown', message: `Rule threw: ${e.message}` });
      }
    }

    results.push({ skill: skillName, issues });
  }

  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
  const errorCount = results.reduce((sum, r) => sum + r.issues.filter(i => i.severity === 'error').length, 0);

  return {
    valid: errorCount === 0,
    results,
    summary: `${totalIssues} issue(s) (${errorCount} errors) across ${results.length} skills`,
  };
}

// CLI entry
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await lintSkills();
  if (!report.valid || process.argv.includes('--verbose')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`✅ ${report.summary}`);
  }
  process.exit(report.valid ? 0 : 1);
}
