---

description: 恢复一个 spec-superflow change，并按现有状态机继续
argument-hint: "[change-name-or-path]"
allowed-tools: Bash(npx:*)
---

先检查 `$ARGUMENTS` 是否为非空目标：为空时运行 `npx --yes --package spec-superflow@0.10.0 ssf resume --json`，让 CLI 按唯一活跃 change 的既有确定性规则选择；非空时运行 `npx --yes --package spec-superflow@0.10.0 ssf resume --json "$ARGUMENTS"`，将整个目标作为单一字面参数。

只使用返回的 `change`、`blockers` 和 `next_action`：存在 blocker 时停止并展示修复命令；否则通过 `workflow-start` 进入 `next_action` 指定的下一 skill。不要直接修改状态文件。
