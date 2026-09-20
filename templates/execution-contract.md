# 执行合同

## Intent Lock

- **问题与范围**：引用 proposal.md 的已批准范围，保留一句摘要。
- **范围外**：

## Approved Behavior

| 需求 / 场景引用 | 任务 ID | 验证证据 |
|---|---|---|
| | | |

不复制 specs 全文；没有行为变化时注明 specs 省略的理由。

## Design Constraints

引用 design.md 中适用的决策与约束；省略 design 时写明必要约束。

## Execution Plan

推荐凭据（recommendation receipt）绑定当前产物；计划保存在 `.superpowers/sdd/execution-plan.json`。审查证据为 review receipt。

### Execution Waves

任务与依赖以 tasks.md 为准，不再抄写每个任务。列出确有必要的集成边界。

- **执行方式**：默认 Native（持久化为 `inline`）；`batch-inline` 兼容串行；SDD 仅用于有明确收益的独立委派。
- **审查策略**：Native 默认 `final`，SDD 默认 `wave`；旧计划无策略字段仍按 wave。任务数量不触发 SDD。
- **边界与理由**：

确认已有用户选择后运行 `ssf execution recommend <dir> --wave <id>:serial:<tasks>`，再通过 `ssf execution plan <dir> --mode <mode> --review-policy <final|wave> --confirm --reason <text> --wave <id>:serial:<tasks>` 记录。非推荐选择加 `--acknowledge-recommendation`。已有选择不重复询问。

## Test Obligations

- **行为回归与边界**：
- **任务级验证**：仅受影响测试。
- **集成 / 最终验证**：必要命令，结果绑定代码与环境；不按任务重复全量测试。

## Review Gates

- **final**：完成后一次独立审查，`ssf execution review --wave final` 绑定实际 Git range。
- **wave**：每个 wave 一次审查，依赖以通过回执为门禁。
- Critical/Important：失败回执 → 修复 → 聚焦复审 → 通过。不可用任务勾选替代审查。

## Escalation Rules

- 范围变化：回到 specifying；契约偏移：回到 bridging。
- 非语义修正：resync，保留失败链和历史；语义变更：重新批准后 revise，允许保留或切换执行模式。
- 三次未解决失败：人工裁决，不自动清空失败次数。

## Approval

DP-3 批准记录与限定条件：
