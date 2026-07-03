# 执行合同

## Intent Lock

- **变更名称**：`state-machine-skill-audit`
- **要解决的问题**：spec-superflow v0.8.7 的状态机转换、Skill 指令质量、决策点协议从未系统化审计。Guard 检查矩阵可能不完整（已有证据：两次 transition 出现 "guard check skipped" warning）、9 个 skill 的 SKILL.md 可能存在矛盾指令和遗漏的异常处理、DP 触发-记录-审计链路可能断裂。
- **范围内**：
  - D1: `scripts/guard/` 矩阵完整性 + staleness + debugging 往返 + terminal state 保护
  - D2: `skills/*/SKILL.md` 指令一致性 + 冗余检测 + 异常兜底 + 行为一致性
  - D3: DP-0 到 DP-7 触发点 + 审计链路 + 格式一致性
  - 所有修复的回归测试
- **范围外**：
  - 跨平台一致性（→ v1.0.0）
  - Token 效率优化（→ 下一个 change）
  - 新功能开发
  - TypeScript 引擎重构

## Approved Behavior

### D1 — 状态机转换健壮性（3 ADDED + 1 MODIFIED）
- Guard 检查矩阵覆盖所有 21 个合法 transition + 显式拒绝 8 个非法 transition
- Staleness 检测基于内容比较（hash proposal scope vs contract intent lock），不依赖文件时间戳
- Debugging 往返保留 `batches_completed` 和 `execution_mode`
- Abandoned 和 closing 作为终端状态锁死后续 transition
- Guard 脚本异常不再静默跳过，必须显式失败

### D2 — Skill 指令质量（4 ADDED）
- 跨 skill 引用的 DP 触发条件、transition 规则、术语定义必须一致
- Guard 检查和 skill 内验证不得重复（skill 引用 guard，不自重验）
- 每个 skill 必须覆盖：解析失败、文件缺失、用户中断三条异常路径
- "hard gate" 声明必须对应 guard 中的强制检查

### D3 — 决策点协议完整性（3 ADDED）
- DP-0 到 DP-7 每个在关联 skill 中有显式触发点和记录命令
- `ssf audit` 输出 8 个 DP 的完整状态矩阵
- `.spec-superflow.yaml` 中 DP 字段不被后续操作覆盖

### 关键场景
1. 用户尝试 executing→closing 但 tasks 未全部完成 → guard 拦截
2. proposal scope 扩展但 contract 未更新 → contract-fresh 失败，workflow-start 阻止进入 executing
3. 两个 skill 对同一 DP 描述不一致 → lint 检测并报告
4. spec-writer 生成工件后找不到 contract-builder 路由 → skill 有明确降级指引

## Design Constraints

### 架构约束
- Lint 框架独立于现有 CLI 命令，放在 `scripts/lint/` 下，规则在 `scripts/lint/rules/`
- Guard 矩阵从硬编码改为声明式 TRANSITION_CHECKS + auditMatrix() 自检
- 不引入运行时依赖（延续零依赖策略）

### 接口约束
- 不修改 CLI 命令名称（`ssf state`、`ssf audit`、`ssf validate` 等保持不变）
- `auditMatrix()` 输出 `{ valid, issues[] }` 格式，与 Validator 一致

### 依赖约束
- Batch 4（lint 框架）可与 Batch 1-3（D1 guard 审计）并行
- Batch 5（规划侧 skill）和 Batch 6（执行侧 skill）可并行
- Batch 9（回归测试）依赖所有前序 batch

### 数据约束
- `.spec-superflow.yaml` 的 DP 字段命名保持 `dp_{N}_{field}` 格式
- Skill SKILL.md 结构不改变（保留 frontmatter → instructions → handoff 布局）

## Task Batches

### Batch 1: Guard 矩阵完整性审计
- **目标**：编写 guard 矩阵完整性测试 + auditMatrix() 自检函数
- **输入**：`docs/state-machine.md` 中的合法 transition 列表
- **输出**：`tests/lib/guard-transitions.test.mjs` + `auditMatrix()` 函数
- **完成标准**：测试能运行并准确报告缺失的 transition

### Batch 2: 修复 Guard 矩阵缺失
- **目标**：补全 TRANSITION_CHECKS 矩阵所有条目 + 修复错误处理
- **输入**：Batch 1 的 audit report
- **输出**：补全后的 guard matrix + 不再静默跳过的错误处理
- **完成标准**：全部 21 个合法 transition 有对应检查，非法 transition 被显式拒绝

### Batch 3: Staleness 增强 + Debugging 往返
- **目标**：增强 contract-fresh 的内容比较 + terminal state 保护
- **输入**：Batch 2 的补全矩阵
- **输出**：内容级 staleness 检测 + debugging 状态保留 + terminal state 锁定
- **完成标准**：proposal scope 变化触发 stale，touch 不触发，abandoned 后所有 transition 被拒

### Batch 4: Skill Lint 框架
- **目标**：搭建可扩展的 lint 框架基础
- **输入**：技能目录 `skills/*/SKILL.md`
- **输出**：`scripts/lint/lint-skills.mjs` + 规则注册机制 + 框架测试
- **完成标准**：框架能发现 9 个 skill 并运行已注册规则

