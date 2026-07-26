# 执行合同

## Intent Lock

- **变更名称**：`eliminate-spec-drift`
- **要解决的问题**：`ssf sync` 将 change 的 delta spec 原样复制至根 `specs/`，而 closing 只依赖无证据的 `spec_merged` 布尔值，导致活动规范与发布基线能够静默漂移。
- **范围内**：活动 change 的路径上下文、delta 到基线的应用、可重算发布回执、closing 验证、回归测试，以及同步相关技能/文档。
- **范围外**：不改变八状态模型或执行计划格式；根 `specs/` 不驱动任何活动状态转换；不自动修复未明确同步的历史漂移。

## Approved Behavior

- **已批准需求摘要**：
  - `changes/<change>/` 是活动状态、规划和执行 guard 的唯一事实源。
  - 根 `specs/<capability>/spec.md` 是发布基线；同步将 ADDED、MODIFIED、REMOVED、RENAMED 操作应用为其 `## Requirements` 内容，绝不写入 delta 标头。
  - 成功同步为活动 change 保存含源 delta、受影响能力和合并前/后基线哈希的发布回执。
  - 含 delta spec 的 change 进入 closing 前必须验证回执；源或基线变更、缺失回执或仅有旧布尔值均阻止关闭。
- **关键场景**：新增与修改需求保留其他基线需求；删除与重命名准确作用于目标 requirement；同步后任一侧手工编辑使回执失效；基线不存在时创建规范的完整基线。
- **验收检查**：同步测试覆盖四种 delta 操作及无 delta 标头；guard 测试覆盖有效、缺失和过期回执；全量 `npm test` 通过。

## Design Constraints

- **架构约束**：以一个可复用的 publication/context 模块集中路径解析、delta 应用、规范化、哈希和回执验证，避免 `cmd-sync` 与 guard 复制规则。
- **接口约束**：保留 `ssf sync <change-dir>` 命令形状；同步输出可说明发布的能力与回执状态；旧 `spec_merged` 仅作兼容记录，不能作为 closing 证据。
- **依赖约束**：继续使用零运行时依赖、现有 `dist` 导出的 Markdown 解析器及 Node 内置 `crypto`/`fs`。
- **数据约束**：回执须稳定编码于 `.spec-superflow.yaml`，包含版本、change delta 哈希、合并前与合并后基线哈希及能力路径；哈希输入按路径排序。

## Execution Waves

### Wave 1

- **Wave ID**：`delta-publication`
- **任务**：为四种 delta 操作先补失败测试；实现集中 publication 模块及 `cmd-sync` 的基线应用和回执写入。
- **依赖 wave**：无
- **策略**：`serial`
- **目标**：发布后根基线为可读的 canonical spec，而非 delta 文件副本。
- **输入**：`cmd-sync`、`spec-paths`、`dist` 中的 delta/requirements 解析器。
- **输出**：publication seam、更新的同步命令和同步回归测试。
- **完成标准**：四种操作、遗留 delta 标头规范化与确定性回执均由测试证明；根基线没有 `ADDED`/`MODIFIED` 等 delta 标头。
- **Review gate**：Wave 1 的 review receipt 必须为 `pass`。

### Wave 2

- **Wave ID**：`receipt-gated-closing`
- **任务**：先补 closing guard 的失败测试；持久化并重算回执；更新 guard、技能与文档。
- **依赖 wave**：`delta-publication`
- **策略**：`serial`
- **目标**：closure 只接受当前活动 change 对应且未过期的发布基线。
- **输入**：Wave 1 的 publication seam 和 `.spec-superflow.yaml` 状态。
- **输出**：receipt-aware guard、状态字段、文档和 guard 回归测试。
- **完成标准**：有效回执通过，缺失/旧布尔值/源变更/基线变更均被拒绝；完整测试套件通过。
- **Review gate**：Wave 2 的 review receipt 必须为 `pass`。

## Test Obligations

- **必须先从失败测试开始的行为**：四种 delta operation 的 canonical 基线应用；回执有效性和 closing 拒绝路径。
- **必需的边界情况**：缺少基线、遗留基线含 delta 标头、未知或重复 requirement、同步后 source/baseline 变动、相对 change 路径。
- **回归敏感区域**：跨 change delta 冲突检测、无 delta change 的关闭、CLI JSON/文本输出、状态 YAML 读写兼容性。

## Execution Mode

- **可用方式与推荐**：在合同批准后运行 `ssf execution recommend`，持久化当前 artifact 与 wave 相符的 recommendation receipt。
- **用户确认的模式**：待 DP3 批准后确定。
- **推荐理由 / 项目事实**：两波存在严格数据依赖，预计以 `batch-inline` 串行执行最小且可审计；若 recommend 结果不同，使用工具推荐值。
- **非推荐选择的风险确认**：若适用，使用 `--acknowledge-recommendation`。
- **计划 revision / artifact hash**：待合同批准后由 `ssf execution plan` 写入。

## Verification Dimensions

| 维度 | 状态 | 发现 |
|------|------|------|
| Completeness | Pending | 四种 delta 操作、回执与 closing 均有明确需求和任务。 |
| Correctness | Pending | 需由 red-green 测试及全套测试验证。 |
| Coherence | Pending | 活动 change 与发布基线职责分离，回执建立单向、可验证关系。 |

**总体结论**：待用户批准执行合同。

## Review Gates

- **强制审查点**：每个 wave 完成后记录 `ssf execution review` 的 `pass` receipt。
- **阻塞类别**：delta 应用存在歧义、回执无法重算、测试失败、review receipt 为 `fail` 或过期。
- **收口条件**：两波均有当前 `pass` review receipt，且全量测试通过。

## Escalation Rules

- **何时回退到 `specifying`**：用户要求根 `specs/` 参与活动状态输入，或调整发布基线的语义。
- **何时回退到 `bridging`**：回执字段或同步接口必须改变到与本合同不一致。
- **何时不得继续实现**：合同未获批准、delta 无法安全应用、或任一 required test/review gate 失败。
