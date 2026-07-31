// ssf install-codebuddy — deploy spec-superflow for CodeBuddy Code CLI.
//
// CodeBuddy Code CLI reads skills directly from ~/.codebuddy/skills/, rules
// from ~/.codebuddy/rules/ (auto-loaded, but frontmatter controls application),
// and session hooks from ~/.codebuddy/settings.json (the hooks field, NOT
// ~/.codebuddy/hooks/hooks.json — the user-level hooks.json file is not
// auto-loaded by CodeBuddy). Unlike WorkBuddy, CodeBuddy CLI does NOT use the
// marketplace plugin model — skills are placed directly in the shared skills/
// directory and coexist with unrelated skills. Runtime dependencies live under
// a dedicated spec-superflow/ directory that serves as ${CLAUDE_PLUGIN_ROOT}.
//
// Deploy layout:
//   ~/.codebuddy/
//   ├── spec-superflow/              ← pluginRoot (runtime deps; ${CLAUDE_PLUGIN_ROOT} target)
//   │   ├── scripts/  docs/  templates/  dist/  hooks/
//   │   │   └── session-start
//   │   ├── commands/ssf/{resume,save,switch}.md
//   │   └── package.json
//   ├── skills/                      ← deployed skills (paths rewritten; other skills preserved)
//   │   ├── workflow-start/
//   │   └── ... (9 skills)
//   ├── commands/ssf/                ← canonical recovery command adapters
//   │   ├── resume.md                (npx→node <pluginRoot>/scripts/spec-superflow.mjs rewritten)
//   │   ├── save.md                  (allowed-tools: Bash(node:*))
//   │   └── switch.md
//   ├── rules/
//   │   └── phase-guard.md           ← phase-guard rule (alwaysApply:false; other rules preserved)
//   └── settings.json                ← SessionStart hook merged here (preserves other fields)
//
// Re-running the installer upgrades in place: it replaces the spec-superflow/
// runtime dir, refreshes only the source-named skill directories, rewrites the
// recovery command adapters, and merges SessionStart into settings.json.

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cp, writeFile, mkdtemp } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { shellQuote } from './shell-quote.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPluginRoot = resolve(__dirname, '..', '..'); // repo root when run from clone

const PLUGIN_NAME = 'spec-superflow';
const GITHUB_REPO = 'MageByte-Zero/spec-superflow';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const RUNTIME_DIRS = ['scripts', 'docs', 'templates', 'dist', 'hooks'];
const CANONICAL_COMMAND_NAMES = ['ssf:resume', 'ssf:save', 'ssf:switch'];
const CANONICAL_COMMAND_FILES = ['resume.md', 'save.md', 'switch.md'];

// ─── helpers ──────────────────────────────────────────────

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return {};
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

/**
 * Resolve the CodeBuddy config root. Defaults to ~/.codebuddy; override with
 * the --config-dir option when the CLI uses a non-standard data directory.
 */
function getCodebuddyRoot(configDir) {
  if (configDir) return resolve(configDir);
  return join(homedir(), '.codebuddy');
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

function canonicalCommandTreeError(path) {
  return new Error(
    `canonical command tree must be exactly commands/ssf/{${CANONICAL_COMMAND_FILES.join(', ')}}: ${path}`,
  );
}

function listExactEntries(dir, expectedEntries) {
  const entries = readdirSync(dir).sort();
  for (const entry of entries) {
    const entryPath = join(dir, entry);
    if (lstatSync(entryPath).isSymbolicLink()) {
      throw new Error(`symbolic links are not allowed in command source: ${entryPath}`);
    }
  }
  if (
    entries.length !== expectedEntries.length
    || entries.some((entry, index) => entry !== expectedEntries[index])
  ) {
    throw canonicalCommandTreeError(dir);
  }
  return entries;
}

function listCommandNames(commandsDir) {
  let commandsStat;
  try {
    commandsStat = lstatSync(commandsDir);
  } catch {
    throw new Error(`commands/ directory not found at ${commandsDir}`);
  }
  if (commandsStat.isSymbolicLink()) {
    throw new Error(`symbolic links are not allowed in command source: ${commandsDir}`);
  }
  if (!commandsStat.isDirectory()) {
    throw new Error(`commands/ directory not found at ${commandsDir}`);
  }
  listExactEntries(commandsDir, ['ssf']);

  const ssfCommandsDir = join(commandsDir, 'ssf');
  const ssfCommandsStat = lstatSync(ssfCommandsDir);
  if (ssfCommandsStat.isSymbolicLink()) {
    throw new Error(`symbolic links are not allowed in command source: ${ssfCommandsDir}`);
  }
  if (!ssfCommandsStat.isDirectory()) {
    throw canonicalCommandTreeError(ssfCommandsDir);
  }
  listExactEntries(ssfCommandsDir, CANONICAL_COMMAND_FILES);
  for (const file of CANONICAL_COMMAND_FILES) {
    const filePath = join(ssfCommandsDir, file);
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink()) {
      throw new Error(`symbolic links are not allowed in command source: ${filePath}`);
    }
    if (!fileStat.isFile()) {
      throw canonicalCommandTreeError(filePath);
    }
  }
  return [...CANONICAL_COMMAND_NAMES];
}

