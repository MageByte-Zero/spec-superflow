## ADDED Requirements

### Requirement: Seven standard decision points

`docs/decision-points.md` SHALL 定义 7 个标准决策点，每个决策点包含：编号、名称、触发条件、所需输入、预期输出、关联 skill。

7 个决策点为：
1. DP-1 需求确认 — need-explorer 完成前，用户确认 scope 和 capabilities
2. DP-2 工件审查 — spec-writer 完成后，用户审查 proposal/specs/design/tasks
3. DP-3 契约批准 — contract-builder 完成后，用户明确批准 execution-contract.md（硬门禁）
4. DP-4 执行模式选择 — build-executor 启动前，用户选择 TDD 或 SDD 模式
5. DP-5 调试升级 — bug-investigator 3+ 修复失败后，用户决定继续或放弃
6. DP-6 验证失败 — release-archivist 验证未通过时，用户决定修复或放弃
7. DP-7 归档确认 — release-archivist 完成前，用户确认归档和 delta spec 合并

#### Scenario: decision-points.md contains all 7 decision points

- **WHEN** 读取 `docs/decision-points.md`
- **THEN** 文件 SHALL 包含 DP-1 到 DP-7 共 7 个决策点的完整定义

#### Scenario: each decision point has required fields

- **WHEN** 读取任一决策点定义
- **THEN** 该决策点 SHALL 包含编号、名称、触发条件、所需输入、预期输出、关联 skill 六个字段

### Requirement: Decision point reference in workflow-start

workflow-start SKILL.md SHALL 在路由规则中引用对应的决策点编号。当路由到需要用户确认的 skill 时，输出 SHALL 包含决策点编号和简要说明。

#### Scenario: orchestrator references DP-3 before contract-builder

- **WHEN** workflow-start 路由到 contract-builder
- **THEN** 输出 SHALL 包含 `DP-3: 契约批准 — 用户需明确批准 execution-contract.md`

#### Scenario: orchestrator references DP-4 before build-executor

- **WHEN** workflow-start 路由到 build-executor
- **THEN** 输出 SHALL 包含 `DP-4: 执行模式选择 — 用户选择 TDD 或 SDD`

### Requirement: Decision point reference in skills

以下 skill SHALL 在对应决策点触发时引用决策点编号：
- contract-builder: DP-3（契约批准）
- build-executor: DP-4（执行模式选择）、DP-5（调试升级）
- bug-investigator: DP-5（调试升级）
- release-archivist: DP-6（验证失败）、DP-7（归档确认）

#### Scenario: contract-builder references DP-3

- **WHEN** contract-builder 生成 execution-contract.md 后等待用户批准
- **THEN** 输出 SHALL 包含 `DP-3` 决策点编号

#### Scenario: bug-investigator references DP-5

- **WHEN** bug-investigator 连续 3+ 次修复失败，需要升级决策
- **THEN** 输出 SHALL 包含 `DP-5: 调试升级` 决策点编号

### Requirement: Decision point escalation

当 skill 到达决策点且用户未给出明确选择时，skill SHALL 暂停并等待用户确认，不得自动跳过。这是 v0.5.0 硬门禁的延伸——guard.mjs 在代码层面阻止跳过，决策点协议在交互层面确保用户知情。

#### Scenario: skill pauses at decision point

- **WHEN** skill 到达决策点（如 contract-builder 到达 DP-3）
- **THEN** skill SHALL 输出决策点信息并暂停，等待用户明确输入 `approve` / `reject` / `revise`

#### Scenario: skill does not auto-skip decision point

- **WHEN** 用户在决策点未给出明确选择（如输入了无关内容）
- **THEN** skill SHALL 重新提示决策点信息，不得自动跳过或默认选择

### Requirement: Decision point audit trail

每个决策点的结果 SHALL 记录到 `.spec-superflow.yaml`。记录格式：`dp_<N>_result: approved|rejected|revised`，`dp_<N>_timestamp: <ISO 8601>`。

#### Scenario: DP-3 result recorded to state file

- **WHEN** 用户在 DP-3（契约批准）选择 `approve`
- **THEN** `.spec-superflow.yaml` SHALL 包含 `dp_3_result: approved` 和 `dp_3_timestamp: <ISO 8601>`

#### Scenario: DP-4 result recorded to state file

- **WHEN** 用户在 DP-4（执行模式选择）选择 `sdd`
- **THEN** `.spec-superflow.yaml` SHALL 包含 `dp_4_result: sdd` 和 `dp_4_timestamp: <ISO 8601>`
