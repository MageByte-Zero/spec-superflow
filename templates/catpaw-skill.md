---
name: spec-superflow
description: 在用户明确要求使用 spec-superflow，或继续已有 spec-superflow 变更时，执行规划、实现、审查和验证流程。
---

# Spec Superflow

本技能包包含同版本 CLI 与九个流程技能，需要 Node.js 20+ 和 Git。
将本文件所在的绝对目录作为 `<plugin-root>`。在项目工作目录运行命令，
使用 `node "<plugin-root>/scripts/spec-superflow.mjs"` 替换文档中的 `SSF`。
不要调用 PATH 中其他版本的 `ssf`。

先读取 [workflow-start](skills/workflow-start/SKILL.md)，按其指引开始或恢复变更。
后续提到的技能名对应本包的 `skills/<技能名>/SKILL.md`，按当前操作读取：

- 范围不明确：`need-explorer`
- 编写计划：`spec-writer`
- 执行实现：`build-executor`
- 排查失败：`bug-investigator`
- 审查实现：`code-reviewer`
- 合并已有增量规格：`spec-merger`
- 验证与收尾：`release-archivist`
- 仅恢复已有旧版契约：`contract-builder`

包内技能提到其他技能时，读取上述本地文件；无需在妙手中分别安装九个技能。
保留包内的相对目录结构，升级时一起替换整个技能包。
