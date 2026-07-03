# spec-superflow

Use the bundled agent skills in `skills/` to run the spec-superflow workflow.

Start from `workflow-start` when a user wants to start, continue, resume, plan, implement, review, debug, close, or inspect a spec-superflow change.

The workflow is self-contained and does not require OpenSpec or Superpowers at runtime. It uses OpenSpec-style planning artifacts and Superpowers-style execution discipline through the `execution-contract.md` handoff.


<!-- spec-superflow-phase-guard-start -->
# Phase Guard

**当前阶段**: exploring | **工作流**: auto | **版本**: v0.8.6

## ✅ 允许操作
- 澄清需求、比较方案
- 与用户讨论 scope 和 capabilities

## ⛔ 禁止操作
- 创建规划工件（proposal.md, specs/, design.md, tasks.md）
- 执行实现代码
- 修改 execution-contract.md

## 🔔 决策点
- DP-1: 需求确认 — 进入 specifying 前需用户确认 scope
<!-- spec-superflow-phase-guard-end -->