function snapshotCommandAssets(commandsDir) {
  listCommandNames(commandsDir);
  const ssfCommandsDir = join(commandsDir, 'ssf');
  return Object.freeze(CANONICAL_COMMAND_FILES.map(file => {
    const filePath = join(ssfCommandsDir, file);
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink()) {
      throw new Error(`symbolic links are not allowed in command source: ${filePath}`);
    }
    if (!fileStat.isFile()) {
      throw canonicalCommandTreeError(filePath);
    }
    return Object.freeze({
      relativePath: `ssf/${file}`,
      content: readFileSync(filePath, 'utf-8'),
    });
  }));
}

function assertCanonicalCommands(commandNames) {
  if (
    commandNames.length !== CANONICAL_COMMAND_NAMES.length
    || commandNames.some((name, index) => name !== CANONICAL_COMMAND_NAMES[index])
  ) {
    throw new Error(
      `canonical recovery command set is required: ${CANONICAL_COMMAND_NAMES.join(', ')}; found: ${commandNames.join(', ') || '(none)'}`,
    );
  }
}

async function copyValidatedCommands(commandAssets, targetCommands, pluginRootAbs) {
  const scriptPath = join(pluginRootAbs, 'scripts', 'spec-superflow.mjs');
  const nodeCmd = `node ${shellQuote(scriptPath)}`;
  for (const asset of commandAssets) {
    const targetPath = join(targetCommands, ...asset.relativePath.split('/'));
    ensureDir(dirname(targetPath));
    let content = asset.content;
    // Rewrite either supported source command to the deployed local runtime,
    // so --local installs neither fetch a pinned package nor depend on a
    // caller's globally linked `ssf` executable.
    content = content.replace(
      /(?:npx --yes --package spec-superflow@\d+\.\d+\.\d+ ssf|\bssf(?=\s+(?:resume|save|switch)\b))/g,
      nodeCmd,
    );
    // The command adapters no longer shell out to npx; allow node instead.
    content = content.replace(
      /^allowed-tools:\s*Bash\((?:npx|ssf):\*\)\s*$/m,
      'allowed-tools: Bash(node:*)',
    );
    await writeFile(targetPath, content, 'utf-8');
  }
  return commandAssets.length;
}

/** Recursively copy a directory. Returns the file count. */
async function copyDir(src, dst, { rejectSymlinks = false } = {}) {
  if (!existsSync(src)) return 0;
  ensureDir(dst);
  const entries = readdirSync(src);
  let fileCount = 0;
  for (const name of entries) {
    const srcPath = join(src, name);
    const dstPath = join(dst, name);
    const sourceStat = lstatSync(srcPath);
    if (sourceStat.isSymbolicLink() && rejectSymlinks) {
      throw new Error(`symbolic links are not allowed in command source: ${srcPath}`);
    }
    const st = sourceStat.isSymbolicLink() ? statSync(srcPath) : sourceStat;
    if (st.isDirectory()) {
      fileCount += await copyDir(srcPath, dstPath, { rejectSymlinks });
    } else {
      await cp(srcPath, dstPath, { force: true });
      fileCount += 1;
    }
  }
  return fileCount;
}

/**
 * Copy source skills into the shared ~/.codebuddy/skills/ directory, rewriting
 * ${CLAUDE_PLUGIN_ROOT} to the absolute plugin root. Only skill directories
 * whose names appear in sourceSkillNames are removed before copying — other
 * skills in the shared directory are preserved.
 */