### Batch 5: D2 — 规划阶段 Skill 审计
- **目标**：审计 need-explorer, spec-writer, contract-builder
- **输入**：Batch 4 的 lint 框架
- **输出**：3 条 lint 规则（矛盾指令、冗余检查、异常处理）+ 3 个 skill 修复
- **完成标准**：3 个 skill lint issue 数为 0

### Batch 6: D2 — 执行+收尾阶段 Skill 审计
- **目标**：审计 build-executor, bug-investigator, code-reviewer, release-archivist, spec-merger, workflow-start
- **输入**：Batch 4 的 lint 框架
- **输出**：1 条 lint 规则（behavior-consistency）+ 6 个 skill 修复
- **完成标准**：全部 9 个 skill lint issue 数为 0

### Batch 7: D3 — DP 触发点审计
- **目标**：验证 DP-0 到 DP-7 在关联 skill 中有显式触发点
- **输入**：Batch 5+6 修复后的 skill 内容
- **输出**：`dp-trigger-points` 规则 + 缺失触发点修复 + DP 链路测试
- **完成标准**：所有 DP 在关联 skill 中被引用且有记录命令

### Batch 8: D3 — DP 审计链路完整性
- **目标**：增强 ssf audit + release-archivist 的 DP 缺失检测
- **输入**：Batch 7 的触发点修复
- **输出**：audit 中的 DP 状态矩阵 + DP-6 中的缺失检测
- **完成标准**：audit 输出 8 个 DP 完整状态，closing 阶段检测缺失 DP

### Batch 9: 回归测试套件收敛
- **目标**：运行全部测试 + 最终验证
- **输入**：所有前序 batch 的输出
- **输出**：全部测试 PASS + CHANGELOG 更新
- **完成标准**：`npm test` 全绿，`lint-skills.mjs` 返回 0 issue，`check-version-consistency` 通过

## Test Obligations

### 必须先从失败测试开始的行为
- Guard transition 矩阵完整性 → `tests/lib/guard-transitions.test.mjs` 中的边界测试先失败
- Staleness 内容检测 → 先构造 scope drift 场景，测试失败后再实现
- DP 触发点 → 先运行 `dp-trigger-points` lint 规则，报告缺失后再修复
- Skill lint 框架 → 先写测试定义期望的 lint 输出格式，再实现框架

### 必需的边界情况
- Guard 检查：空 change 目录、损坏的 artifacts_hash、并发 transition 请求
- Staleness：proposal 和 contract 都存在但内容不一致、只有 proposal 没有 contract、子句变更 vs 整个 section 变更
- Terminal state：从 abandoned 尝试全部 7 种 transition、closing→abandoned
- Skill lint：skill 目录为空、SKILL.md 为空文件、SKILL.md 为非 Markdown 格式
- DP 审计：`.spec-superflow.yaml` 损坏、缺少部分 DP 字段、时间戳格式错误

### 回归敏感区域
- `ssf state transition` — 修改后应保持向后兼容
- `npm test` — 确保现有 12 个测试文件全部通过
- `ssf validate` — 确保示例 change（add-dark-mode, refactor-auth-boundary）仍能通过验证

## Execution Mode

- **模式**：`SDD`（Subagent-Driven Development）
- **选择理由**：9 个 batch 中多个可并行（Batch 1-3 和 Batch 4 独立；Batch 5 和 Batch 6 独立），SDD 模式每个 batch 派独立 subagent，墙钟时间最短

## Verification Dimensions

| 维度 | 状态 | 发现 |
|------|------|------|
| Completeness | Pending | — |
| Correctness | Pending | — |
| Coherence | Pending | — |

**总体结论**：Pending

## Review Gates

### 强制审查点
- Batch 3 完成后 → code-reviewer 审查 D1 全部修改
- Batch 6 完成后 → code-reviewer 审查 D2 全部修改
- Batch 8 完成后 → code-reviewer 审查 D3 全部修改
- Batch 9 完成后 → code-reviewer 最终审查 + release-archivist

### 阻塞类别
- **Critical**: guard 检查遗漏导致非法 transition 通过、DP 硬门禁可被跳过
- **Important**: skill 指令矛盾、lint 规则漏检
- **Minor**: 注释不准确、变量命名不一致

## Escalation Rules

### 何时回退到 `specifying`
- 审计发现的新问题超出了现有 specs 定义的范围
- 需要新增 requirement 来覆盖发现的缺陷
- 用户要求调整 scope

### 何时回退到 `bridging`
- tasks.md 的 batch 划分在执行中发现不合理需要重构
- design.md 的技术决策在执行中被证明不可行
- 修复过程中发现需要新增或修改设计决策

### 何时不得继续实现
- Guard 检查修改后现有 change（add-dark-mode, refactor-auth-boundary）的验证失败
- Lint 规则产生 false positive 且无法在不降低检出率的前提下修复
- 任何修复导致现有 npm test 回归失败

### 需求覆盖确认
所有 14 条 requirement（7 guard + 4 skill + 3 dp）均已映射到至少一个 batch：
- Guard(5) → Batch 1-3
- Skill(4) → Batch 5-6
- DP(3) → Batch 7-8

无未映射的需求。
