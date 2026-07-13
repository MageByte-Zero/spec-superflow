// ssf install-workbuddy — deploy spec-superflow as a WorkBuddy marketplace plugin.
//
// WorkBuddy's marketplace plugin model (verified from existing plugins like
// `finance` and `modern-webapp` in cb_teams_marketplace):
//
//   ~/.workbuddy/plugins/marketplaces/<marketplace>/plugins/<plugin-name>/
//   ├── .codebuddy-plugin/plugin.json   ← manifest (name, version, skills[])
//   ├── skills/<skill-name>/SKILL.md    ← skills with ${CLAUDE_PLUGIN_ROOT} rewritten
//   ├── rules/phase-guard.md            ← phase-guard rule (auto-included)
//   ├── scripts/  docs/  templates/     ← runtime deps (${CLAUDE_PLUGIN_ROOT})
//   ├── dist/  hooks/                   ← (continued)
//
// enabledPlugins key in ~/.workbuddy/settings.json: `<plugin-name>@<marketplace>`
//
// This installer mirrors the shared install.mjs logic (RUNTIME_DIRS copy,
// ${CLAUDE_PLUGIN_ROOT} rewrite, phase-guard rule) but targets the marketplace
// plugin structure instead of a project-local `.platform/` directory.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cp, writeFile, mkdtemp } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPluginRoot = resolve(__dirname, '..', '..'); // repo root when run from clone

const DEFAULT_MARKETPLACE = 'cb_teams_marketplace';
const PLUGIN_NAME = 'spec-superflow';
const GITHUB_REPO = 'MageByte-Zero/spec-superflow';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const RUNTIME_DIRS = ['scripts', 'docs', 'templates', 'dist', 'hooks'];

// ─── helpers ──────────────────────────────────────────────

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return {};
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function listSkillNames(skillsDir) {
  if (!existsSync(skillsDir)) {
    throw new Error(`skills/ directory not found at ${skillsDir}`);
  }
  return readdirSync(skillsDir)
    .filter(name => {
      const dir = join(skillsDir, name);
      return statSync(dir).isDirectory() && existsSync(join(dir, 'SKILL.md'));
    })
    .sort();
}

/** Recursively copy a directory. */
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
 * Copy skills to <pluginRoot>/skills/, replacing ${CLAUDE_PLUGIN_ROOT}
 * with the absolute plugin root path so skill instructions resolve.
 */
