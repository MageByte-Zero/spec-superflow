# 实现任务

## 文件结构

- `Create: scripts/lint/lint-skills.mjs` — Skill 内容静态分析器入口，加载规则、扫描 skills/ 目录、输出结构化报告
- `Create: scripts/lint/rules/no-contradictory-instructions.mjs` — 跨 skill 矛盾指令检测规则
- `Create: scripts/lint/rules/no-redundant-checks.mjs` — 重复验证检查检测规则
- `Create: scripts/lint/rules/exception-handling.mjs` — 异常路径兜底覆盖检测规则
- `Create: scripts/lint/rules/dp-trigger-points.mjs` — DP 触发点存在性检测规则
- `Create: scripts/lint/rules/behavior-consistency.mjs` — Skill 描述与实际行为一致性检测规则
- `Create: tests/lib/guard-transitions.test.mjs` — Guard transition 矩阵回归测试
- `Create: tests/lib/skill-lint.test.mjs` — Skill lint 规则回归测试
- `Create: tests/lib/dp-integrity.test.mjs` — DP 审计链路回归测试
- `Modify: scripts/guard/guard.mjs` — 补全 TRANSITION_CHECKS 矩阵，改进错误处理
- `Modify: scripts/guard/checks/contract-fresh.mjs` — 增强 staleness 检测内容覆盖
- `Modify: scripts/lib/cmd-audit.mjs` — 增加 DP 完整性检查
- `Modify: skills/workflow-start/SKILL.md` — 修正矛盾指令，补充异常处理
- `Modify: skills/need-explorer/SKILL.md` — DP-1 强制执行语言
- `Modify: skills/spec-writer/SKILL.md` — 验证检查一致性
- `Modify: skills/contract-builder/SKILL.md` — DP-3 硬门禁语言统一
- `Modify: skills/build-executor/SKILL.md` — DP-4 强制执行语言
- `Modify: skills/bug-investigator/SKILL.md` — DP-5 升级条件精确化
- `Modify: skills/code-reviewer/SKILL.md` — Review 严重性级别一致性
- `Modify: skills/release-archivist/SKILL.md` — DP-6/DP-7 强制执行 + DP 缺失检测
- `Modify: skills/spec-merger/SKILL.md` — Abandoned change 合并阻止

## 接口

### Batch 1 → Batch 2
- **Produces**: `auditReport: { missingTransitions: string[], weakChecks: {transition: string, missing: string[]}[], errorHandlingGaps: string[] }` — 被 Batch 2 消费，决定需要补全哪些 transition 检查

### Batch 2 → Batch 3
- **Produces**: `guardMatrix: Map<Transition, Check[]>` — 补全后的 guard 矩阵，被 Batch 3 的 staleness 检测增强作为 baseline

### Batch 4 → Batch 5
- **Produces**: `lintFramework: { runLint(): LintReport, registerRule(rule): void }` — 被 Batch 5/6 使用，提供可扩展的 lint 规则运行环境

### Batch 5+6 → Batch 8
- **Produces**: `dpGaps: { dp: string, skill: string, issue: string }[]` — DP 触发点缺失列表，被 Batch 8 消费用于修复 DP 链路

---

## 1. Batch 1: Guard 矩阵完整性审计

**Depends on**: none

- [ ] **1.1 编写 guard 矩阵完整性测试（先写失败测试）**

