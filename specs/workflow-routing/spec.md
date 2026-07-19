# 工作流路由能力规格

## MODIFIED Requirements

### Requirement: closing 是成功完成后的终态

系统检测到 change 的当前状态为 `closing` 时 SHALL 将其视为成功完成后的终态，并且不得再次启动任何收尾流程。

#### Scenario: workflow-start 恢复已关闭的 change

- **WHEN** `workflow-start` 读取到 `.spec-superflow.yaml` 中的 `state` 为 `closing`
- **THEN** 系统报告当前状态为 `closing`，说明该 change 已经成功关闭，并明确下一步不需要运行任何 skill

#### Scenario: 终态短路后不再执行活跃流程扫描

- **WHEN** `workflow-start` 已确定当前状态为 `closing`
- **THEN** 系统 MUST 跳过 handoff、checkpoint 和 execution-control 恢复扫描，并且不得路由到 `release-archivist`、`spec-merger`、`build-executor` 或其他工作流 skill

### Requirement: release-archivist 在进入 closing 前完成收尾

系统 SHALL 仅在 change 尚处于 `executing` 且实现与 review 已完成时路由到 `release-archivist`，由它完成进入终态所需的验证和归档门禁。

#### Scenario: executing change 开始收尾

- **WHEN** change 处于 `executing`，所有计划 wave 已实现并通过 review，且用户要求完成收尾
- **THEN** 系统路由到 `release-archivist`，执行新鲜验证、契约完整性检查、决策审计、风险总结和 DP-7 归档确认

#### Scenario: delta spec 在终态转换前完成同步

- **WHEN** `release-archivist` 发现 change 包含尚未同步的 delta spec
- **THEN** 系统 MUST 在执行 `executing → closing` 转换之前路由到 `spec-merger` 并记录同步完成

#### Scenario: 收尾门禁全部通过

- **WHEN** 验证、review receipt、delta spec 同步、决策审计和归档确认全部完成
- **THEN** `release-archivist` 执行 `executing → closing` 转换，并且转换成功后不再保持活跃

### Requirement: 所有工作流表面使用一致的终态语义

规范 skill、正式状态机文档和生成的 phase guard MUST 对 `closing` 使用一致的终态语义，同时保留现有八状态文件格式。

#### Scenario: 生成 closing phase guard

- **WHEN** `ssf inject` 为 `state: closing` 的 change 生成 phase guard
- **THEN** phase guard 将该状态标识为已成功关闭的终态，禁止实现、验证、归档、spec 合并和状态转换，并且不再提示 DP-6 或 DP-7

#### Scenario: 读取既有 closing 状态文件

- **WHEN** 升级后的系统读取升级前已经包含 `state: closing` 的状态文件
- **THEN** 系统继续使用现有八状态格式，将该 change 报告为 `CLOSED`，且无需迁移状态文件

#### Scenario: 拒绝 closing 的所有出边转换

- **WHEN** CLI guard 或 state transition 收到任意以 `closing` 为起点的目标状态
- **THEN** 系统 MUST 拒绝该转换，包括历史遗留的 `closing → specifying`，并且不得修改状态文件
