// scripts/lib/cmd-inject.mjs — ssf inject: generate phase-guard artifacts for multiple platforms
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { readState } from './state-loader.mjs';

const PHASE_TEMPLATES = {
  'exploring': `# Phase Guard: {{change_name}}

**当前阶段**: {{state}} | **工作流**: {{workflow}}

## ✅ 允许操作
- 澄清需求、比较方案
- 与用户讨论 scope 和 capabilities

## ⛔ 禁止操作
- 创建规划工件（proposal.md, specs/, design.md, tasks.md）
- 执行实现代码
- 修改 execution-contract.md

## 🔔 决策点
- DP-1: 需求确认 — 进入 specifying 前需用户确认 scope`,

  'specifying': `# Phase Guard: {{change_name}}

**当前阶段**: {{state}} | **工作流**: {{workflow}}

## ✅ 允许操作
- 创建/修改 proposal.md
- 创建/修改 specs/ 目录中的规格文件
- 创建/修改 design.md
- 创建/修改 tasks.md

## ⛔ 禁止操作
- 修改 execution-contract.md
- 执行实现代码
- 修改已批准的 specs（需先回退状态）

## 🔔 决策点
- DP-2: 工件审查 — 完成后需用户审查所有工件`,

  'bridging': `# Phase Guard: {{change_name}}

**当前阶段**: {{state}} | **工作流**: {{workflow}}

## ✅ 允许操作
- 生成/修改 execution-contract.md
- 运行 ssf validate 验证工件

## ⛔ 禁止操作
- 执行实现代码
- 修改 proposal.md, specs/, design.md, tasks.md（需先回退到 specifying）

## 🔔 决策点
- DP-3: 契约批准 — 用户必须明确批准 execution-contract.md（硬门禁）`,

  'approved-for-build': `# Phase Guard: {{change_name}}

**当前阶段**: {{state}} | **工作流**: {{workflow}}

## ✅ 允许操作
- 运行 ssf execution recommend <change-dir> [--wave ...]，完成 DP-4 执行模式选择，列出可用模式与推荐并写入当前推荐凭据
- 向用户展示候选项、项目事实与推荐，取得明确选择
- 运行 ssf execution plan <change-dir> --mode <mode> --confirm ... 生成 execution plan；它必须使用匹配当前 artifact、contract 和 wave 的推荐凭据，非推荐选择需 --acknowledge-recommendation
- 运行 ssf execution show <change-dir> --json 核对 current、revision、mode、waves[].eligible 和 receipts
- 准备执行环境

## ⛔ 禁止操作
- full/hotfix 没有 current execution plan 时不得开始实现或转换到 executing；tweak 免除此 plan/receipt gate
- 修改 execution-contract.md（需回退到 bridging）
- 修改 proposal.md, specs/, design.md, tasks.md

## 🔔 决策点
- DP-4 执行模式选择：先运行 execution recommend 并展示可用模式和推荐；用户用 --confirm 确认，非推荐选择额外使用 --acknowledge-recommendation。plan/revise 需要当前匹配的推荐凭据。仅当 execution show 报告 current: true 后才可转换到 executing；tweak 免除此 plan/receipt gate`,

  'executing': `# Phase Guard: {{change_name}}

**当前阶段**: {{state}} | **工作流**: {{workflow}}

## ✅ 允许操作
- 按 execution-contract.md 和 current execution plan 的 wave 执行任务
- 运行测试
- 提交代码（按 batch 提交）
- full/hotfix 每个完成 wave 后记录 wave review 的 review receipt（pass 或 fail）；tweak 免除此 plan/receipt gate

## ⛔ 禁止操作
- 修改 proposal.md, specs/, design.md（需先回退到 specifying）
- 修改 execution-contract.md（需先回退到 bridging）
- 跳过测试步骤
- full/hotfix 不得跳过 wave review；没有所有 pass review receipts 不得进入 closing；tweak 免除此 plan/receipt gate

## 🔔 决策点
- DP-5: 调试升级 — 3+ 修复失败后需用户决定`,

  'debugging': `# Phase Guard: {{change_name}}

**当前阶段**: {{state}} | **工作流**: {{workflow}}

## ✅ 允许操作
- 分析根因（4 阶段根因分析）
- 修复 bug（TDD 修复循环）
- 返回 executing 状态

## ⛔ 禁止操作
- 修改 proposal.md, specs/, design.md
- 开始新任务
- 跳过根因分析直接修复`,

  'closing': `# Phase Guard: {{change_name}}

**当前阶段**: {{state}} | **工作流**: {{workflow}}

## ⛔ 终止状态
- 此变更已成功关闭；验证、规范同步和归档确认均已完成
- 不允许任何进一步操作或状态转换
- 不得重跑实现、验证、归档或 delta spec 合并
- 恢复时只报告 CLOSED；next skill 为 none`,

  'abandoned': `# Phase Guard: {{change_name}}

**当前阶段**: {{state}} | **工作流**: {{workflow}}

## ⛔ 终止状态
- 此变更已放弃，不允许任何进一步操作
- 不得合并 delta specs
- 不得从 abandoned 状态转换`,
};

