// ssf validate <dir> — validate artifacts in a change directory
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { loadConfig } from './config-loader.mjs';
import { validateSpecPathLayout, relativeSpecPath } from './spec-paths.mjs';

async function getValidator() {
  const mod = await import('../../dist/index.js');
  return new mod.Validator(false);
}

function printReport(label, report) {
  console.log(`\n  📋 ${label}`);
  if (report.valid) {
    console.log(`     ✅ valid (${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.info} info)`);
  } else {
    console.log(`     ❌ invalid (${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.info} info)`);
  }
  for (const issue of report.issues) {
    const icon = issue.level === 'ERROR' ? '🔴' : issue.level === 'WARNING' ? '🟡' : '🔵';
    console.log(`     ${icon} [${issue.level}] ${issue.path}: ${issue.message}`);
  }
}

export async function run(args) {
  if (args.length < 1) {
    console.error('Usage: ssf validate <change-dir>');
    process.exit(2);
  }

  const changeDir = args[0];
  if (!existsSync(changeDir) || !statSync(changeDir).isDirectory()) {
    console.error(`Error: "${changeDir}" is not a valid directory`);
    process.exit(2);
  }

  const config = loadConfig(process.cwd());
  const changeName = basename(changeDir);
  const validator = await getValidator();

  console.log(`🔍 Validating: ${changeDir}`);
  console.log(`   Change: ${changeName}`);

  let hasErrors = false;

  // Validate proposal.md
  const proposalPath = join(changeDir, 'proposal.md');
  if (existsSync(proposalPath)) {
    const content = readFileSync(proposalPath, 'utf-8');
    const report = validator.validateChangeContent(changeName, content);
    printReport('proposal.md', report);
    if (!report.valid) hasErrors = true;
  }

  // Validate specs/*/spec.md
  const specsDir = join(changeDir, 'specs');
  if (existsSync(specsDir)) {
    const specLayout = validateSpecPathLayout(changeDir, { requireSpecs: true });
    for (const failure of specLayout.failures) {
      printReport('specs/', {
        valid: false,
        issues: [{ level: 'ERROR', path: 'specs/', message: failure }],
        summary: { errors: 1, warnings: 0, info: 0 },
      });
      hasErrors = true;
    }

    for (const specFile of specLayout.specFiles) {
      const content = readFileSync(specFile, 'utf-8');
      const report = validator.validateDeltaSpec(content);
      const rel = relativeSpecPath(changeDir, specFile);
      printReport(rel, report);
      if (!report.valid) hasErrors = true;
    }
  }

  // Basic structural validation for design.md and tasks.md (shared pattern)
  const STRUCTURAL_CHECKS = [
    { file: 'design.md', errorMsg: 'design.md is too short (< 50 chars) — provide architecture decisions, trade-offs, and data flow', warningMsg: 'design.md has no section headings — consider adding ## Architecture, ## Data Flow, ## Error Handling' },
    { file: 'tasks.md', errorMsg: 'tasks.md is too short (< 50 chars) — provide actionable, ordered implementation tasks', warningMsg: 'tasks.md has no section headings — consider adding ## File Structure and ## Tasks' },
  ];

  for (const { file, errorMsg, warningMsg } of STRUCTURAL_CHECKS) {
    const filePath = join(changeDir, file);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, 'utf-8').trim();
    const issues = [];
    if (content.length < 50) issues.push({ level: 'ERROR', path: file, message: errorMsg });
    if (!content.includes('##')) issues.push({ level: 'WARNING', path: file, message: warningMsg });
    const report = {
      valid: issues.filter(i => i.level === 'ERROR').length === 0,
      issues,
      summary: { errors: issues.filter(i => i.level === 'ERROR').length, warnings: issues.filter(i => i.level === 'WARNING').length, info: 0 },
    };
    printReport(file, report);
    if (!report.valid) hasErrors = true;
  }

  console.log('');
  if (hasErrors) {
    console.log('❌ Validation failed with errors.');
    process.exit(1);
  } else {
    console.log('✅ All artifacts validated.');
    process.exit(0);
  }
}
