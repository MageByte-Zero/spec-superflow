#!/usr/bin/env node
// scripts/infer-workflow.mjs — infer quick/tweak/full from change artifacts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readState } from './lib/state-loader.mjs';

const CODE_EXTS = [
  'mjs', 'js', 'ts', 'jsx', 'tsx', 'cjs',
  'java', 'go', 'py', 'pyw', 'rb', 'php',
  'rs', 'kt', 'kts', 'swift',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp',
  'cs', 'fs', 'fsx', 'vb',
  'scala', 'sc', 'clj', 'cljs', 'ex', 'exs',
  'dart', 'lua', 'r', 'pl', 'pm', 'sh', 'bash', 'zsh', 'fish',
];
const CONFIG_DOC_EXTS = [
  'md', 'json', 'yaml', 'yml', 'toml', 'ini',
  'txt', 'html', 'css',
];
const CODE_EXT_SET = new Set(CODE_EXTS);
const CONFIG_DOC_EXT_SET = new Set(CONFIG_DOC_EXTS);
const FILE_EXT_PATTERN = [...CODE_EXTS, ...CONFIG_DOC_EXTS]
  .sort((a, b) => b.length - a.length)
  .join('|');

const FILE_RE = new RegExp(`\\b/?(?:[\\w-]+/)*[\\w-]+\\.(${FILE_EXT_PATTERN})\\b`, 'gi');

function readText(dir, name) {
  const p = join(dir, name);
  return existsSync(p) ? readFileSync(p, 'utf-8') : '';
}

function countTasks(tasks) {
  return (tasks.match(/^- \[([ x])\]/gm) || []).length;
}

function collectFiles(text) {
  const matches = text.match(FILE_RE) || [];
  return [...new Set(matches.map(m => m.trim()))];
}

function hasKeyword(text, patterns) {
  const lower = text.toLowerCase();
  return patterns.some(p => lower.includes(p.toLowerCase()));
}

function inferMode(changeDir) {
  const state = readState(changeDir);

  // Explicit override: honor any non-auto, non-null workflow value
  if (state.workflow && state.workflow !== 'auto') {
    const valid = ['quick', 'hotfix', 'tweak', 'full'];
    if (valid.includes(state.workflow)) {
      return {
        mode: state.workflow,
        explicit: true,
        reason: `workflow explicitly set to '${state.workflow}' in .spec-superflow.yaml; skipping auto-detection`,
      };
    }
  }

  const proposal = readText(changeDir, 'proposal.md');
  const tasks = readText(changeDir, 'tasks.md');
  const combined = `${proposal}\n${tasks}`;

  const taskCount = countTasks(tasks);
  const files = collectFiles(combined);
  const fileCount = files.length;

  const hasSchemaChange = hasKeyword(combined, [
    'schema', 'api', 'interface', '接口', 'validator', '类型',
    'type definition', 'protobuf', 'openapi', 'json schema',
  ]);
  const hasNewModule = hasKeyword(combined, [
    'new module', '新增模块', '新模块', '新增 skill', '新目录',
    '新增 capability', 'new capability',
  ]);

  const allExts = files.map(f => {
    const parts = f.split('.');
    return parts[parts.length - 1].toLowerCase();
  });
  const codeFileCount = allExts.filter(e => CODE_EXT_SET.has(e)).length;
  const configDocOnly = codeFileCount === 0 && allExts.every(e => CONFIG_DOC_EXT_SET.has(e));

  // No artifacts → safe default to full
  if (taskCount === 0 && fileCount === 0) {
    return {
      mode: 'full',
      explicit: false,
      reason: 'no planning artifacts detected → full (safe default)',
    };
  }

  // Tweak: small config/doc change
  if (taskCount <= 4 && configDocOnly && !hasSchemaChange && !hasNewModule) {
    return {
      mode: 'tweak',
      explicit: false,
      reason: `≤4 tasks, only config/doc files, no schema/API/new-module keywords → tweak`,
    };
  }

  // Quick: small non-document code change. Incident detection requires request context,
  // so legacy artifact inference deliberately never infers hotfix.
  if (taskCount <= 3 && fileCount <= 3 && codeFileCount > 0 && !hasSchemaChange && !hasNewModule) {
    return {
      mode: 'quick',
      explicit: false,
      reason: `≤3 tasks, ≤3 code files, no schema/API/new-module keywords → quick`,
    };
  }

  // Default
  return {
    mode: 'full',
    explicit: false,
    reason: `${taskCount} tasks, ${fileCount} files${codeFileCount > 0 ? ` (${codeFileCount} code files)` : ''}${hasSchemaChange ? ', schema/API change detected' : ''}${hasNewModule ? ', new module detected' : ''} → full`,
  };
}

function main() {
  const changeDir = process.argv[2];
  if (!changeDir) {
    console.error('Usage: node scripts/infer-workflow.mjs <change-dir>');
    process.exit(2);
  }

  const result = inferMode(changeDir);
  console.log(JSON.stringify(result, null, 2));
}

export { inferMode };

if (import.meta.filename === process.argv[1] || import.meta.url === `file://${process.argv[1]}`) {
  main();
}
