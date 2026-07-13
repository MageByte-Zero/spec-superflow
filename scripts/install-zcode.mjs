#!/usr/bin/env node
// scripts/install-zcode.mjs — deploy spec-superflow for ZCODE Agent
//
// Copies the full plugin tree (skills + scripts + docs + templates + dist + hooks)
// to .zcode/spec-superflow/ so that skill instructions referencing
// ${CLAUDE_PLUGIN_ROOT}/scripts/... and ${CLAUDE_PLUGIN_ROOT}/docs/... resolve
// correctly. Also copies skills to .zcode/skills/ (where ZCODE reads them).
//
// Defaults to the latest GitHub release; use --local <path> to deploy from a local repo.
import { existsSync, mkdirSync, readdirSync, statSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { cp, writeFile, mkdtemp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPluginRoot = dirname(__dirname); // repository root when running from clone
const targetRoot = process.cwd();

const GITHUB_REPO = 'MageByte-Zero/spec-superflow';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

// Directories needed at runtime by skills (referenced via ${CLAUDE_PLUGIN_ROOT})
const RUNTIME_DIRS = ['scripts', 'docs', 'templates', 'dist', 'hooks'];

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

async function fetchLatestTag() {
  const res = await fetch(GITHUB_API_URL);
  if (!res.ok) {
    throw new Error(`GitHub API failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (!data.tag_name) {
    throw new Error('GitHub API response missing tag_name');
  }
  return data.tag_name;
}

async function cloneRelease(tag) {
  const tmpDir = await mkdtemp(join('/tmp', 'spec-superflow-'));
  const url = `https://github.com/${GITHUB_REPO}.git`;
  console.log(`📥 Cloning ${tag} into ${tmpDir} ...`);
  execFileSync('git', ['clone', '--depth', '1', '--branch', tag, url, tmpDir], {
    stdio: 'inherit',
  });
  return tmpDir;
}

/**
 * Recursively copy a directory.
 */
async function copyDir(src, dst) {
  if (!existsSync(src)) return 0;
  ensureDir(dst);
  const entries = readdirSync(src);
  for (const name of entries) {
    const srcPath = join(src, name);
    const dstPath = join(dst, name);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      await copyDir(srcPath, dstPath);
    } else {
      await cp(srcPath, dstPath, { force: true });
    }
  }
  return entries.length;
}

/**
 * Copy skills to target, replacing ${CLAUDE_PLUGIN_ROOT} with the actual
 * plugin root path so skill instructions work in ZCODE's environment.
 */
async function copySkillsWithRoot(sourceSkills, targetSkills, pluginRootAbs) {
  // Clean old skill directories before copying
  if (existsSync(targetSkills)) {
    const oldEntries = readdirSync(targetSkills).filter(name => {
      const full = join(targetSkills, name);
      try { return statSync(full).isDirectory(); } catch { return false; }
    });
    for (const name of oldEntries) {
      rmSync(join(targetSkills, name), { recursive: true, force: true });
    }
  }
  ensureDir(targetSkills);
  const entries = readdirSync(sourceSkills).filter(name => {
    const full = join(sourceSkills, name);
    try { return statSync(full).isDirectory(); } catch { return false; }
  });

  for (const name of entries) {
    const src = join(sourceSkills, name);
    const dst = join(targetSkills, name);
    await cp(src, dst, { recursive: true, force: true });

    // Replace ${CLAUDE_PLUGIN_ROOT} with the absolute path so commands work
    const skillMd = join(dst, 'SKILL.md');
    if (existsSync(skillMd)) {
      let content = readFileSync(skillMd, 'utf-8');
      if (content.includes('${CLAUDE_PLUGIN_ROOT}')) {
        content = content.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRootAbs);
        writeFileSync(skillMd, content, 'utf-8');
      }
    }
    // Also fix sub-prompt files (implementer-prompt.md, etc.)
    const subFiles = readdirSync(dst).filter(f => f.endsWith('.md') && f !== 'SKILL.md');
    for (const sub of subFiles) {
      const subPath = join(dst, sub);
      let content = readFileSync(subPath, 'utf-8');
      if (content.includes('${CLAUDE_PLUGIN_ROOT}')) {
        content = content.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRootAbs);
        writeFileSync(subPath, content, 'utf-8');
      }
    }
  }

  return entries.length;
}

async function writePhaseGuard(targetRules) {
  ensureDir(targetRules);
  const content = `---
description: spec-superflow phase guard — 防止阶段漂移和未授权实现
alwaysApply: true
---

# Phase Guard

## 入口规则

- 所有工作必须从 "/workflow-start" 入口开始。
- 在 .spec-superflow.yaml 中确认当前 state 和 workflow 模式之前，不要开始写代码。

## 全局禁止

- 没有 execution-contract.md 或未经用户明确批准，不得进入实现。
- full/hotfix 必须先运行 ssf execution plan <change-dir> ...；没有 current execution plan 不得开始实现。
- 只有 all pass review receipts 后才可 closing；不得把未审查的 wave 当作完成。
- 上述 plan/receipt gates 仅适用于 full/hotfix；tweak 免除这些 gates (tweak exempt)。
- 执行过程中如果发现需求/范围变化，必须回退到 specifying 或 bridging，而不是直接改代码。
- 不要直接调用执行类 skill（如 "/build-executor"），必须通过入口路由。

## 决策点协议

- DP-0：设计前确认
- DP-1：需求确认
- DP-2：工件审查
- DP-3：是否批准 execution contract？
- DP-4：full/hotfix 默认 SDD；Inline / Batch Inline 只允许用户明确 override
- DP-5：调试升级
- DP-6：验证失败
- DP-7：是否收口归档？

> 本文件由 scripts/install-zcode.mjs 生成；对具体变更的 guard 内容请运行 ssf inject <change-dir> 更新。
`;
  await writeFile(join(targetRules, 'phase-guard.mdc'), content, 'utf-8');
}

async function writeZCODEHooks(hooksDir) {
  ensureDir(join(targetRoot, '.zcode'));
  const hooksJson = {
    hooks: [
      {
        event: 'sessionStart',
        command: `bash ${join(hooksDir, 'session-start')}`,
      },
    ],
  };
  await writeFile(
    join(targetRoot, '.zcode', 'hooks.json'),
    JSON.stringify(hooksJson, null, 2) + '\n',
    'utf-8',
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      local: { type: 'string' },
      tag: { type: 'string' },
    },
  });

  let pluginRoot = defaultPluginRoot;
  let isTemp = false;
  let installedTag = null;

  if (values.local) {
    pluginRoot = resolve(values.local);
    console.log(`📁 Using local repo: ${pluginRoot}`);
  } else {
    installedTag = values.tag || await fetchLatestTag();
    console.log(`⬆️  Installing spec-superflow ${installedTag} ...`);
    pluginRoot = await cloneRelease(installedTag);
    isTemp = true;
  }

  const sourceSkills = join(pluginRoot, 'skills');
  if (!existsSync(sourceSkills)) {
    console.error(`❌ skills/ directory not found at ${pluginRoot}`);
    if (isTemp) rmSync(pluginRoot, { recursive: true, force: true });
    process.exit(1);
  }

  // Target paths
  const targetPluginDir = join(targetRoot, '.zcode', 'spec-superflow');
  const targetSkills = join(targetRoot, '.zcode', 'skills');
  const targetRules = join(targetRoot, '.zcode', 'rules');
  const pluginRootAbs = resolve(targetPluginDir);

  try {
    // 1. Copy runtime dependencies to .zcode/spec-superflow/
    console.log('📋 Copying runtime dependencies...');
    for (const dir of RUNTIME_DIRS) {
      const src = join(pluginRoot, dir);
      const dst = join(targetPluginDir, dir);
      if (existsSync(src)) {
        const count = await copyDir(src, dst);
        console.log(`   ${dir}/ → ${dst} (${count} entries)`);
      } else {
        console.log(`   ${dir}/ — skipped (not found)`);
      }
    }

    // 2. Copy skills to .zcode/skills/ with CLAUDE_PLUGIN_ROOT replaced
    const count = await copySkillsWithRoot(sourceSkills, targetSkills, pluginRootAbs);
    console.log(`   skills/ → ${targetSkills} (${count} skills, paths rewritten)`);

    // 3. Write phase guard rule
    await writePhaseGuard(targetRules);
    console.log(`   phase guard → ${join(targetRules, 'phase-guard.mdc')}`);

    // 4. Write .zcode/hooks.json for session-start
    await writeZCODEHooks(join(targetPluginDir, 'hooks'));
    console.log(`   hooks.json → ${join(targetRoot, '.zcode', 'hooks.json')}`);

    console.log(`\n✅ ZCODE install complete:`);
    console.log(`   Plugin root: ${pluginRootAbs}`);
    if (installedTag) {
      console.log(`   Version:     ${installedTag}`);
    }
    console.log(`\nNext: open ZCODE Agent and try "/workflow-start".`);
  } finally {
    if (isTemp) {
      rmSync(pluginRoot, { recursive: true, force: true });
    }
  }
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
