# 技术设计：状态机与 Skill 质量加固

## 上下文

- **当前状态**：v0.8.7 有 7 种状态、9 个 skill、8 个决策点。Guard 系统通过 `scripts/guard/guard.mjs` 实现 transition 检查矩阵，包含 5 个检查维度。Skill 质量依赖人工审查，无自动化 lint。DP 记录通过 `ssf state set` 命令手动写入 `.spec-superflow.yaml`。
- **约束条件**：允许破坏性变更（skill 改名/合并、状态机重定义）。不新增运行时依赖。Node >= 22。测试使用 Node 原生 test runner。
- **利益相关者**：spec-superflow 的 Claude Code / Cursor / Codex / Copilot / Gemini CLI 用户。

## 目标

1. Guard 检查矩阵覆盖所有合法 transition（含 rewind、fast-path、debugging round-trip）
2. 9 个 skill 的 SKILL.md 无矛盾指令、无冗余步骤、异常路径有明确兜底
3. DP-0 到 DP-7 在每个关联 skill 中有强制执行点
4. 所有修复有回归测试覆盖

## 非目标

- 跨平台注入一致性（→ v1.0.0）
- Token 优化（→ 下一个 change）
- 新 skill 或 skill 合并
- TypeScript 引擎重构（除非审计发现关键 bug）

## 决策

### 决策 1：审计方法 — 结构对比 + 自动化扫描

- **选择**：先用静态分析脚本扫描 guard matrix / skill 内容结构 / DP 链路，再人工审查异常项
- **理由**：9 个 skill 共约 2300 行，纯人工审查不可靠且耗时。先自动化扫描生成 audit report，再人工审查 flagged 项，既系统化又高效
- **考虑的替代方案**：
  - 纯人工审查：全面但耗时且不可复现
  - 纯自动化：快速但无法检测语义矛盾

### 决策 2：Skill Lint 实现方式

- **选择**：新增 `scripts/lint/` 目录，实现基于规则的静态分析器，规则定义在 `scripts/lint/rules/` 中
- **理由**：保持零运行时依赖；规则可逐条添加和测试；输出格式与现有 validate 命令一致
- **考虑的替代方案**：
  - 使用 markdownlint + 自定义规则：引入外部依赖，且无法做跨文件语义分析
  - 在 CI 中直接 grep：无法处理结构化规则

### 决策 3：Guard 矩阵补全策略

- **选择**：将 TRANSITION_CHECKS 从硬编码改为数据驱动的声明式矩阵，缺失的 transition 在 CI 中报错
- **理由**：当前 matrix 是 JavaScript 对象，新增 transition 时容易忘记添加检查。声明式矩阵可以自检完整性（枚举所有状态 × 所有合法 transition × 必填维度）
- **考虑的替代方案**：
  - 保持硬编码但添加更多检查：短期够用但治标不治本
  - 用 JSON Schema 定义 matrix：过度工程

### 决策 4：DP 链路验证方式

- **选择**：在 `ssf audit` 中增加 DP 完整性检查，在 release-archivist 的 DP-6 中增加 DP 缺失检测
- **理由**：在已有 audit 命令上扩展，不需要新增 CLI 命令；在 closing 阶段强制检查 DP 完整性
- **考虑的替代方案**：
  - 在每个 transition 时都检查：增加 transition 耗时
  - 只在 CI 中检查：本地开发时无法发现

## 风险与权衡

- **风险**：Guard 矩阵变严格后，之前"能通过"的 transition 现在可能被拦截 → **缓解**：提供清晰的错误信息和修复指引（如 "缺少 artifacts，请先运行 spec-writer"）
- **风险**：Skill 内容修改可能导致正在使用旧版 skill 的用户行为变化 → **缓解**：skill 内容修改集中在问题修复，不改变工作流主干
- **风险**：DP 链路验证可能在 closing 阶段发现历史缺失，阻塞归档 → **缓解**：对历史缺失提供 "确认跳过" 选项

## 迁移计划

- **上线步骤**：
  1. 运行审计脚本，生成 audit report
  2. 按 D1 → D2 → D3 顺序修复
  3. 每个维度修复后运行回归测试
  4. 全部通过后提交
- **回滚步骤**：git revert 到审计前的 commit

## 待明确问题

- 无（所有决策已在 DP-0 和 need-explorer 阶段确认）
