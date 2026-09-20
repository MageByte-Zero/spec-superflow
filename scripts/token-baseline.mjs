#!/usr/bin/env node
// token-baseline.mjs — Token measurement baseline tool
// Measures lines, characters, and estimated tokens for injection components.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');

const TARGETS = [
  { path: 'hooks/session-start', label: 'hook active context (inactive sessions inject 0)', measurement: 'shell-message' },
  { path: '.claude/always/phase-guard.md', label: 'phase-guard (claude)' },
  { path: 'GEMINI.md', label: 'phase-guard (gemini)' },
  { path: 'skills/workflow-start/SKILL.md', label: 'skill: workflow-start' },
  { path: 'skills/need-explorer/SKILL.md', label: 'skill: need-explorer' },
  { path: 'skills/spec-writer/SKILL.md', label: 'skill: spec-writer' },
  { path: 'skills/contract-builder/SKILL.md', label: 'skill: contract-builder' },
  { path: 'skills/build-executor/SKILL.md', label: 'skill: build-executor' },
  { path: 'skills/bug-investigator/SKILL.md', label: 'skill: bug-investigator' },
  { path: 'skills/code-reviewer/SKILL.md', label: 'skill: code-reviewer' },
  { path: 'skills/release-archivist/SKILL.md', label: 'skill: release-archivist' },
  { path: 'skills/spec-merger/SKILL.md', label: 'skill: spec-merger' },
];

/**
 * Count Chinese characters in a string.
 */
function countChineseChars(text) {
  return (text.match(/[一-鿿㐀-䶿]/g) || []).length;
}

/**
 * Estimate tokens from text.
 * English: ~4 chars per token, Chinese: ~1.5 chars per token.
 */
function estimateTokens(text) {
  const chinese = countChineseChars(text);
  const other = text.length - chinese;
  return Math.ceil(chinese / 1.5) + Math.ceil(other / 4);
}

/**
 * Measure a single file.
 * @returns {{ path: string, label: string, lines: number, chars: number, estimatedTokens: number, error?: string }}
 */
function measureFile(target) {
  const fullPath = resolve(REPO_ROOT, target.path);
  if (!existsSync(fullPath)) {
    return { path: target.path, label: target.label, lines: 0, chars: 0, estimatedTokens: 0, error: 'file not found' };
  }
  try {
    const source = readFileSync(fullPath, 'utf-8');
    const content = target.measurement === 'shell-message' ? extractShellMessage(source) : source;
    const lines = content.split('\n').length;
    const chars = content.length;
    return {
      path: target.path,
      label: target.label,
      lines,
      chars,
      estimatedTokens: estimateTokens(content),
      measurement: target.measurement ?? 'file-source',
    };
  } catch (e) {
    return { path: target.path, label: target.label, lines: 0, chars: 0, estimatedTokens: 0, error: e.message };
  }
}

function extractShellMessage(source) {
  const match = source.match(/^msg="(.*)"\s*$/m);
  if (!match) throw new Error('msg shell variable not found');
  return match[1]
    .replace(/\\n/g, '\n')
    .replace(/\\`/g, '`')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/**
 * Measure all targets.
 * @param {{ files?: string }} options
 * @returns {{ timestamp: string, version: string, components: Array, totals: { lines: number, chars: number, estimatedTokens: number } }}
 */
export function measureAll(options = {}) {
  const targets = options.files
    ? TARGETS.filter(t => options.files.split(',').some(f => t.path.includes(f.trim())))
    : TARGETS;

  const components = targets.map(measureFile);
  const totals = components.reduce(
    (acc, c) => ({
      lines: acc.lines + c.lines,
      chars: acc.chars + c.chars,
      estimatedTokens: acc.estimatedTokens + c.estimatedTokens,
    }),
    { lines: 0, chars: 0, estimatedTokens: 0 }
  );

  return {
    timestamp: new Date().toISOString(),
    note: 'Catalog estimate only. Inactive hook sessions emit no context; the hook component measures its active-state message. Other components are loaded conditionally. This is not a runtime session, repeated-read, subagent, latency, or cost benchmark.',
    components,
    totals,
  };
}

/**
 * Compare current measurements against a baseline file.
 * @param {string} baselinePath
 * @returns {{ current: object, baseline: object, changes: Array }}
 */
export function compareWithBaseline(baselinePath) {
  const current = measureAll();
  const baselineJson = JSON.parse(readFileSync(baselinePath, 'utf-8'));
  const baselineMap = new Map(baselineJson.components.map(c => [c.path, c]));

  const changes = current.components.map(c => {
    const b = baselineMap.get(c.path);
    if (!b) return { ...c, change: 'new', deltaTokens: c.estimatedTokens };
    const deltaTokens = c.estimatedTokens - b.estimatedTokens;
    const pct = b.estimatedTokens > 0 ? ((deltaTokens / b.estimatedTokens) * 100).toFixed(1) : 'N/A';
    return { ...c, change: deltaTokens < 0 ? 'decreased' : deltaTokens > 0 ? 'increased' : 'unchanged', deltaTokens, pct };
  });

  const totalDelta = current.totals.estimatedTokens - baselineJson.totals.estimatedTokens;
  const totalPct = baselineJson.totals.estimatedTokens > 0
    ? ((totalDelta / baselineJson.totals.estimatedTokens) * 100).toFixed(1)
    : 'N/A';

  return {
    current,
    baseline: baselineJson,
    changes,
    summary: {
      totalDelta,
      totalPct,
      previousTotal: baselineJson.totals.estimatedTokens,
      currentTotal: current.totals.estimatedTokens,
    },
  };
}

// CLI
function parseArgs(argv) {
  const args = { compare: null, output: null, files: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--compare' && argv[i + 1]) args.compare = argv[++i];
    else if (argv[i] === '--output' && argv[i + 1]) args.output = argv[++i];
    else if (argv[i] === '--files' && argv[i + 1]) args.files = argv[++i];
  }
  return args;
}

if (process.argv[1] === decodeURIComponent(new URL(import.meta.url).pathname) || process.argv[1] === import.meta.filename) {
  const args = parseArgs(process.argv);
  let result;

  if (args.compare) {
    result = compareWithBaseline(args.compare);
  } else {
    result = measureAll({ files: args.files });
  }

  const output = JSON.stringify(result, null, 2);
  if (args.output) {
    writeFileSync(args.output, output, 'utf-8');
    console.log(`Baseline saved to ${args.output}`);
  } else {
    console.log(output);
  }
}
