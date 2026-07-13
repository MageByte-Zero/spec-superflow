# 执行合同

## Intent Lock

- **变更名称**：
- **要解决的问题**：
- **范围内**：
- **范围外**：

## Approved Behavior

- **已批准需求摘要**：
- **关键场景**：
- **验收检查**：

## Design Constraints

- **架构约束**：
- **接口约束**：
- **依赖约束**：
- **数据约束**：

## Execution Plan

full/hotfix 默认使用 SDD。`inline` 或 `batch-inline` 只能由用户明确的
explicit override 选择；Batch Inline 是串行模式，不得描述为自动默认或并行。批准后，
`ssf execution plan` 会把当前执行计划保存到
`<change>/.superpowers/sdd/execution-plan.json`；该 JSON 是计划的持久化控制面，
不是本 execution contract 的一部分。

## Execution Waves

每个 wave 必须有唯一 ID；只有依赖 wave 的 review receipt 为 `pass` 后，后续
wave 才可以开始。`parallel` 只表示允许在宿主支持并发派发时同时执行；不支持并发时
必须明确报告该能力不可用，而不能把 `parallel` 计划悄然改写成串行执行。

### Wave 1

- **Wave ID**：
- **任务**：
- **依赖 wave**：无
- **策略**：`parallel` | `serial`
- **目标**：
- **输入**：
- **输出**：
- **完成标准**：
- **Review gate**：review report 路径、base/head SHA、review receipt（`pass` | `fail`）

### Wave 2

- **Wave ID**：
- **任务**：
- **依赖 wave**：
- **策略**：`parallel` | `serial`
- **目标**：
- **输入**：
- **输出**：
- **完成标准**：
- **Review gate**：review report 路径、base/head SHA、review receipt（`pass` | `fail`）

## Test Obligations

- **必须先从失败测试开始的行为**：
- **必需的边界情况**：
- **回归敏感区域**：

## Execution Mode

- **模式**：`sdd`（full/hotfix default） | `inline` | `batch-inline`
- **选择理由**：
- **用户 explicit override（仅 inline/batch-inline）**：
- **执行计划命令**：`ssf execution plan <change-dir> --mode <mode> --reason <text> --wave <id>:<parallel|serial>:<task,...>[:<depends-on,...>]`
- **允许的修订**：将已有计划保留/升级为 `sdd`，生成新 revision 并清除旧 receipt；不允许降级：`ssf execution revise <change-dir> --mode sdd --reason <text> --wave <id>:<parallel|serial>:<task,...>[:<depends-on,...>]`
- **计划 revision / artifact hash**：

## Verification Dimensions

| 维度 | 状态 | 发现 |
|------|------|------|
| Completeness | Pending | — |
| Correctness | Pending | — |
| Coherence | Pending | — |

**总体结论**：Pending

## Review Gates

- **强制审查点**：每个 Execution Wave 完成后记录 `ssf execution review` 的 review receipt
- **阻塞类别**：依赖未通过、review receipt 为 `fail`、缺失或过期
- **收口条件**：所有当前 wave 都有 `pass` review receipt

## Escalation Rules

- **何时回退到 `specifying`**：
- **何时回退到 `bridging`**：
- **何时不得继续实现**：
