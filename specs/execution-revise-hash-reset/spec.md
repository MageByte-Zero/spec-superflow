# execution-revise-hash-reset

## Purpose

The execution-revise-hash-reset capability documents two execution state-machine
fixes that travel inside the CodeBuddy installer PR but are independent of the
install/shim scope: revise-path acknowledgment validation and artifacts-hash
revision cleanup. They are specified here so the state-machine changes carry a
reviewable contract of their own, and can be reviewed separately from the
installer concern.

## Requirements

### Requirement: revise 路径不强制重新 acknowledge 推荐模式

`ssf execution revise` SHALL NOT require `--acknowledge-recommendation` when the
revised mode differs from the recommendation, and the `--acknowledge-recommendation`
conflict check SHALL apply only to the initial plan path (non-revise). Revise is
an explicit, guarded upgrade of an existing plan — the informed-choice
acknowledgment was already recorded when the plan was first created, so
re-validating it on every revision is redundant and contradicts the revise flow.

#### Scenario: revise 时选择非推荐模式不再要求 acknowledge

- **WHEN** 用户对已有执行计划执行 `ssf execution revise` 且修订后的模式不同于推荐
- **THEN** 命令 SHALL NOT 因缺少 `--acknowledge-recommendation` 报错，正常生成新 revision

#### Scenario: 首次创建计划仍强制 acknowledge

- **WHEN** 用户首次创建执行计划、选择的模式不同于推荐，且未带 `--acknowledge-recommendation`
- **THEN** 命令 SHALL 报错并提示使用 `--acknowledge-recommendation` 记录知情选择

### Requirement: artifacts hash 变化时清空 revision

当工件（proposal / specs）内容变化导致 `artifacts_hash` 与已保存状态不一致时，
state-loader 的 `rebuildState` SHALL 同时清空 `revision`、`execution_plan_hash`
与 `execution_plan_revision` 三个字段。任何依赖旧 hash 的计划字段都不允许在
工件变更后残留，否则后续校验会基于过期的计划元数据做出错误判定。

#### Scenario: artifacts_hash 变化后 revision 被清空

- **WHEN** `rebuildState` 检测到 `artifacts_hash` 与已保存状态不一致
- **THEN** 返回的状态中 `revision`、`execution_plan_hash`、`execution_plan_revision` 均为 null

#### Scenario: artifacts_hash 未变化时计划字段保留

- **WHEN** `rebuildState` 检测到 `artifacts_hash` 与已保存状态一致
- **THEN** `revision` 与既有计划字段保持不变