```javascript
// tests/lib/guard-transitions.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 所有合法 transition（来自 docs/state-machine.md）
const ALL_TRANSITIONS = [
  // 主线
  { from: 'exploring', to: 'specifying' },
  { from: 'specifying', to: 'bridging' },
  { from: 'bridging', to: 'approved-for-build' },
  { from: 'approved-for-build', to: 'executing' },
  { from: 'executing', to: 'closing' },
  // fast-path
  { from: 'exploring', to: 'bridging', workflow: 'hotfix' },
  { from: 'exploring', to: 'approved-for-build', workflow: 'tweak' },
  // rewind
  { from: 'executing', to: 'specifying' },
  { from: 'executing', to: 'bridging' },
  { from: 'approved-for-build', to: 'specifying' },
  { from: 'approved-for-build', to: 'bridging' },
  { from: 'specifying', to: 'exploring' },
  { from: 'bridging', to: 'specifying' },
  // debugging round-trip
  { from: 'executing', to: 'debugging' },
  { from: 'debugging', to: 'executing' },
  // abandon
  { from: 'exploring', to: 'abandoned' },
  { from: 'specifying', to: 'abandoned' },
  { from: 'bridging', to: 'abandoned' },
  { from: 'approved-for-build', to: 'abandoned' },
  { from: 'executing', to: 'abandoned' },
  { from: 'debugging', to: 'abandoned' },
];

// 非法 transition（应被拒绝）
const ILLEGAL_TRANSITIONS = [
  { from: 'exploring', to: 'closing' },
  { from: 'exploring', to: 'executing' },
  { from: 'specifying', to: 'executing' },
  { from: 'specifying', to: 'closing' },
  { from: 'bridging', to: 'closing' },
  { from: 'closing', to: 'abandoned' },
  { from: 'abandoned', to: 'exploring' },
  { from: 'abandoned', to: 'specifying' },
];

describe('Guard transition matrix', () => {
  for (const t of ALL_TRANSITIONS) {
    it(`SHALL define checks for ${t.from} → ${t.to}${t.workflow ? ' (' + t.workflow + ')' : ''}`, () => {
      // 动态 import guard.mjs 的 TRANSITION_CHECKS
      // 验证每个合法 transition 都有对应的 checks 条目
    });
  }

  for (const t of ILLEGAL_TRANSITIONS) {
    it(`SHALL reject illegal transition ${t.from} → ${t.to}`, () => {
      // 验证非法 transition 被明确拒绝
    });
  }
});
```

**Files**: `Create: tests/lib/guard-transitions.test.mjs`

- [ ] **1.2 运行测试并确认失败**

Run: `node --test --experimental-strip-types tests/lib/guard-transitions.test.mjs`
Expected: FAIL — 部分 transition 缺少检查维度，非法 transition 未被明确拦截

- [ ] **1.3 编写 guard 矩阵审计脚本**

```javascript
// 在 guard.mjs 中增加自检函数 export function auditMatrix()
export function auditMatrix() {
  const issues = [];
  const defined = new Set(
    Object.keys(TRANSITION_CHECKS).map(k => k.replace(':hotfix', '').replace(':tweak', ''))
  );
  
  // 检查所有合法 transition 是否在矩阵中
  for (const key of ALL_TRANSITION_KEYS) {
    if (!TRANSITION_CHECKS[key]) {
      issues.push({ severity: 'error', transition: key, issue: 'no checks defined' });
    }
  }
  
  // 检查每个 transition 的检查维度是否完备
  for (const [key, checks] of Object.entries(TRANSITION_CHECKS)) {
    if (!checks.includes('artifacts-exist')) {
      issues.push({ severity: 'warning', transition: key, issue: 'missing artifacts-exist check' });
    }
  }
  
  return { valid: issues.length === 0, issues };
}
```

**Files**: `Modify: scripts/guard/guard.mjs`
**Interfaces**: Produces `auditReport` — 被 Batch 2 消费

- [ ] **1.4 运行 guard 审计获取初始报告**

Run: `node -e "import('./scripts/guard/guard.mjs').then(m => console.log(JSON.stringify(m.auditMatrix(), null, 2)))"`
Expected: 输出结构化审计报告，标注缺失的 transition 和弱检查维度

- [ ] **1.5 提交**

```bash
git add tests/lib/guard-transitions.test.mjs scripts/guard/guard.mjs
git commit -m "audit(d1): add guard matrix completeness audit with failing tests"
```

---

## 2. Batch 2: 修复 Guard 矩阵缺失

**Depends on**: Batch 1

- [ ] **2.1 编写 transition 补全测试**

```javascript
// tests/lib/guard-transitions.test.mjs 追加

describe('Guard transition checks completeness', () => {
  it('SHALL include artifacts-exist in all non-exploring entry transitions', () => {
    const entryTransitions = ['exploring→specifying', 'exploring→bridging:hotfix', 'exploring→approved-for-build:tweak'];
    for (const t of entryTransitions) {
      const checks = getChecks(t);
      assert.ok(checks.includes('artifacts-exist'), `${t} missing artifacts-exist`);
    }
  });

  it('SHALL include schema-valid for transitions into bridging and approved-for-build', () => {
    const schemaTransitions = ['specifying→bridging', 'bridging→approved-for-build'];
    for (const t of schemaTransitions) {
      const checks = getChecks(t);
      assert.ok(checks.includes('schema-valid'), `${t} missing schema-valid`);
    }
  });

  it('SHALL include contract-fresh for transitions into executing', () => {
    const checks = getChecks('approved-for-build→executing');
    assert.ok(checks.includes('contract-fresh'), 'approved-for-build→executing missing contract-fresh');
  });

  it('SHALL include tasks-complete and tests-passing for executing→closing', () => {
    const checks = getChecks('executing→closing');
    assert.ok(checks.includes('tasks-complete'), 'executing→closing missing tasks-complete');
    assert.ok(checks.includes('tests-passing'), 'executing→closing missing tests-passing');
  });
});
```