const SUPPORTED_PLATFORMS = ['claude', 'cursor', 'copilot', 'gemini'];
const PHASE_GUARD_MARKERS = {
  start: '\n\n<!-- spec-superflow-phase-guard-start -->\n',
  end: '<!-- spec-superflow-phase-guard-end -->\n',
};

function unique(values) {
  return [...new Set(values)];
}

function generatePhaseGuard(state) {
  const template = PHASE_TEMPLATES[state.state] || PHASE_TEMPLATES['exploring'];
  return template
    .replace(/\{\{change_name\}\}/g, state.change_name || 'unknown')
    .replace(/\{\{state\}\}/g, state.state || 'exploring')
    .replace(/\{\{workflow\}\}/g, state.workflow || 'full');
}

function toCursorMdc(base) {
  return `---
description: spec-superflow phase guard
alwaysApply: true
---

${base}`;
}

function toCopilotInstructions(base) {
  // Base already starts with "# Phase Guard: ..."; ensure a clear top-level heading.
  return base.replace(/^# Phase Guard:.*$/m, '# Phase Guard');
}

function injectGemini(base, geminiPath) {
  const section = `# Phase Guard\n\n${base.replace(/^# Phase Guard:.*\n?/m, '').trim()}\n`;
  const wrapped = `${PHASE_GUARD_MARKERS.start}${section}${PHASE_GUARD_MARKERS.end}`;

  let content = '';
  if (existsSync(geminiPath)) {
    content = readFileSync(geminiPath, 'utf-8');
  }

  const startIdx = content.indexOf(PHASE_GUARD_MARKERS.start);
  if (startIdx !== -1) {
    const endIdx = content.indexOf(PHASE_GUARD_MARKERS.end, startIdx);
    if (endIdx !== -1) {
      content = content.slice(0, startIdx) + wrapped + content.slice(endIdx + PHASE_GUARD_MARKERS.end.length);
    } else {
      content = content.slice(0, startIdx) + wrapped;
    }
  } else {
    content = content.trimEnd() + '\n' + wrapped;
  }

  writeFileSync(geminiPath, content, 'utf-8');
}

function writeFile(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
}

export function parsePlatformList(value) {
  if (!value) return null;
  const requested = value.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
  if (requested.includes('all')) {
    if (requested.length > 1) return ['__invalid_all_combo__'];
    return [...SUPPORTED_PLATFORMS];
  }
  return unique(requested);
}

export function detectProjectPlatforms(projectRoot) {
  const detected = [];
  if (existsSync(join(projectRoot, '.claude'))) detected.push('claude');
  if (existsSync(join(projectRoot, '.cursor')) || existsSync(join(projectRoot, '.cursor', 'rules'))) detected.push('cursor');
  if (existsSync(join(projectRoot, '.github', 'copilot-instructions.md'))) detected.push('copilot');
  if (existsSync(join(projectRoot, 'GEMINI.md'))) detected.push('gemini');
  return detected;
}

export function resolvePlatforms(value, projectRoot) {
  const explicit = parsePlatformList(value);
  if (explicit) {
    if (explicit.includes('__invalid_all_combo__')) {
      return { ok: false, message: '`all` cannot be combined with other platforms. Use --platforms all or a comma-separated platform list.' };
    }
    const invalid = explicit.filter(p => !SUPPORTED_PLATFORMS.includes(p));
    if (invalid.length > 0) {
      return { ok: false, message: `Unsupported platform(s): ${invalid.join(', ')}. Supported: ${SUPPORTED_PLATFORMS.join(', ')} or all` };
    }
    return { ok: true, platforms: explicit };
  }

  const detected = detectProjectPlatforms(projectRoot);
  if (detected.length === 1) {
    return { ok: true, platforms: detected };
  }
  if (detected.length === 0) {
    return { ok: false, message: 'Could not detect target platform. Re-run with --platforms claude|cursor|copilot|gemini or --platforms all.' };
  }
  return { ok: false, message: `Detected multiple platform markers (${detected.join(', ')}). Re-run with --platforms <platform> or --platforms all.` };
}

const PLATFORM_WRITERS = {
  claude(base, projectRoot) {
    const alwaysDir = join(projectRoot, '.claude', 'always');
    mkdirSync(alwaysDir, { recursive: true });
    writeFileSync(join(alwaysDir, 'phase-guard.md'), base);
  },
  cursor(base, projectRoot) {
    const cursorRulesDir = join(projectRoot, '.cursor', 'rules');
    mkdirSync(cursorRulesDir, { recursive: true });
    writeFileSync(join(cursorRulesDir, 'phase-guard.mdc'), toCursorMdc(base));
  },
  copilot(base, projectRoot) {
    const copilotPath = join(projectRoot, '.github', 'copilot-instructions.md');
    writeFile(copilotPath, toCopilotInstructions(base));
  },
  gemini(base, projectRoot) {
    injectGemini(base, join(projectRoot, 'GEMINI.md'));
  },
};

export async function run(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      json: { type: 'boolean', default: false },
      platforms: { type: 'string' },
    },
    allowPositionals: true,
  });

  const changeDir = positionals[0];
  if (!changeDir) {
    console.error('Usage: ssf inject <change-dir> [--platforms claude,cursor,copilot,gemini|all] [--json]');
    process.exit(2);
  }

  const projectRoot = process.cwd();
  const resolved = resolvePlatforms(values.platforms, projectRoot);
  if (!resolved.ok) {
    console.error(resolved.message);
    process.exit(2);
  }
  const requested = resolved.platforms;

  // Read state (graceful fallback if missing)
  const stateFile = join(changeDir, '.spec-superflow.yaml');
  if (!existsSync(stateFile)) {
    if (!values.json) console.log(`⚠️ No .spec-superflow.yaml found in ${changeDir}, using defaults`);
  }
  const state = readState(changeDir);

  // Generate base phase-guard content
  const base = generatePhaseGuard(state);
  const outputs = [];

  for (const platform of requested) {
    PLATFORM_WRITERS[platform](base, projectRoot);
    outputs.push(platform);
  }

  if (values.json) {
    console.log(JSON.stringify({ ok: true, platforms: outputs, state: state.state, workflow: state.workflow, change_name: state.change_name }));
  } else {
    for (const platform of outputs) {
      console.log(`✅ Injected ${platform}`);
    }
    console.log(`   Change: ${state.change_name} | State: ${state.state} | Workflow: ${state.workflow}`);
  }
}

export { generatePhaseGuard, toCursorMdc, toCopilotInstructions };
