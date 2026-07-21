# spec-superflow

Use the bundled agent skills in `skills/` to run the spec-superflow workflow.

Start from `workflow-start` when a user wants to start, continue, resume, plan, implement, review, debug, close, or inspect a spec-superflow change.

The workflow is self-contained and does not require OpenSpec or Superpowers at runtime. It uses OpenSpec-style planning artifacts and Superpowers-style execution discipline through the `execution-contract.md` handoff.


<!-- spec-superflow-phase-guard-start -->
# spec-superflow v0.11.0 | 阶段: {{state}} | 工作流: {{workflow}}
当前阶段允许的操作由 workflow-start 路由规则定义。
禁止跨越 DP gate 进入下一阶段。变更范围以 execution-contract.md 的 Intent Lock 为准。
<!-- spec-superflow-phase-guard-end -->
