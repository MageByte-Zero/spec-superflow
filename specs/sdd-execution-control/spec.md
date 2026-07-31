# sdd-execution-control

## Requirements

### Requirement: SDD 工作记录按执行计划隔离

系统 MUST 将一个 execution plan 的进度账本、任务简报、review package、检查点、handoff 和修复记录存放在由 plan hash 与 revision 唯一确定的目录中；不同计划不得读取彼此的当前工作记录。

#### Scenario: 同一 change 生成新计划修订

- **WHEN** execution plan 被修订并获得新的 hash 或 revision
- **THEN** 新计划使用独立的 SDD 工作目录
- **AND** 旧计划的进度或失败 receipt 不会使新计划的 wave 成为已完成或可重试

#### Scenario: 恢复当前计划

- **WHEN** 控制器恢复一个有当前 execution plan 的 change
- **THEN** 只读取该计划身份对应的进度与检查点
- **AND** 报告所使用的计划身份

### Requirement: 旧扁平 SDD 记录可安全迁移

系统 MUST 在首次访问旧的扁平 SDD 记录时迁移或以只读兼容方式归属到当前计划；无法安全归属的记录 MUST 标记为历史记录，而不得作为当前完成或审查证据。

#### Scenario: 存在可归属的旧记录

- **WHEN** 旧扁平记录与当前 execution plan 的 hash 和 revision 一致
- **THEN** 系统在计划作用域下继续使用该记录
- **AND** 不丢失记录内容

#### Scenario: 存在不可归属的旧记录

- **WHEN** 旧扁平记录缺少计划身份或与当前计划不一致
- **THEN** 系统将其报告为历史记录
- **AND** 当前 wave 不使用该记录作为完成或通过证据

### Requirement: 审查修复具有聚焦 re-review 与轮次上限

系统 MUST 为失败 review 记录修复轮次、原始发现、修复范围和 re-review 结论；每轮 re-review MUST 只验证已报告的发现及修复 diff，并且单个 wave 最多允许五轮未通过的修复/re-review 循环。

#### Scenario: re-review 仅检查修复范围

- **WHEN** 一个 wave 的失败 review 已产生修复提交
- **THEN** re-review 输入包含原始发现、修复前后提交范围和修复 diff
- **AND** reviewer 将每项原始发现标记为已解决或未解决

#### Scenario: 第五轮后仍有未解决发现

- **WHEN** 同一 wave 的第五轮 re-review 仍存在未解决的 Critical 或 Important 发现
- **THEN** wave 被阻止继续自动修复
- **AND** 系统要求控制器进行明确裁决或进入调试升级

### Requirement: 已完成计划清理可丢弃工作文件

系统 MUST 在所有 wave 均有当前 pass receipt 后清理该计划的可再生简报、diff 包和进度账本；当前 review receipt、execution plan 和审计所需证据 MUST 被保留。

#### Scenario: 最终 review 全部通过

- **WHEN** execution plan 的每个 wave 都有当前 pass receipt
- **THEN** 系统删除该计划作用域下可再生的工作文件
- **AND** closing guard 仍可读取通过 receipt

### Requirement: First review evidence initialization

The system SHALL create the physical review evidence overlay before validating or recording a first wave review report.

#### Scenario: First review receipt

- **WHEN** a planned wave records its first review
- **THEN** a report stored in the review overlay can be recorded without a manual directory creation step