async function copySkillsWithRoot(sourceSkills, targetSkills, pluginRootAbs) {
  // Clean old skill directories.
  if (existsSync(targetSkills)) {
    for (const name of readdirSync(targetSkills)) {
      rmSync(join(targetSkills, name), { recursive: true, force: true });
    }
  }
  ensureDir(targetSkills);
  const entries = readdirSync(sourceSkills).filter(name => {
    try { return statSync(join(sourceSkills, name)).isDirectory(); } catch { return false; }
  });

  function rewriteRoot(filePath) {
    if (!existsSync(filePath)) return;
    let content = readFileSync(filePath, 'utf-8');
    if (content.includes('${CLAUDE_PLUGIN_ROOT}')) {
      content = content.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRootAbs);
      writeFileSync(filePath, content, 'utf-8');
    }
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

/** Phase-guard rule content for WorkBuddy (md format). */
function phaseGuardContent() {
  return `# Phase Guard — spec-superflow (workbuddy)

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

> 本文件由 spec-superflow 安装脚本生成（platform: workbuddy）；
> 对具体变更的 guard 内容请运行 \`ssf inject <change-dir>\` 更新。
`;
}

/** Plugin manifest for the marketplace. */
function pluginManifest(skillNames, version) {
  return {
    name: PLUGIN_NAME,
    version: version || '0.0.0',
    description: 'Spec-Superflow — OpenSpec 规划引擎 + Superpowers 执行纪律的任务工作流。',
    author: { name: 'MageByte-Zero' },
    homepage: { url: `https://github.com/${GITHUB_REPO}`, type: 'github' },
    license: 'MIT',
    skills: skillNames.map(name => `./skills/${name}`),
  };
}

// ─── release fetch / clone ────────────────────────────────

async function fetchLatestTag() {
  const res = await fetch(GITHUB_API_URL);
  if (!res.ok) throw new Error(`GitHub API failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!data.tag_name) throw new Error('GitHub API response missing tag_name');
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

function readVersion(pluginRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ─── plan ─────────────────────────────────────────────────

function planInstall({ pluginRoot = defaultPluginRoot, homeDir = homedir(), marketplaceName = DEFAULT_MARKETPLACE } = {}) {
  const root = resolve(pluginRoot);
  const skillsDir = join(root, 'skills');
  const skillNames = listSkillNames(skillsDir);
  const workbuddyRoot = join(homeDir, '.workbuddy');
  const pluginsDir = join(workbuddyRoot, 'plugins', 'marketplaces', marketplaceName, 'plugins');
  const targetPluginDir = join(pluginsDir, PLUGIN_NAME);
  const targetSkills = join(targetPluginDir, 'skills');
  const targetRules = join(targetPluginDir, 'rules');
  const manifestDir = join(targetPluginDir, '.codebuddy-plugin');
  const settingsPath = join(workbuddyRoot, 'settings.json');
  const enabledPluginKey = `${PLUGIN_NAME}@${marketplaceName}`;
  const version = readVersion(root);
  const pluginRootAbs = resolve(targetPluginDir);

  return {
    pluginRoot: root,
    skillsDir,
    skillNames,
    workbuddyRoot,
    pluginsDir,
    targetPluginDir,
    targetSkills,
    targetRules,
    manifestDir,
    settingsPath,
    marketplaceName,
    enabledPluginKey,
    version,
    pluginRootAbs,
  };
}

// ─── install ──────────────────────────────────────────────

async function installWorkBuddy({ pluginRoot, homeDir, marketplaceName }) {
  const plan = planInstall({ pluginRoot, homeDir, marketplaceName });
  const { skillNames, targetPluginDir, targetSkills, targetRules, manifestDir, settingsPath, enabledPluginKey, version, pluginRootAbs } = plan;

  // 0. Clean old plugin dir.
  if (existsSync(targetPluginDir)) {
    rmSync(targetPluginDir, { recursive: true, force: true });
  }
  ensureDir(targetPluginDir);

  // 1. Copy runtime dependencies (scripts/docs/templates/dist/hooks).
  console.log('📋 Copying runtime dependencies...');
  for (const dir of RUNTIME_DIRS) {
    const src = join(plan.pluginRoot, dir);
    const dst = join(targetPluginDir, dir);
    if (existsSync(src)) {
      const count = await copyDir(src, dst);
      console.log(`   ${dir}/ → ${dst} (${count} entries)`);
    } else {
      console.log(`   ${dir}/ — skipped (not found)`);
    }
  }

  // 2. Copy skills with ${CLAUDE_PLUGIN_ROOT} rewriting.
  const count = await copySkillsWithRoot(plan.skillsDir, targetSkills, pluginRootAbs);
  console.log(`   skills/ → ${targetSkills} (${count} skills, paths rewritten)`);

  // 3. Write phase-guard rule.
  ensureDir(targetRules);
  await writeFile(join(targetRules, 'phase-guard.md'), phaseGuardContent(), 'utf-8');
  console.log(`   phase-guard → ${join(targetRules, 'phase-guard.md')}`);

  // 4. Write plugin manifest.
  ensureDir(manifestDir);
  await writeFile(join(manifestDir, 'plugin.json'), JSON.stringify(pluginManifest(skillNames, version), null, 2) + '\n', 'utf-8');
  console.log(`   manifest → ${join(manifestDir, 'plugin.json')}`);

  // 5. Enable plugin in settings.json.
  ensureDir(plan.workbuddyRoot);
  const settings = readJsonIfExists(settingsPath);
  settings.enabledPlugins = settings.enabledPlugins && typeof settings.enabledPlugins === 'object'
    ? settings.enabledPlugins
    : {};
  // Remove old per-skill keys (migration from v0.8.13 and earlier).
  for (const name of skillNames) {
    delete settings.enabledPlugins[`${name}@${marketplaceName}`];
  }
  settings.enabledPlugins[enabledPluginKey] = true;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log(`   settings → ${enabledPluginKey} enabled`);

  return plan;
}

// ─── CLI entry ────────────────────────────────────────────

export async function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      local: { type: 'string' },
      home: { type: 'string' },
      marketplace: { type: 'string' },
      tag: { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
  });

  const marketplaceName = values.marketplace || DEFAULT_MARKETPLACE;

  // Dry-run: show plan and exit.
  if (values['dry-run']) {
    const plan = planInstall({
      pluginRoot: values.local || defaultPluginRoot,
      homeDir: values.home || homedir(),
      marketplaceName,
    });
    console.log('WorkBuddy install plan:');
    console.log(`  Plugin:      ${PLUGIN_NAME} v${plan.version}`);
    console.log(`  Skills:      ${plan.skillNames.length} (${plan.skillNames.join(', ')})`);
    console.log(`  Marketplace: ${plan.marketplaceName}`);
    console.log(`  Target:      ${plan.targetPluginDir}`);
    console.log(`  Rules:       ${plan.targetRules}/phase-guard.md`);
    console.log(`  Settings:    ${plan.enabledPluginKey}`);
    return;
  }

  // Resolve source: --local <path> | --tag <tag> | latest release.
  let pluginRoot = defaultPluginRoot;
  let isTemp = false;
  let installedTag = null;

  if (values.local) {
    pluginRoot = resolve(values.local);
    console.log(`📁 Using local repo: ${pluginRoot}`);
  } else {
    installedTag = values.tag || await fetchLatestTag();
    console.log(`⬆️  Installing spec-superflow ${installedTag} for WorkBuddy ...`);
    pluginRoot = await cloneRelease(installedTag);
    isTemp = true;
  }

  try {
    const plan = await installWorkBuddy({
      pluginRoot,
      homeDir: values.home || homedir(),
      marketplaceName,
    });

    console.log(`\n✅ WorkBuddy install complete:`);
    console.log(`   Plugin:      ${PLUGIN_NAME} v${plan.version}`);
    console.log(`   Skills:      ${plan.skillNames.length}`);
    console.log(`   Marketplace: ${plan.marketplaceName}`);
    console.log(`   Target:      ${plan.targetPluginDir}`);
    console.log(`   Rules:       ${plan.targetRules}/phase-guard.md`);
    if (installedTag) {
      console.log(`   Version:     ${installedTag}`);
    }
    console.log(`\nNext: restart WorkBuddy and try "用 workflow-start 开始".`);
  } finally {
    if (isTemp) {
      rmSync(pluginRoot, { recursive: true, force: true });
    }
  }
}

export { planInstall, installWorkBuddy, PLUGIN_NAME };
