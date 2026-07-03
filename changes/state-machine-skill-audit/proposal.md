# 变更提案：状态机与 Skill 质量加固

## 背景（Why）

spec-superflow v0.8.7 已迭代 8 个版本，积累了 9 个 skill、7 种状态、8 个决策点、5 层 guard 检查。但**从未进行过系统化的内部质量审计**。随着功能叠加，存在三类潜在风险：

1. **状态机边界漏洞**：guard 检查矩阵是否覆盖所有 transition？rewind 路径（scope change → re-specify, contract drift → re-bridge）是否在真实场景中正确触发？fast-path（hotfix/tweak）的降级逻辑是否正确？debugging ↔ executing 的往返是否无副作用？
2. **Skill 指令质量退化**：9 个 skill 的 SKILL.md 累计约 2300 行指令，可能存在矛盾指令（两个 skill 对同一场景给出不同指引）、冗余步骤（spec-writer 和 contract-builder 重复验证同一条件）、遗漏的异常处理（解析失败、文件缺失、用户中断等路径无兜底）。
3. **决策点链路断裂**：DP-0 到 DP-7 的触发-记录-审计链路是否在每个 skill 中都有强制执行点？是否存在"名义上有 DP 但代码中可以被跳过"的门禁？

本变更对这三个维度进行全面审计，修复所有发现问题，并为每个修复添加回归测试。

## 变更内容（What Changes）

- **D1 状态机转换审计**：审查 `scripts/guard/guard.mjs` 的 TRANSITION_CHECKS 矩阵完整性，验证所有 rewind/fast-path/debugging 转换的实际行为，修复发现的边界条件
- **D2 Skill 指令质量审计**：逐个审查 9 个 skill 的 SKILL.md，检测矛盾指令、冗余步骤、遗漏的异常处理、不符合 DP 协议之处
- **D3 决策点协议审计**：审查 DP-0 到 DP-7 在每个关联 skill 中的触发-记录-审计链路，修复断裂点
- **回归测试**：为每个修复添加自动化测试（guard 测试增强、skill 内容 lint 规则、DP 链路测试）
- **版本**：本次变更不涉及版本号变更，所有修改集中在 `scripts/`、`skills/`、`tests/` 目录

## 能力（Capabilities）

### 新增能力

- `guard-completeness-check` — guard 检查矩阵强制覆盖所有合法 transition
- `skill-lint-rules` — Skill 内容静态分析规则集
- `dp-link-audit` — DP 触发-记录-审计链路自动化验证

### 修改能力

- `guard-transition-matrix` — 补充缺失的 transition 检查维度
- `contract-fresh-check` — 增强 staleness 检测的内容覆盖范围
- `phase-guard-injection` — 修正 phase-guard 中的操作/禁止列表与状态机的对应关系

## 范围（Scope）

### 范围内（In Scope）

- `scripts/guard/guard.mjs` 和 `scripts/guard/checks/` 下 5 个检查模块的覆盖度审计
- `scripts/infer-workflow.mjs` 的 hotfix/tweak 降级逻辑审计
- `scripts/lib/hash.mjs` 和 `scripts/guard/checks/contract-fresh.mjs` 的 staleness 检测准确性
- 9 个 skill 的 SKILL.md 指令一致性审计
- DP-0 到 DP-7 在各 skill 中的触发点和强制机制审计
- 所有修复的回归测试

### 范围外（Out of Scope）

- 跨平台一致性（Claude Code / Cursor / Codex / Copilot / Gemini CLI 的 manifest 和注入机制）— 留给 v1.0.0
- Token 效率优化（hooks 注入大小、skill prompt 压缩）— 留给下一个 change
- 新功能开发、skill 增删合并
- TypeScript 引擎（`src/`）的重构（除非审计发现关键 bug）

## 影响（Impact）

- 影响的代码区域：`scripts/guard/`、`scripts/lib/`、`skills/*/SKILL.md`、`tests/lib/`
- 影响的 API 或接口：`ssf state transition` 的 guard 检查行为可能更严格（之前漏检的非法 transition 将被拦截）
- 依赖或涉及的外部系统：无
