#!/usr/bin/env node
// scripts/install-cursor.mjs — deploy spec-superflow skills/rules for Cursor Agent
// Defaults to the latest GitHub release; use --local <path> to deploy from a local repo.
import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { cp, writeFile, mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPluginRoot = dirname(__dirname); // repository root when running from clone
const targetRoot = process.cwd();

const GITHUB_REPO = 'MageByte-Zero/spec-superflow';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

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

async function copySkills(sourceSkills, targetSkills) {
  ensureDir(targetSkills);
  const entries = readdirSync(sourceSkills).filter(name => {
    const full = join(sourceSkills, name);
    try { return statSync(full).isDirectory(); } catch { return false; }
  });

  for (const name of entries) {
    const src = join(sourceSkills, name);
    const dst = join(targetSkills, name);
    await cp(src, dst, { recursive: true, force: true });
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
- 执行过程中如果发现需求/范围变化，必须回退到 specifying 或 bridging，而不是直接改代码。
- 不要直接调用执行类 skill（如 "/build-executor"），必须通过入口路由。

## 决策点协议

- DP-0：设计前确认
- DP-1：需求确认
- DP-2：工件审查
- DP-3：是否批准 execution contract？
- DP-4：选择执行模式（Inline / Batch Inline / SDD）
- DP-5：调试升级
- DP-6：验证失败
- DP-7：是否收口归档？

> 本文件由 scripts/install-cursor.mjs 生成；对具体变更的 guard 内容请运行 ssf inject <change-dir> 更新。
`;
  await writeFile(join(targetRules, 'phase-guard.mdc'), content, 'utf-8');
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
    pluginRoot = values.local;
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

  const targetCursor = join(targetRoot, '.cursor');
  const targetSkills = join(targetCursor, 'skills');
  const targetRules = join(targetCursor, 'rules');

  try {
    const count = await copySkills(sourceSkills, targetSkills);
    await writePhaseGuard(targetRules);

    console.log(`✅ Cursor install complete:`);
    console.log(`   - ${count} skills copied to ${targetSkills}`);
    console.log(`   - phase guard written to ${join(targetRules, 'phase-guard.mdc')}`);
    if (installedTag) {
      console.log(`   - version: ${installedTag}`);
    }
    console.log(`\nNext: open Cursor Agent and try "/workflow-start".`);
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
