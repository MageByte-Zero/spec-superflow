## ADDED Requirements

### Requirement: ssf inject command

`scripts/spec-superflow.mjs` SHALL 支持 `inject <change-dir>` 子命令。该命令 SHALL 读取 `<change-dir>/.spec-superflow.yaml` 的 `state` 和 `workflow` 字段，生成 `rules/phase-guard.md` 规则文件，并将其安装到 `.claude/always/` 目录。

#### Scenario: ssf inject generates phase-guard.md

- **WHEN** 用户执行 `ssf inject changes/my-change`
- **THEN** 命令 SHALL 读取状态文件，生成 `rules/phase-guard.md`，内容包含当前变更名、当前阶段、允许操作和禁止操作

#### Scenario: ssf inject installs to .claude/always/

- **WHEN** `ssf inject` 成功生成 `rules/phase-guard.md`
- **THEN** 命令 SHALL 将文件复制/链接到 `.claude/always/phase-guard.md`，使其每轮注入到 Agent 上下文

#### Scenario: ssf inject reports success with state summary

- **WHEN** `ssf inject` 完成
- **THEN** 命令 SHALL 输出当前状态摘要（change_name, state, workflow）和安装路径

### Requirement: Phase-guard.md content structure

`rules/phase-guard.md` SHALL 包含以下结构：
- 变更名（从 `change_name` 字段读取）
- 当前阶段（从 `state` 字段读取）
- 工作流模式（从 `workflow` 字段读取）
- 允许的操作列表（根据当前阶段动态生成）
- 禁止的操作列表（根据当前阶段动态生成）
- 决策点提示（如果当前阶段包含决策点）

#### Scenario: phase-guard.md lists allowed operations for specifying

- **WHEN** 当前阶段为 `specifying`
- **THEN** phase-guard.md SHALL 列出允许操作：创建/修改 proposal.md, specs/, design.md, tasks.md；禁止操作：修改 execution-contract.md, 执行实现代码

#### Scenario: phase-guard.md lists allowed operations for executing

- **WHEN** 当前阶段为 `executing`
- **THEN** phase-guard.md SHALL 列出允许操作：按 execution-contract.md 执行任务, 运行测试, 提交代码；禁止操作：修改 proposal.md, specs/, design.md（需先回退到 specifying）

#### Scenario: phase-guard.md includes decision point hint

- **WHEN** 当前阶段包含决策点（如 bridging 包含"契约批准"决策点）
- **THEN** phase-guard.md SHALL 包含决策点提示，引用 docs/decision-points.md 中对应的决策点编号

### Requirement: Phase-guard.md regeneration behavior

`ssf inject` SHALL 在每次执行时覆盖已有的 `rules/phase-guard.md`。workflow-start SHALL 在每次状态转换后提示用户运行 `ssf inject` 重新生成。

#### Scenario: inject overwrites existing phase-guard.md

- **WHEN** `rules/phase-guard.md` 已存在，用户再次执行 `ssf inject`
- **THEN** 命令 SHALL 覆盖已有文件，内容更新为当前状态

#### Scenario: workflow-start prompts for re-injection

- **WHEN** workflow-start 检测到状态转换（通过 `ssf state transition` 确认）
- **THEN** workflow-start SHALL 在路由输出中提示用户运行 `ssf inject` 更新阶段防漂移规则

### Requirement: Graceful fallback when state file missing

当 `<change-dir>/.spec-superflow.yaml` 不存在时，`ssf inject` SHALL 生成默认的 phase-guard.md，状态为 `exploring`，workflow 为 `full`。

#### Scenario: inject works without state file

- **WHEN** `<change-dir>/.spec-superflow.yaml` 不存在，用户执行 `ssf inject <change-dir>`
- **THEN** 命令 SHALL 使用默认值（state=exploring, workflow=full）生成 phase-guard.md，并输出警告提示状态文件缺失
