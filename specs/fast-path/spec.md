## ADDED Requirements

### Requirement: Workflow mode detection — hotfix

`.spec-superflow.yaml` 的 `workflow` 字段 SHALL 支持 `hotfix` 值。当 workflow 为 `hotfix` 时，guard.mjs 转换矩阵 SHALL 跳过以下检查维度：
- `exploring → specifying`: 跳过（允许直接进入 bridging）
- `specifying → bridging`: 跳过 `schema-valid` 检查（仅保留 `artifacts-exist`）

#### Scenario: hotfix mode skips specifying validation

- **WHEN** guard.mjs check 被调用，workflow 为 `hotfix`，转换为 `specifying → bridging`
- **THEN** `schema-valid` 检查维度 SHALL 被跳过，仅执行 `artifacts-exist` 检查

#### Scenario: hotfix mode allows direct bridging from exploring

- **WHEN** guard.mjs check 被调用，workflow 为 `hotfix`，转换为 `exploring → bridging`
- **THEN** 转换 SHALL 被允许，仅需 `artifacts-exist` 检查通过

### Requirement: Workflow mode detection — tweak

`.spec-superflow.yaml` 的 `workflow` 字段 SHALL 支持 `tweak` 值。当 workflow 为 `tweak` 时，guard.mjs 转换矩阵 SHALL 跳过以下检查维度：
- `exploring → specifying`: 跳过
- `specifying → bridging`: 跳过
- `bridging → approved`: 跳过 `contract-fresh` 检查
- `approved → executing`: 跳过 `contract-fresh` 检查

#### Scenario: tweak mode skips bridging and contract checks

- **WHEN** guard.mjs check 被调用，workflow 为 `tweak`，转换为 `bridging → approved`
- **THEN** `contract-fresh` 检查维度 SHALL 被跳过

#### Scenario: tweak mode allows direct execution without contract

- **WHEN** guard.mjs check 被调用，workflow 为 `tweak`，转换为 `approved → executing`
- **THEN** `contract-fresh` 检查维度 SHALL 被跳过，仅需 `artifacts-exist` 通过

### Requirement: Hotfix upgrade condition

workflow-start SHALL 在以下任一条件成立时，将 hotfix 升级为 full：
- 变更涉及 ≥3 个文件
- 变更涉及新模块创建
- 变更涉及 schema 或接口变更

升级 SHALL 记录到 `.spec-superflow.yaml` 的 `workflow` 字段（设为 `full`），并输出升级原因。

#### Scenario: hotfix upgraded to full when touching 3+ files

- **WHEN** workflow 为 `hotfix`，用户描述的变更涉及 3 个或以上文件
- **THEN** workflow-start SHALL 将 workflow 设为 `full` 并输出升级原因

#### Scenario: hotfix stays hotfix for single-file bug fix

- **WHEN** workflow 为 `hotfix`，用户描述的变更仅涉及 1-2 个文件且无新模块
- **THEN** workflow-start SHALL 保持 `hotfix` 模式

### Requirement: Tweak upgrade condition

workflow-start SHALL 在以下任一条件成立时，将 tweak 升级为 full：
- 变更涉及 ≥5 个文件
- 变更跨模块（修改多个 skill 或 engine 子系统）

升级 SHALL 记录到 `.spec-superflow.yaml` 的 `workflow` 字段（设为 `full`），并输出升级原因。

#### Scenario: tweak upgraded to full when touching 5+ files

- **WHEN** workflow 为 `tweak`，用户描述的变更涉及 5 个或以上文件
- **THEN** workflow-start SHALL 将 workflow 设为 `full` 并输出升级原因

#### Scenario: tweak stays tweak for config-only change

- **WHEN** workflow 为 `tweak`，用户描述的变更仅涉及配置文件修改
- **THEN** workflow-start SHALL 保持 `tweak` 模式

### Requirement: Hotfix minimal contract-builder

contract-builder SHALL 在 hotfix 模式下生成最小契约，仅包含：
- Intent Lock（变更意图的一句话描述）
- Task List（待完成任务的列表）
- Approval Gate（用户确认提示）

最小契约 SHALL 不包含完整的 Scope Fence、Build Rules 或 Review Gates 部分。

#### Scenario: hotfix generates minimal contract

- **WHEN** contract-builder 在 hotfix 模式下被调用
- **THEN** 生成的 `execution-contract.md` SHALL 仅包含 Intent Lock、Task List 和 Approval Gate 三个部分

### Requirement: Tweak lightweight closure

release-archivist SHALL 在 tweak 模式下执行轻量闭合验证：
- 验证变更文件已保存
- 验证无语法错误（`node --check` 或等价检查）
- 跳过完整的三维验证（5-step three-dimensional verification）

#### Scenario: tweak closure skips full verification

- **WHEN** release-archivist 在 tweak 模式下执行闭合
- **THEN** SHALL 仅验证文件保存和语法正确性，跳过完整的三维验证

#### Scenario: tweak closure still verifies file integrity

- **WHEN** release-archivist 在 tweak 模式下执行闭合
- **THEN** SHALL 验证所有变更文件存在且非空