**Files**: `Modify: tests/lib/guard-transitions.test.mjs`

- [ ] **2.2 运行测试并确认失败**

Run: `node --test --experimental-strip-types tests/lib/guard-transitions.test.mjs`
Expected: FAIL — 补全测试指向的 transition 检查缺失

- [ ] **2.3 补全 TRANSITION_CHECKS 矩阵**

```javascript
// scripts/guard/guard.mjs — 补全 TRANSITION_CHECKS
const TRANSITION_CHECKS = {
  // 主线 —— 维持现有 + 补充验证
  'exploring→specifying':           ['artifacts-exist'],
  'specifying→bridging':            ['artifacts-exist', 'schema-valid'],
  'bridging→approved-for-build':    ['artifacts-exist', 'schema-valid', 'contract-fresh'],
  'approved-for-build→executing':   ['artifacts-exist', 'contract-fresh'],
  'executing→closing':              ['tasks-complete', 'tests-passing'],
  
  // fast-path
  'exploring→bridging:hotfix':      ['artifacts-exist'],
  'exploring→approved-for-build:tweak': ['artifacts-exist'],
  
  // rewind —— 至少验证 artifacts 存在
  'executing→specifying':           ['artifacts-exist'],
  'executing→bridging':             ['artifacts-exist', 'contract-fresh'],
  'approved-for-build→specifying':  ['artifacts-exist'],
  'approved-for-build→bridging':    ['artifacts-exist', 'contract-fresh'],
  'specifying→exploring':           ['artifacts-exist'],
  'bridging→specifying':            ['artifacts-exist'],
  
  // debugging round-trip
  'executing→debugging':            [],
  'debugging→executing':            ['contract-fresh'],
  
  // abandon（从任何非终端状态）
  'exploring→abandoned':            [],
  'specifying→abandoned':           [],
  'bridging→abandoned':             [],
  'approved-for-build→abandoned':   [],
  'executing→abandoned':            [],
  'debugging→abandoned':            [],
};
```

**Files**: `Modify: scripts/guard/guard.mjs`
**Interfaces**: Produces 补全后的 `guardMatrix` — 被 Batch 3 消费

- [ ] **2.4 改进 guard 错误处理：不再静默跳过**

```javascript
// guard.mjs — 替换 catch 块中的 "guard check skipped" 逻辑
try {
  // ... guard checks ...
} catch (err) {
  console.error(`Guard check failed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);  // 不再静默跳过
}
```

**Files**: `Modify: scripts/guard/guard.mjs`

- [ ] **2.5 运行测试并确认通过**

Run: `node --test --experimental-strip-types tests/lib/guard-transitions.test.mjs`
Expected: PASS — 所有 transition 检查补全，错误处理测试通过

- [ ] **2.6 提交**

```bash
git add scripts/guard/guard.mjs tests/lib/guard-transitions.test.mjs
git commit -m "fix(d1): complete guard transition matrix and improve error handling"
```

---

## 3. Batch 3: Staleness 检测增强 + Debugging 往返

**Depends on**: Batch 2

- [ ] **3.1 编写 staleness 检测测试**

```javascript
// tests/lib/guard-transitions.test.mjs 追加
describe('Staleness detection', () => {
  it('SHALL detect when proposal scope expands beyond contract intent lock', async () => {
    // 创建临时 proposal + contract，模拟 scope 扩展
  });

  it('SHALL detect when spec requirement is modified after contract generation', async () => {
    // 修改 spec 内容，验证 contract-fresh 失败
  });

  it('SHALL NOT flag staleness when only file mtime changes', async () => {
    // touch 文件但不改内容，验证 contract-fresh 通过
  });
});

describe('Debugging round-trip', () => {
  it('SHALL preserve batches_completed after debugging→executing', () => {
    // 模拟 executing→debugging→executing，验证进度保留
  });

  it('SHALL detect contract changes during debugging', () => {
    // debugging 期间修改 contract，验证返回 executing 前被拦截
  });
});

