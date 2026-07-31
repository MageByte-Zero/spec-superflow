# spec-publication

## Requirements

### Requirement: 新主规格具有有效 Purpose

当 `ssf sync` 为某能力创建主规格时，系统 MUST 从 delta spec 的顶层 `## Purpose` 区段复制非空 Purpose；若该区段不存在或为空，系统 MUST 写入确定性的非空默认 Purpose，并在同步结果中报告该回退。

#### Scenario: 复制已声明的 Purpose

- **WHEN** delta spec 在围栏外包含非空 `## Purpose`，且目标主规格不存在
- **THEN** 新主规格包含该 Purpose 的内容和 `## Requirements` 区段
- **AND** 新主规格通过主规格内容校验

#### Scenario: 使用确定性默认 Purpose

- **WHEN** delta spec 未声明有效 Purpose，且目标主规格不存在
- **THEN** 新主规格包含能力名对应的非空默认 Purpose
- **AND** 同步结果标明使用了默认 Purpose

### Requirement: 已同步 delta 可安全重跑

系统 MUST 将已反映在主规格中的 ADDED、MODIFIED、REMOVED 与 RENAMED 操作识别为 no-op，不改写目标文件，并在结构化结果中区分实际应用与跳过的操作。

#### Scenario: 重跑等价的 ADDED delta

- **WHEN** 主规格已含有与 ADDED delta 等价的需求块
- **THEN** 同步成功且不写入主规格文件
- **AND** 结果将该 ADDED 操作标记为跳过

#### Scenario: 重跑已完成的 RENAMED delta

- **WHEN** 旧需求不存在而新需求已存在，并且该状态与 RENAMED delta 一致
- **THEN** 同步成功且不写入主规格文件
- **AND** 结果将该 RENAMED 操作标记为跳过

### Requirement: 同步拒绝近似名称误匹配

系统 MUST 在操作目标缺失但存在仅大小写或内部空白不同的需求名时拒绝同步，而不是将其视为 idempotent no-op。

#### Scenario: REMOVED 需求名存在近似匹配

- **WHEN** REMOVED delta 的需求名在主规格中不存在，但存在折叠大小写和空白后相同的需求名
- **THEN** 同步失败并指出 delta 名称与近似匹配名称
- **AND** 不写入任何主规格文件

### Requirement: 发布后验证主规格

系统 MUST 在原子提交前验证每个候选主规格；任一候选主规格不符合主规格校验规则时，系统 MUST 终止整个同步且不发布部分结果。

#### Scenario: 候选主规格缺少必需区段

- **WHEN** delta 应用后产生缺少 Purpose 或 Requirements 的候选主规格
- **THEN** 同步失败并报告能力路径和校验原因
- **AND** 任何目标主规格均不发生变化
