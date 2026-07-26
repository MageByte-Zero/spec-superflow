# Decision Points Protocol

本文档集中定义了 spec-superflow 工作流中所有需要用户明确确认的决策点。每个决策点（Decision Point）都是工作流中的关键门禁，确保用户在自动化流程中始终保持最终决策权。工作流中的 skill 在到达决策点时必须暂停执行、向用户呈现所需信息，并等待明确指令后方可继续。

## DP-0: 设计前确认（User Confirmation Gate）

- **编号**：DP-0
- **名称**：设计前确认
- **触发条件**：Full 或 legacy change 在 planning 前触发；Quick、direct Hotfix、Tweak 不等待 DP-0，先记录可验证 recommendation/direct receipt 后执行。
- **所需输入**：变更名称与意图、已知约束（命名风格、兼容性、受影响平台）、是否包含相关优化、用户沟通偏好；以及最少路径事实（任务数、文件数、是否仅配置/文档、是否涉及 schema/API、新模块和不确定性）
- **路径选择协议**：低风险 Quick 与 incident Hotfix 同轮展示 recommendation 后可运行 `ssf workflow accept --source direct-request`；其余路径使用 `show`、补齐 missing facts、`recommend` 和 `select --confirm`。direct receipt 代替短路径 DP。
- **短路径收口**：Quick、direct Hotfix、Tweak 以边界内验证摘要和 `test_result: pass` 收口，不写 DP-6 或 DP-7。
- **确认顺序**：可先解析 `artifact_language`，随后必须完成路径 receipt 读取、最少事实补全、建议展示和用户选择；路径摘要与其他 DP-0 决定合并确认后，才可设置 `dp_0_confirmed=true`。
- **预期输出**：完整、防篡改的路径选择 receipt 固定保存在 change overlay 的 `.superpowers/sdd/workflow-selection.json`，用于恢复和审计；`.spec-superflow.yaml` 的 `dp_0_*` 只保存确认结果与幂等的 `workflow_path`/推荐对齐摘要，并保留既有 `scope` 和 `artifact_language`。空目录的 legacy artifact inference 可以返回 `full` 以兼容旧 API，但绝不能替代入口的用户选择。
- **关联 skill**：`spec-superflow:workflow-start`

## DP-1: 需求确认

- **编号**：DP-1
- **名称**：需求确认
- **触发条件**：need-explorer 完成需求澄清与范围界定之前，用户需要确认最终的 scope 和 capabilities
- **所需输入**：need-explorer 整理的需求摘要、变更范围（scope）、能力清单（capabilities）、约束条件与成功标准
- **预期输出**：用户明确确认需求范围和关键能力，或提出修改意见供 need-explorer 迭代
- **关联 skill**：`spec-superflow:need-explorer`

## DP-2: 工件审查

- **编号**：DP-2
- **名称**：工件审查
- **触发条件**：spec-writer 完成全部规划工件的创建或更新后，用户需要审查产出的完整性和质量
- **所需输入**：spec-writer 产出的 `proposal.md`、`specs/` 目录下的规格文档、`design.md` 设计文档、`tasks.md` 任务清单
- **预期输出**：用户审查通过并批准全部工件，或指出需要修改的具体内容和方向
- **关联 skill**：`spec-superflow:spec-writer`

## DP-3: 契约批准

- **编号**：DP-3
- **名称**：契约批准
- **触发条件**：仅 Full 或 legacy Hotfix 的 contract-builder 生成契约后触发；Quick/direct Hotfix/Tweak 不适用。
- **所需输入**：`execution-contract.md` 全文，包含执行批次、任务依赖、验收标准、回滚策略
- **预期输出**：用户明确批准（approve）执行契约，或提出修改要求；未获批准前 build-executor 不得启动
- **关联 skill**：`spec-superflow:contract-builder`

## DP-4: 执行模式选择

- **编号**：DP-4
- **名称**：执行模式选择
- **触发条件**：仅 Full 或 legacy Hotfix 在 build-executor 启动前选择执行模式；Quick/direct Hotfix/Tweak 不适用。
- **所需输入**：已批准的 `execution-contract.md`、项目测试基础设施现状，以及 `ssf execution recommend` 提供的执行模式证据与建议
- **预期输出**：用户明确选择 `Inline`、`Batch Inline` 或 `SDD` 执行模式，build-executor 据此创建受确认的执行计划。DP-4 不重新选择 DP-0 已确认的 `full`、`hotfix` 或 `tweak` 路径。
- **关联 skill**：`spec-superflow:build-executor`

## DP-5: 调试升级

- **编号**：DP-5
- **名称**：调试升级
- **触发条件**：bug-investigator 连续 3 次或更多修复尝试失败后，无法自动解决当前问题
- **所需输入**：失败日志、每次修复尝试的具体方案与结果、错误根因分析、剩余可行方案（如有）
- **预期输出**：用户决定继续调试（可附带方向指引）或放弃当前任务并标记为阻塞
- **关联 skill**：`spec-superflow:bug-investigator`

## DP-6: 验证失败

- **编号**：DP-6
- **名称**：验证失败
- **触发条件**：release-archivist 在执行收尾验证时发现验证项未通过
- **所需输入**：验证报告（包含通过项与失败项）、失败项的具体差异说明、原始规格要求与实际实现的对比
- **预期输出**：用户决定返回修复失败项（重新进入执行阶段）或放弃验证直接关闭变更
- **关联 skill**：`spec-superflow:release-archivist`

## DP-7: 归档确认

- **编号**：DP-7
- **名称**：归档确认
- **触发条件**：release-archivist 完成归档准备和 delta spec 合并方案后，用户确认最终归档操作
- **所需输入**：变更总结报告、delta spec 合并方案（哪些增量规格将合并到主规格基线）、归档文件清单
- **预期输出**：用户确认归档并批准 delta spec 合并，或要求调整合并范围后再执行
- **关联 skill**：`spec-superflow:release-archivist`

## 决策点与 Skill 映射总览

| 编号 | 名称 | 关联 Skill | 阶段 |
|------|------|------------|------|
| DP-0 | 设计前确认 | `spec-superflow:workflow-start` | 入口 |
| DP-1 | 需求确认 | `spec-superflow:need-explorer` | 探索 |
| DP-2 | 工件审查 | `spec-superflow:spec-writer` | 规划 |
| DP-3 | 契约批准 | `spec-superflow:contract-builder` | 桥接 |
| DP-4 | 执行模式选择 | `spec-superflow:build-executor` | 执行 |
| DP-5 | 调试升级 | `spec-superflow:bug-investigator` | 执行 |
| DP-6 | 验证失败 | `spec-superflow:release-archivist` | 收尾 |
| DP-7 | 归档确认 | `spec-superflow:release-archivist` | 收尾 |