describe('Terminal state protection', () => {
  it('SHALL reject all transitions from abandoned', () => {
    // 验证 abandoned 状态下所有 transition 被拒绝
  });

  it('SHALL reject closing→abandoned', () => {
    // 验证 terminal→terminal 被拒绝
  });
});
```

**Files**: `Modify: tests/lib/guard-transitions.test.mjs`

- [ ] **3.2 运行测试并确认失败**

Run: `node --test --experimental-strip-types tests/lib/guard-transitions.test.mjs`
Expected: FAIL — staleness 检测和 terminal state 保护尚未完整实现

- [ ] **3.3 增强 contract-fresh 检查**

```javascript
// scripts/guard/checks/contract-fresh.mjs
// 增强：不仅比较 hash，还比较 proposal scope 和 contract intent lock 的内容
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashContent } from '../../lib/hash.mjs';

export function check(dir) {
  const proposal = readFileSync(join(dir, 'proposal.md'), 'utf-8');
  const contract = readFileSync(join(dir, 'execution-contract.md'), 'utf-8');
  
  // 提取 proposal scope
  const scopeMatch = proposal.match(/## 范围（Scope）\n\n### 范围内[\s\S]*?(?=### 范围外|## )/);
  const proposalScope = scopeMatch ? hashContent(scopeMatch[0]) : null;
  
  // 提取 contract intent lock
  const intentMatch = contract.match(/## Intent Lock[\s\S]*?(?=## |$)/);
  const contractIntent = intentMatch ? hashContent(intentMatch[0]) : null;
  
  return {
    passed: proposalScope === contractIntent,
    detail: proposalScope === contractIntent ? 'contract is fresh' : 'contract is stale: proposal scope diverged from intent lock',
  };
}
```

**Files**: `Modify: scripts/guard/checks/contract-fresh.mjs`

- [ ] **3.4 添加 terminal state 保护**

```javascript
// scripts/guard/guard.mjs — 在 transition 前检查
const TERMINAL_STATES = ['closing', 'abandoned'];

function checkTransition(stateFile, from, to) {
  if (TERMINAL_STATES.includes(from)) {
    return { passed: false, detail: `${from} is a terminal state — no further transitions allowed` };
  }
  if (from === 'closing' && to === 'abandoned') {
    return { passed: false, detail: 'closing is already a terminal state — cannot transition to abandoned' };
  }
  // ... 其他检查 ...
}
```

**Files**: `Modify: scripts/guard/guard.mjs`

- [ ] **3.5 运行测试并确认通过**

Run: `node --test --experimental-strip-types tests/lib/guard-transitions.test.mjs`
Expected: PASS — staleness、debugging round-trip、terminal state 所有测试通过

- [ ] **3.6 提交**

```bash
git add scripts/guard/guard.mjs scripts/guard/checks/contract-fresh.mjs tests/lib/guard-transitions.test.mjs
git commit -m "fix(d1): enhance staleness detection, debugging round-trip, and terminal state protection"
```

---

## 4. Batch 4: Skill Lint 框架

**Depends on**: none（可与 Batch 1-3 并行）

- [ ] **4.1 创建 lint 框架入口**

```javascript
// scripts/lint/lint-skills.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, '..', '..', 'skills');
const RULES_DIR = join(__dirname, 'rules');

async function loadRules() {
  const ruleFiles = readdirSync(RULES_DIR).filter(f => f.endsWith('.mjs'));
  const rules = [];
  for (const file of ruleFiles) {
    const mod = await import(join(RULES_DIR, file));
    if (mod.default) rules.push(mod.default);
  }
  return rules;
}

export async function lintSkills(options = {}) {
  const rules = await loadRules();
  const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  const results = [];
  for (const skillName of skillDirs) {
    const skillPath = join(SKILLS_DIR, skillName);
    const skillMd = join(skillPath, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    
    const content = readFileSync(skillMd, 'utf-8');
    const issues = [];
    for (const rule of rules) {
      const ruleIssues = await rule.check(skillName, content, { skillDirs, skillsDir: SKILLS_DIR });
      issues.push(...ruleIssues);
    }
    results.push({ skill: skillName, issues });
  }
  
  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
  return {
    valid: totalIssues === 0,
    results,
    summary: `${totalIssues} issue(s) across ${results.length} skills`,
  };
}

// CLI entry
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await lintSkills();
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.valid ? 0 : 1);
}
```

**Files**: `Create: scripts/lint/lint-skills.mjs`
**Interfaces**: Produces `lintFramework` — 被 Batch 5/6 消费

- [ ] **4.2 编写 lint 框架测试**

```javascript
// tests/lib/skill-lint.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Skill lint framework', () => {
  it('SHALL discover all 9 skills', async () => {
    const { lintSkills } = await import('../scripts/lint/lint-skills.mjs');
    const report = await lintSkills();
    assert.equal(report.results.length, 9);
  });

  it('SHALL return valid:true when no issues found', async () => {
    // 需要 mock rules 为空
  });

  it('SHALL aggregate issues across all rules', async () => {
    // 验证多个规则的 issue 被合并
  });
});
```

**Files**: `Create: tests/lib/skill-lint.test.mjs`

- [ ] **4.3 运行测试并确认失败**

Run: `node --test --experimental-strip-types tests/lib/skill-lint.test.mjs`
Expected: FAIL — lint 框架存在但尚无规则，测试验证框架能加载

- [ ] **4.4 实现最小化框架（确保测试通过）**

完成 `scripts/lint/lint-skills.mjs` 和第一条规则占位。

**Files**: `Modify: scripts/lint/lint-skills.mjs`, `Create: scripts/lint/rules/.gitkeep`

- [ ] **4.5 运行测试并确认通过**

Run: `node --test --experimental-strip-types tests/lib/skill-lint.test.mjs`
Expected: PASS

- [ ] **4.6 提交**

```bash
git add scripts/lint/ tests/lib/skill-lint.test.mjs
git commit -m "feat(d2): add skill lint framework"
```

---

## 5. Batch 5: D2 前半 — 规划阶段 Skill 审计

**Depends on**: Batch 4

按 skill 分组审计：need-explorer, spec-writer, contract-builder（规划侧的 3 个 skill）。

- [ ] **5.1 编写矛盾指令检测规则**

```javascript
// scripts/lint/rules/no-contradictory-instructions.mjs
// 检测：跨 skill 引用同一 DP 时描述是否一致
// 检测：状态转换规则在 workflow-start 和 route 目标 skill 间是否一致

