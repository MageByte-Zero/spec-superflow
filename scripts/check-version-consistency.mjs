#!/usr/bin/env node
// check-version-consistency.mjs — CI guard: fail if any file has a version
// that doesn't match package.json. Prevents doc/code drift after ssf version.
//
// Usage: node scripts/check-version-consistency.mjs
//   Exit 0: all versions consistent
//   Exit 1: mismatches found (lists every file and its version)

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Canonical version from package.json
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const CANONICAL = pkg.version;
if (!CANONICAL || !/^\d+\.\d+\.\d+$/.test(CANONICAL)) {
  console.error('❌ package.json version is missing or invalid');
  process.exit(1);
}

const errors = [];

// ── JSON manifests ──
const JSON_CHECKS = [
  { file: 'plugin.json', path: ['version'] },
  { file: '.claude-plugin/plugin.json', path: ['version'] },
  { file: '.claude-plugin/marketplace.json', path: ['plugins', '0', 'version'] },
  { file: '.cursor-plugin/plugin.json', path: ['version'] },
  { file: '.cursor-plugin/marketplace.json', path: ['metadata', 'version'] },
  { file: '.codex-plugin/plugin.json', path: ['version'] },
  { file: 'gemini-extension.json', path: ['version'] },
  { file: '.github/plugin/marketplace.json', path: ['metadata', 'version'] },
  { file: '.github/plugin/marketplace.json', path: ['plugins', '0', 'version'] },
];

for (const check of JSON_CHECKS) {
  const fp = join(ROOT, check.file);
  if (!existsSync(fp)) {
    errors.push({ file: check.file, found: 'FILE_NOT_FOUND', expected: CANONICAL });
    continue;
  }
  try {
    const obj = JSON.parse(readFileSync(fp, 'utf-8'));
    let val = obj;
    for (const p of check.path) val = val?.[p];
    if (val !== CANONICAL) {
      errors.push({ file: `${check.file} [${check.path.join('.')}]`, found: val, expected: CANONICAL });
    }
  } catch (e) {
    errors.push({ file: check.file, found: `PARSE_ERROR: ${e.message}`, expected: CANONICAL });
  }
}

// ── Text files (extraction-pattern check) ──
// Each entry has a regex that extracts ONLY the declared version (capture group 1),
// not historical references like "v0.6.0 起支持".
// Note: CLAUDE.md is intentionally gitignored (project-local AI instructions).
const TEXT_CHECKS = [
  { file: 'README.md',              extract: /当前版本：`v(\d+\.\d+\.\d+)`/ },
  { file: 'INSTALL.md',             extract: /当前发布版本：\*\*v(\d+\.\d+\.\d+)\*\*/ },
  { file: 'docs/README_en.md',      extract: /Current: `v(\d+\.\d+\.\d+)`/ },
  { file: 'hooks/session-start',    extract: /# v(\d+\.\d+\.\d+): conditional injection/ },
  { file: 'llms.txt',               extract: /Current version: v(\d+\.\d+\.\d+)\./ },
  { file: '.claude/always/phase-guard.md', extract: /# spec-superflow v(\d+\.\d+\.\d+) \|/ },
  { file: 'GEMINI.md',              extract: /# spec-superflow v(\d+\.\d+\.\d+) \|/ },
];

for (const check of TEXT_CHECKS) {
  const fp = join(ROOT, check.file);
  if (!existsSync(fp)) {
    errors.push({ file: check.file, found: 'FILE_NOT_FOUND', expected: CANONICAL });
    continue;
  }
  const content = readFileSync(fp, 'utf-8');
  const match = content.match(check.extract);
  if (!match) {
    errors.push({ file: check.file, found: 'PATTERN_NOT_MATCHED', expected: CANONICAL });
  } else if (match[1] !== CANONICAL) {
    errors.push({ file: check.file, found: match[1], expected: CANONICAL });
  }
}

// ── Report ──
if (errors.length === 0) {
  console.log(`✅ Version consistency check passed — all files at ${CANONICAL}`);
  process.exit(0);
}

console.log(`❌ Version consistency check FAILED — canonical version is ${CANONICAL}\n`);
console.log('Mismatches found:');
for (const e of errors) {
  console.log(`  ${e.file}`);
  console.log(`    expected: ${e.expected}`);
  console.log(`    found:    ${e.found}`);
}
console.log(`\nRun: ssf version ${CANONICAL}`);
console.log(`Then manually verify CHANGELOG.md is up to date.`);
process.exit(1);