async function copySkillsWithRoot(sourceSkills, targetSkills, pluginRootAbs, sourceSkillNames) {
  // Clean only the source-named skill directories (preserve unrelated skills).
  if (existsSync(targetSkills)) {
    for (const name of sourceSkillNames) {
      const dir = join(targetSkills, name);
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  ensureDir(targetSkills);

  function rewriteRoot(filePath) {
    if (!existsSync(filePath)) return;
    let content = readFileSync(filePath, 'utf-8');
    if (content.includes('${CLAUDE_PLUGIN_ROOT}')) {
      content = content.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRootAbs);
    }
    content = content.replace(
      /npx --yes --package spec-superflow@\d+\.\d+\.\d+ ssf/g,
      `node ${shellQuote(join(pluginRootAbs, 'scripts', 'spec-superflow.mjs'))}`,
    );
    writeFileSync(filePath, content, 'utf-8');
  }

  for (const name of sourceSkillNames) {
    const src = join(sourceSkills, name);
    const dst = join(targetSkills, name);
    await cp(src, dst, { recursive: true, force: true });
    rewriteRoot(join(dst, 'SKILL.md'));
    // Also fix sub-prompt / reference markdown files in the skill dir.
    for (const sub of readdirSync(dst).filter(f => f.endsWith('.md') && f !== 'SKILL.md')) {
      rewriteRoot(join(dst, sub));
    }
  }
  return sourceSkillNames.length;
}

/** Phase-guard rule content for CodeBuddy CLI (md format). */
function phaseGuardContent() {
  return `---
alwaysApply: false
---

# Phase Guard — spec-superflow (codebuddy)

> 仅在检测到 spec-superflow 变更工件（\`.spec-superflow.yaml\`、\`proposal.md\`、\`execution-contract.md\`、\`specs/\`）时应用此规则。普通项目无需走 workflow-start，CodeBuddy 不会强制加载本规则（\`alwaysApply: false\`）。

## 入口规则

- 所有工作必须从 "/workflow-start" 入口开始。
- 在 .spec-superflow.yaml 中确认当前 state 和 workflow 模式之前，不要开始写代码。

## 全局禁止

- Full 或 legacy Hotfix 没有 execution-contract.md 或未经用户明确批准，不得进入实现。
- Full 或 legacy Hotfix 必须先运行 ssf execution plan <change-dir> ...；没有 current execution plan 不得开始实现。
- 只有 Full/legacy Hotfix 的 all pass review receipts 后才可 closing；不得把未审查的 wave 当作完成。
- Quick、direct Hotfix、tweak 不要求 contract、execution plan、review receipt 或 DP-3/DP-4；它们须在边界内验证并持久化 test_result: pass。direct Hotfix 必须验证原症状回归。
- 执行过程中如果发现需求/范围变化，必须回退到 specifying 或 bridging，而不是直接改代码。
- 不要直接调用执行类 skill（如 "/build-executor"），必须通过入口路由。

## 决策点协议

- DP-0：设计前确认
- DP-1：需求确认
- DP-2：工件审查
- DP-3/DP-4：仅 Full 或 legacy Hotfix 需要 contract 批准与执行模式确认。
- DP-5：调试升级
- DP-6：验证失败
- DP-7：是否收口归档？

> 本文件由 spec-superflow 安装脚本生成（platform: codebuddy）；
> 对具体变更的 guard 内容请运行 \`ssf inject <change-dir>\` 更新。
`;
}

/**
 * Build the SessionStart hook command for CodeBuddy Code CLI.
 *
 * CodeBuddy loads hooks from ~/.codebuddy/settings.json (NOT hooks.json — the
 * user-level hooks.json file is not auto-loaded). The session-start script
 * path points into the deployed spec-superflow runtime directory so the hook
 * stays valid across upgrades. Windows forces Git Bash for hook execution,
 * so double-quoted forward-slash paths work cross-platform.
 */
function buildSessionStartCommand(sessionStartScript) {
  const normalized = String(sessionStartScript).replace(/\\/g, '/');
  return `bash "${normalized}"`;
}

/**
 * Build the hooks object to merge into ~/.codebuddy/settings.json.
 */
function buildSettingsHooks(sessionStartScript) {
  return {
    SessionStart: [
      {
        hooks: [{ type: 'command', command: buildSessionStartCommand(sessionStartScript) }],
      },
    ],
  };
}

/**
 * Merge the spec-superflow SessionStart hook into ~/.codebuddy/settings.json.
 * Preserves other event types (PreToolUse, PostToolUse, ...) and any
 * SessionStart hook entries that do not reference spec-superflow, plus all
 * non-hook top-level fields (permissions, enabledPlugins, ...).
 */
function mergeSettingsJson(existingPath, newHooks) {
  const existing = readJsonIfExists(existingPath);
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    return { hooks: newHooks };
  }
  const merged = { ...existing };
  const existingHooks = existing.hooks && typeof existing.hooks === 'object' && !Array.isArray(existing.hooks)
    ? { ...existing.hooks }
    : {};
  merged.hooks = existingHooks;

  // Other event types are already preserved via the shallow copy above.

  // SessionStart: keep non-spec-superflow entries, replace ssf entry.
  const preservedEntries = [];
  for (const entry of existingHooks.SessionStart || []) {
    if (!entry || !Array.isArray(entry.hooks)) continue;
    const nonSsf = entry.hooks.filter(
      h => !h || typeof h !== 'object' || !h.command || !h.command.includes('spec-superflow'),
    );
    if (nonSsf.length) {
      preservedEntries.push({ ...entry, hooks: nonSsf });
    }
  }
  merged.hooks.SessionStart = [...newHooks.SessionStart, ...preservedEntries];

  return merged;
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
  const tmpDir = await mkdtemp(join(tmpdir(), 'spec-superflow-'));
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

function planInstall({ pluginRoot = defaultPluginRoot, configDir } = {}) {
  const root = resolve(pluginRoot);
  const skillsDir = join(root, 'skills');
  const skillNames = listSkillNames(skillsDir);
  const commandsDir = join(root, 'commands');
  const commandAssets = snapshotCommandAssets(commandsDir);
  const commandNames = commandAssets.map(asset => asset.relativePath.replace(/\.md$/, '').replace('/', ':'));
  assertCanonicalCommands(commandNames);

  const codebuddyRoot = getCodebuddyRoot(configDir);
  const targetPluginDir = join(codebuddyRoot, PLUGIN_NAME);
  const targetSkills = join(codebuddyRoot, 'skills');
  const targetCommands = join(codebuddyRoot, 'commands');
  const targetRules = join(codebuddyRoot, 'rules');
  const targetHooks = join(codebuddyRoot, 'hooks');
  const settingsPath = join(codebuddyRoot, 'settings.json');
  const version = readVersion(root);
  const pluginRootAbs = resolve(targetPluginDir);
  const sessionStartScript = join(pluginRootAbs, 'hooks', 'session-start');

  return {
    pluginRoot: root,
    skillsDir,
    skillNames,
    commandsDir,
    commandNames,
    commandAssets,
    codebuddyRoot,
    targetPluginDir,
    targetSkills,
    targetCommands,
    targetRules,
    targetHooks,
    settingsPath,
    version,
    pluginRootAbs,
    sessionStartScript,
  };
}

// ─── install ──────────────────────────────────────────────

async function installCodeBuddy({ pluginRoot, configDir, plan: providedPlan } = {}) {
  const installPlan = providedPlan || planInstall({ pluginRoot, configDir });
  const {
    skillNames,
    commandNames,
    commandAssets,
    codebuddyRoot,
    targetPluginDir,
    targetSkills,
    targetCommands,
    targetRules,
    targetHooks,
    settingsPath,
    version,
    pluginRootAbs,
    sessionStartScript,
  } = installPlan;

  // 0. Clean old plugin runtime dir (runtime deps only; skills are managed separately).
  if (existsSync(targetPluginDir)) {
    rmSync(targetPluginDir, { recursive: true, force: true });
  }
  ensureDir(targetPluginDir);

  // 1. Copy runtime dependencies (scripts/docs/templates/dist/hooks).
  console.log('📋 Copying runtime dependencies...');
  for (const dir of RUNTIME_DIRS) {
    const src = join(installPlan.pluginRoot, dir);
    const dst = join(targetPluginDir, dir);
    if (existsSync(src)) {
      const count = await copyDir(src, dst);
      console.log(`   ${dir}/ → ${dst} (${count} files)`);
    } else {
      console.log(`   ${dir}/ — skipped (not found)`);
    }
  }

  // Also copy package.json for version identification.
  const pkgSrc = join(installPlan.pluginRoot, 'package.json');
  if (existsSync(pkgSrc)) {
    await cp(pkgSrc, join(targetPluginDir, 'package.json'), { force: true });
  }

  // 2. Copy canonical recovery commands as complete Markdown assets.
  //    Rewrite npx → node <local runtime> so --local installs do not pin a
  //    fixed npm package version (P1: --local recovery commands must use the
  //    deployed runtime).
  const commandCount = await copyValidatedCommands(commandAssets, targetCommands, pluginRootAbs);
  console.log(`   commands/ → ${targetCommands} (${commandCount} files, ${commandNames.length} commands, npx→node rewritten)`);

  // 3. Copy skills with ${CLAUDE_PLUGIN_ROOT} rewriting (preserves unrelated skills).
  const count = await copySkillsWithRoot(installPlan.skillsDir, targetSkills, pluginRootAbs, skillNames);
  console.log(`   skills/ → ${targetSkills} (${count} skills, paths rewritten, unrelated skills preserved)`);

  // 4. Write phase-guard rule (other rules in the directory are left untouched).
  ensureDir(targetRules);
  await writeFile(join(targetRules, 'phase-guard.md'), phaseGuardContent(), 'utf-8');
  console.log(`   phase-guard → ${join(targetRules, 'phase-guard.md')}`);

  // 5. Write/merge SessionStart hook into ~/.codebuddy/settings.json.
  //    CodeBuddy loads hooks from settings.json; user-level hooks.json is not
  //    auto-loaded, so we target settings.json and merge to preserve other
  //    fields (permissions, enabledPlugins, other event hooks, ...).
  ensureDir(codebuddyRoot);
  const settingsHooks = buildSettingsHooks(sessionStartScript);
  const mergedSettings = mergeSettingsJson(settingsPath, settingsHooks);
  await writeFile(settingsPath, JSON.stringify(mergedSettings, null, 2) + '\n', 'utf-8');
  console.log(`   settings.json → ${settingsPath} (SessionStart hook merged)`);

  return installPlan;
}

// ─── CLI entry ────────────────────────────────────────────

export async function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      local: { type: 'string' },
      'config-dir': { type: 'string' },
      tag: { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
  });

  // Dry-run: show plan and exit.
  if (values['dry-run']) {
    const plan = planInstall({
      pluginRoot: values.local || defaultPluginRoot,
      configDir: values['config-dir'],
    });
    console.log('CodeBuddy install plan:');
    console.log(`  Plugin:      ${PLUGIN_NAME} v${plan.version}`);
    console.log(`  Skills:      ${plan.skillNames.length} (${plan.skillNames.join(', ')})`);
    console.log(`  Commands:    ${plan.commandNames.length} (${plan.commandNames.join(', ')})`);
    console.log(`  Config dir:  ${plan.codebuddyRoot}`);
    console.log(`  Plugin root: ${plan.targetPluginDir}`);
    console.log(`  Skills dir:  ${plan.targetSkills}`);
    console.log(`  Rules:       ${plan.targetRules}/phase-guard.md`);
    console.log(`  Commands:    ${plan.targetCommands}`);
    console.log(`  Settings:    ${plan.settingsPath} (SessionStart hook, merged)`);
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
    console.log(`⬆️  Installing spec-superflow ${installedTag} for CodeBuddy ...`);
    pluginRoot = await cloneRelease(installedTag);
    isTemp = true;
  }

  try {
    const plan = await installCodeBuddy({
      pluginRoot,
      configDir: values['config-dir'],
    });

    console.log(`\n✅ CodeBuddy install complete:`);
    console.log(`   Plugin:      ${PLUGIN_NAME} v${plan.version}`);
    console.log(`   Skills:      ${plan.skillNames.length}`);
    console.log(`   Commands:    ${plan.commandNames.length}`);
    console.log(`   Config dir:  ${plan.codebuddyRoot}`);
    console.log(`   Plugin root: ${plan.targetPluginDir}`);
    console.log(`   Skills dir:  ${plan.targetSkills}`);
    console.log(`   Rules:       ${plan.targetRules}/phase-guard.md`);
    console.log(`   Settings:    ${plan.settingsPath} (SessionStart hook merged)`);
    if (installedTag) {
      console.log(`   Version:     ${installedTag}`);
    }
    console.log(`\nNext: restart CodeBuddy Code CLI and try "用 workflow-start 开始".`);
  } finally {
    if (isTemp) {
      rmSync(pluginRoot, { recursive: true, force: true });
    }
  }
}

export { listCommandNames, planInstall, installCodeBuddy, PLUGIN_NAME };