export default {
  name: 'no-contradictory-instructions',
  async check(skillName, content, ctx) {
    const issues = [];
    
    // 提取本 skill 中引用的 DP
    const dpRefs = [...content.matchAll(/DP-(\d)/g)].map(m => m[1]);
    
    // 对于每个引用的 DP，检查 docs/decision-points.md 中的定义是否一致
    // （简化版：检查 trigger 条件的关键词是否匹配）
    for (const dpNum of dpRefs) {
      // 比较 docs/decision-points.md 中的 DP 定义
    }
    
    return issues;
  }
};
```

**Files**: `Create: scripts/lint/rules/no-contradictory-instructions.mjs`

- [ ] **5.2 编写冗余检查检测规则**

```javascript
// scripts/lint/rules/no-redundant-checks.mjs
// 检测：spec-writer 和 contract-builder 是否重复了相同的 validation 步骤
// 检测：skill 内部是否重复了 guard 已经做的检查

export default {
  name: 'no-redundant-checks',
  async check(skillName, content, ctx) {
    const issues = [];
    
    // 提取 skill 中的 validation checklists
    const checklists = content.match(/## .*[Vv]alidat.*\n\n([\s\S]*?)(?=\n## |$)/g) || [];
    
    // 如果某个 validation checklist 与 guard checks 完全重叠，标记为冗余
    return issues;
  }
};
```

**Files**: `Create: scripts/lint/rules/no-redundant-checks.mjs`

- [ ] **5.3 编写异常处理检测规则**

```javascript
// scripts/lint/rules/exception-handling.mjs
// 检测：skill 是否提到了 "解析失败"、"文件缺失"、"用户中断" 时的处理
// 检测：是否有 "如果 X 则 Y" 的条件分支覆盖异常路径

export default {
  name: 'exception-handling',
  async check(skillName, content, ctx) {
    const issues = [];
    
    const exceptionPatterns = [
      { pattern: /解析失败|parse (error|fail)/i, label: 'parse failure handling' },
      { pattern: /文件缺失|file (not found|missing)/i, label: 'missing file handling' },
      { pattern: /用户中断|user (interrupt|cancel|stop)/i, label: 'user interruption handling' },
    ];
    
    // 检查 skill 是否提到了 TDD/SDD/batch 等执行概念但未说明失败时怎么办
    return issues;
  }
};
```

**Files**: `Create: scripts/lint/rules/exception-handling.mjs`

- [ ] **5.4 运行 lint 获取 need-explorer / spec-writer / contract-builder 审计报告**

Run: `node scripts/lint/lint-skills.mjs 2>&1 | node -e "const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); console.log(JSON.stringify(r.results.filter(x=>['need-explorer','spec-writer','contract-builder'].includes(x.skill)), null, 2))"`
Expected: 结构化 issue 列表（矛盾指令、冗余检查、异常处理缺失）

- [ ] **5.5 修复 need-explorer 问题**

根据 lint 报告，修改 `skills/need-explorer/SKILL.md`：
- 确保 DP-1 触发条件与 `docs/decision-points.md` 一致
- 补充异常处理指引（用户中断后如何恢复）
- 移除与 workflow-start 重复的检查

**Files**: `Modify: skills/need-explorer/SKILL.md`

- [ ] **5.6 修复 spec-writer 问题**

根据 lint 报告，修改 `skills/spec-writer/SKILL.md`：
- 确保 validation checklist 不与 guard.mjs 的 schema-valid 检查重复（改为引用 guard 而非重做）
- 补充解析失败时的降级指引

**Files**: `Modify: skills/spec-writer/SKILL.md`

- [ ] **5.7 修复 contract-builder 问题**

根据 lint 报告，修改 `skills/contract-builder/SKILL.md`：
- DP-3 语言统一为 "hard gate, cannot be skipped"（与 decision-points.md 一致）
- 补充 artifact 解析失败的修复建议路径

**Files**: `Modify: skills/contract-builder/SKILL.md`

- [ ] **5.8 运行 lint 确认修复**

Run: `node scripts/lint/lint-skills.mjs`
Expected: need-explorer, spec-writer, contract-builder 的 issue 数为 0

- [ ] **5.9 提交**

```bash
git add skills/need-explorer/SKILL.md skills/spec-writer/SKILL.md skills/contract-builder/SKILL.md scripts/lint/rules/
git commit -m "fix(d2): audit and fix planning-phase skills (need-explorer, spec-writer, contract-builder)"
```

---

## 6. Batch 6: D2 后半 — 执行 + 收尾阶段 Skill 审计

**Depends on**: Batch 4（与 Batch 5 可并行）

- [ ] **6.1 编写 behavior consistency 检测规则**

```javascript
// scripts/lint/rules/behavior-consistency.mjs
// 检测：skill 描述的 "route to X" 是否在 workflow-start 的 routing rules 中有对应
// 检测：skill 描述的 "⛔ 禁止操作" 是否在 phase-guard.md 中有对应阻止

export default {
  name: 'behavior-consistency',
  async check(skillName, content, ctx) {
    const issues = [];
    
    // 检查 "hard gate" 声明是否有对应的 guard 检查
    if (content.includes('hard gate') || content.includes('硬门禁')) {
      // 验证 guard.mjs 中是否有对应检查
    }
    
    // 检查 routing references 是否双向一致
    const routeRefs = [...content.matchAll(/route to `([^`]+)`/g)].map(m => m[1]);
    // 验证 workflow-start 中是否有对应的路由规则
    
    return issues;
  }
};
```

**Files**: `Create: scripts/lint/rules/behavior-consistency.mjs`

- [ ] **6.2 运行 lint 获取 build-executor, bug-investigator, code-reviewer, release-archivist, spec-merger, workflow-start 审计报告**

Run: `node scripts/lint/lint-skills.mjs`
Expected: 结构化 issue 列表

- [ ] **6.3 修复 build-executor 问题**

- DP-4 TDD Iron Law 条件与 contract 中的 test obligations 对齐
- 补充 subagent 调度失败时的重试和降级策略

**Files**: `Modify: skills/build-executor/SKILL.md`

- [ ] **6.4 修复 bug-investigator 问题**

- DP-5 "连续 3 次失败" 的计数规则精确化（同类型失败算一次还是每次都算？）
- 补充 4-phase 分析中每阶段的超时/放弃条件

**Files**: `Modify: skills/bug-investigator/SKILL.md`

- [ ] **6.5 修复 code-reviewer 问题**

- Critical / Important / Minor 三级 severity 的定义与 workflow-start 中的 review gate 描述对齐
- 补充 "performative agreement" 反模式的检测示例

**Files**: `Modify: skills/code-reviewer/SKILL.md`

- [ ] **6.6 修复 release-archivist 问题**

- DP-6 验证失败的分支选择（返回修复 vs 放弃关闭）条件明确化
- DP-7 归档确认前增加 DP 缺失检测（reference: decision 4 in design.md）
- 补充 3D verification 的 per-dimension 通过/失败标准

**Files**: `Modify: skills/release-archivist/SKILL.md`

- [ ] **6.7 修复 spec-merger 问题**

- 增加 abandoned change 的 delta spec 合并阻止（与 state machine 规则一致）
- 补充合并冲突的分步解决指引

**Files**: `Modify: skills/spec-merger/SKILL.md`

- [ ] **6.8 修复 workflow-start 问题**

- 确保所有 routing rules 是双向一致的（workflow-start 的 route 与目标 skill 的 handoff 匹配）
- 补充 staleness 检测失败时的明确路由（rewind 到哪个状态）
- 确保 guard check 失败时不再静默跳过

**Files**: `Modify: skills/workflow-start/SKILL.md`

- [ ] **6.9 运行 lint 确认全部修复**

Run: `node scripts/lint/lint-skills.mjs`
Expected: 全部 9 个 skill issue 数为 0

- [ ] **6.10 提交**

```bash
git add skills/ scripts/lint/rules/
git commit -m "fix(d2): audit and fix execution+closing phase skills (6 skills)"
```

---

## 7. Batch 7: DP 触发点审计

**Depends on**: Batch 5, Batch 6

- [ ] **7.1 编写 DP 触发点检测规则**

```javascript
// scripts/lint/rules/dp-trigger-points.mjs
// 每个 DP 在关联 skill 中必须有触发描述（"触发条件" 或 "When to run DP-N"）
// 每个 DP 在关联 skill 中必须有记录命令（"ssf state set ... dp_N_"）

const DP_SKILL_MAP = {
  'DP-0': ['workflow-start'],
  'DP-1': ['need-explorer'],
  'DP-2': ['spec-writer'],
  'DP-3': ['contract-builder'],
  'DP-4': ['build-executor'],
  'DP-5': ['bug-investigator'],
  'DP-6': ['release-archivist'],
  'DP-7': ['release-archivist'],
};

export default {
  name: 'dp-trigger-points',
  async check(skillName, content, ctx) {
    const issues = [];
    for (const [dp, skills] of Object.entries(DP_SKILL_MAP)) {
      if (skills.includes(skillName)) {
        // 检查 skill 中是否有 DP 触发条件描述
        if (!content.includes(dp)) {
          issues.push({
            skill: skillName,
            severity: 'error',
            message: `${dp} not mentioned in ${skillName} SKILL.md — trigger point may be missing`,
          });
        }
        // 检查是否有记录命令
        if (!content.includes(`dp_${dp.slice(-1)}_`)) {
          issues.push({
            skill: skillName,
            severity: 'warning',
            message: `${dp} has no record command (ssf state set ... dp_N_*) in ${skillName}`,
          });
        }
      }
    }
    return issues;
  }
};
```

**Files**: `Create: scripts/lint/rules/dp-trigger-points.mjs`

- [ ] **7.2 编写 DP 链路测试**

```javascript
// tests/lib/dp-integrity.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('DP trigger points', () => {
  const DP_SKILL_MAP = { /* DP → [skills] mapping */ };
  
  for (const [dp, skills] of Object.entries(DP_SKILL_MAP)) {
    for (const skill of skills) {
      it(`${dp} SHALL have a trigger point in ${skill}`, async () => {
        // 读取 skill SKILL.md，验证包含 DP 引用和记录命令
      });
    }
  }
});

describe('DP audit trail', () => {
  it('SHALL list all 8 DPs with status in audit report', () => {
    // 运行 ssf audit，验证输出包含 DP-0 到 DP-7
  });

  it('SHALL detect missing DP records', () => {
    // 创建缺少 DP-2 的状态文件，验证 audit 报告缺失
  });
});
```

**Files**: `Create: tests/lib/dp-integrity.test.mjs`

- [ ] **7.3 运行测试并确认失败**

Run: `node --test --experimental-strip-types tests/lib/dp-integrity.test.mjs`
Expected: FAIL — 部分 DP 在关联 skill 中缺少显式触发点

- [ ] **7.4 修复 DP 触发点缺失**

根据测试报告，在缺失的 skill 中补充 DP 触发描述和记录命令。
修改范围：workflow-start, need-explorer, spec-writer, contract-builder, build-executor, bug-investigator, release-archivist 的 SKILL.md。

**Files**: `Modify: skills/*/SKILL.md`（根据实际缺失情况）

- [ ] **7.5 运行测试并确认通过**

Run: `node --test --experimental-strip-types tests/lib/dp-integrity.test.mjs`
Expected: PASS

- [ ] **7.6 提交**

```bash
git add skills/ scripts/lint/rules/dp-trigger-points.mjs tests/lib/dp-integrity.test.mjs
git commit -m "fix(d3): add DP trigger point detection and fix missing triggers"
```

---

## 8. Batch 8: DP 审计链路完整性

**Depends on**: Batch 7

- [ ] **8.1 增强 ssf audit 的 DP 完整性检查**

```javascript
// scripts/lib/cmd-audit.mjs — 在 audit 报告中增加 DP 状态矩阵

function buildDpMatrix(stateFile) {
  const dpStatus = [];
  for (let i = 0; i <= 7; i++) {
    const result = stateFile[`dp_${i}_result`];
    const timestamp = stateFile[`dp_${i}_timestamp`];
    dpStatus.push({
      id: `DP-${i}`,
      name: DP_NAMES[i],
      status: result ? (result.startsWith('confirmed') ? 'confirmed' : 'skipped') : 'pending',
      timestamp: timestamp || null,
      summary: result || null,
    });
  }
  return dpStatus;
}
```

**Files**: `Modify: scripts/lib/cmd-audit.mjs`
**Consumes**: `dpGaps` — 从 Batch 5+6 的 lint 报告中发现的具体缺失

- [ ] **8.2 在 release-archivist 中增加 DP 缺失检测**

在 DP-6 验证阶段增加：检查所有必要 DP 是否已记录，如有缺失则提示用户确认。

**Files**: `Modify: skills/release-archivist/SKILL.md`

- [ ] **8.3 编写 DP 审计链路端到端测试**

```javascript
// tests/lib/dp-integrity.test.mjs 追加
describe('DP audit trail end-to-end', () => {
  it('SHALL generate audit report with all 8 DPs', async () => {
    // 模拟完整 change 的 .spec-superflow.yaml，运行 audit
  });

  it('SHALL flag missing DP-2 and DP-3 in closing phase', () => {
    // 模拟缺失 DP-2 的状态文件，验证 closing 阶段被拦截
  });

  it('SHALL preserve existing DP records when state file is updated', () => {
    // 模拟 ssf state set 修改其他字段，验证 DP 记录不被覆盖
  });
});
```

**Files**: `Modify: tests/lib/dp-integrity.test.mjs`

- [ ] **8.4 运行测试并确认通过**

Run: `node --test --experimental-strip-types tests/lib/dp-integrity.test.mjs`
Expected: PASS

- [ ] **8.5 提交**

```bash
git add scripts/lib/cmd-audit.mjs skills/release-archivist/SKILL.md tests/lib/dp-integrity.test.mjs
git commit -m "fix(d3): complete DP audit trail with gap detection and integrity tests"
```

---

## 9. Batch 9: 回归测试套件 + 最终验证

**Depends on**: Batch 2, Batch 3, Batch 5, Batch 6, Batch 7, Batch 8

- [ ] **9.1 运行全部测试确认回归**

Run: `npm test`
Expected: 所有现有测试 + 新增测试全部 PASS

- [ ] **9.2 运行 guard 完整性自检**

Run: `node -e "import('./scripts/guard/guard.mjs').then(m => console.log(JSON.stringify(m.auditMatrix(), null, 2)))"`
Expected: `{ "valid": true, "issues": [] }`

- [ ] **9.3 运行 skill lint 确认全绿**

Run: `node scripts/lint/lint-skills.mjs`
Expected: `{ "valid": true, "results": [...], "summary": "0 issue(s) across 9 skills" }`

- [ ] **9.4 运行版本一致性检查**

Run: `node scripts/check-version-consistency.mjs`
Expected: ✅ Version consistency check passed

- [ ] **9.5 完善回归测试覆盖描述**

在测试文件中为每个测试用例添加 spec requirement 引用注释：

```javascript
// Requirement: Guard 检查矩阵完整性
// Scenario: 主线 transition 全覆盖
it('SHALL define checks for exploring→specifying', () => { ... });
```

**Files**: `Modify: tests/lib/guard-transitions.test.mjs, tests/lib/skill-lint.test.mjs, tests/lib/dp-integrity.test.mjs`

- [ ] **9.6 提交**

```bash
git add tests/
git commit -m "test: complete regression test suite for D1+D2+D3 audit"
```

- [ ] **9.7 最终提交 — CHANGELOG**

```bash
git add CHANGELOG.md  # 如需要
git commit -m "docs: add state-machine-skill-audit to CHANGELOG"
```
