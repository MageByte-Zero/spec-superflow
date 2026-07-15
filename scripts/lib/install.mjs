// scripts/lib/install.mjs
// Shared installer for spec-superflow cross-platform deployment.
//
// Mirrors the proven logic of scripts/install-cursor.mjs, parameterized by a
// PlatformConfig from ./platforms.mjs. For each platform it:
//   1. Resolves the plugin source (latest GitHub release or --local <path>).
//   2. Copies RUNTIME_DIRS (scripts/docs/templates/dist/hooks) to
//      <skillsDir>/spec-superflow/ so ${CLAUDE_PLUGIN_ROOT}/... resolves.
//   3. Copies skills/ to <skillsDir>/skills/ with ${CLAUDE_PLUGIN_ROOT}
//      rewritten to the absolute plugin root.
//   4. Writes a phase-guard rule file to the platform's rules directory
//      (when the platform has one) so the workflow entry rule is auto-included.
//
// spec-superflow's guard is the phase-guard RULE (auto-included by the
// platform), not a PreToolUse hook; no hook configs are written here.

import { existsSync, mkdirSync, readdirSync, statSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { cp, writeFile, mkdtemp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { getPlatform, rulesTargetDir, phaseGuardFileName } from './platforms.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPluginRoot = resolve(__dirname, '..', '..'); // repo root when run from clone

const GITHUB_REPO = 'MageByte-Zero/spec-superflow';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

// Directories needed at runtime by skills (referenced via ${CLAUDE_PLUGIN_ROOT}).
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

/** Recursively copy a directory; returns the number of top-level entries. */
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
 * plugin root path so skill instructions resolve in the target platform.
 */
async function copySkillsWithRoot(sourceSkills, targetSkills, pluginRootAbs) {
  // Clean old skill directories before copying.
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

  function rewriteRoot(filePath) {
    if (!existsSync(filePath)) return;
    let content = readFileSync(filePath, 'utf-8');
    if (content.includes('${CLAUDE_PLUGIN_ROOT}')) {
      content = content.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRootAbs);
    }
    content = content.replace(
      /npx --yes --package spec-superflow@\d+\.\d+\.\d+ ssf/g,
      `node "${join(pluginRootAbs, 'scripts', 'spec-superflow.mjs')}"`,
    );
    writeFileSync(filePath, content, 'utf-8');
  }

  for (const name of entries) {
    const src = join(sourceSkills, name);
    const dst = join(targetSkills, name);
    await cp(src, dst, { recursive: true, force: true });
    rewriteRoot(join(dst, 'SKILL.md'));
    // Also fix sub-prompt / reference markdown files in the skill dir.
    for (const sub of readdirSync(dst).filter(f => f.endsWith('.md') && f !== 'SKILL.md')) {
      rewriteRoot(join(dst, sub));
    }
  }
  return entries.length;
}

/** Phase-guard rule content. `mdc` gets Cursor frontmatter; `md`/`copilot` stay plain. */
function phaseGuardContent(rulesFormat, platformId) {
  const body = `# Phase Guard — spec-superflow (${platformId})

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

> 本文件由 spec-superflow 安装脚本生成（platform: ${platformId}）；
> 对具体变更的 guard 内容请运行 \`ssf inject <change-dir>\` 更新。
`;
  if (rulesFormat === 'mdc') {
    return `---
description: spec-superflow phase guard — 防止阶段漂移和未授权实现
alwaysApply: true
---

${body}`;
  }
  return body;
}

/**
 * Install spec-superflow for a platform.
 *
 * @param {string} platformId - one of NEW_PLATFORM_IDS
 * @param {Object} [opts]
 * @param {string} [opts.local]  - deploy from a local repo path instead of release
 * @param {string} [opts.tag]    - specific release tag to install
 * @param {string} [opts.cwd]    - target project root (defaults to process.cwd())
 */
export async function installPlatform(platformId, opts = {}) {
  const platform = getPlatform(platformId);
  const { values } = parseArgs({
    options: {
      local: { type: 'string' },
      tag: { type: 'string' },
    },
    // No `args` => parseArgs reads process.argv.slice(2), so `--local`/`--tag`
    // passed on the CLI (or forwarded by cmd-install-<id>.mjs) are honored.
  });
  const local = opts.local ?? values.local;
  const tag = opts.tag ?? values.tag;

  const targetRoot = opts.cwd || process.cwd();

  let pluginRoot = defaultPluginRoot;
  let isTemp = false;
  let installedTag = null;

  if (local) {
    pluginRoot = resolve(local);
    console.log(`📁 Using local repo: ${pluginRoot}`);
  } else {
    installedTag = tag || await fetchLatestTag();
    console.log(`⬆️  Installing spec-superflow ${installedTag} for ${platform.name} ...`);
    pluginRoot = await cloneRelease(installedTag);
    isTemp = true;
  }

  const sourceSkills = join(pluginRoot, 'skills');
  if (!existsSync(sourceSkills)) {
    console.error(`❌ skills/ directory not found at ${pluginRoot}`);
    if (isTemp) rmSync(pluginRoot, { recursive: true, force: true });
    process.exit(1);
  }

  // Target paths (project-local scope).
  const targetPluginDir = join(targetRoot, platform.skillsDir, 'spec-superflow');
  const targetSkills = join(targetRoot, platform.skillsDir, 'skills');
  const pluginRootAbs = resolve(targetPluginDir);

  try {
    // 1. Copy runtime dependencies to <skillsDir>/spec-superflow/
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

    // 2. Copy skills to <skillsDir>/skills/ with CLAUDE_PLUGIN_ROOT replaced
    const count = await copySkillsWithRoot(sourceSkills, targetSkills, pluginRootAbs);
    console.log(`   skills/ → ${targetSkills} (${count} skills, paths rewritten)`);

    // 3. Write phase-guard rule (when the platform has a rules directory)
    const rulesDir = rulesTargetDir(platform, targetRoot);
    if (rulesDir) {
      ensureDir(rulesDir);
      const fileName = phaseGuardFileName(platform.rulesFormat);
      const ruleFile = join(rulesDir, fileName);
      await writeFile(ruleFile, phaseGuardContent(platform.rulesFormat, platformId), 'utf-8');
      console.log(`   phase guard → ${ruleFile}`);
    } else {
      console.log(`   phase guard — skipped (${platform.name} has no rules directory)`);
    }

    console.log(`\n✅ ${platform.name} install complete:`);
    console.log(`   Plugin root: ${pluginRootAbs}`);
    if (installedTag) {
      console.log(`   Version:     ${installedTag}`);
    }
    if (rulesDir) {
      console.log(`\nNext: the phase-guard rule is auto-included. Try "/workflow-start".`);
    } else {
      console.log(`\nNext: ${platform.name} has no rules dir — invoke "/workflow-start" manually to start.`);
    }
    if (platform.notes) {
      console.log(`   Note: ${platform.notes}`);
    }
  } finally {
    if (isTemp) {
      rmSync(pluginRoot, { recursive: true, force: true });
    }
  }
}
