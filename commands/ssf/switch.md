---

description: 切换当前对话关注的 spec-superflow change
argument-hint: "<change-name-or-path>"
allowed-tools: Bash(npx:*)
---

`$ARGUMENTS` 必须提供一个非空的 change 名称或路径；若未提供，先询问用户选择哪个 change。

确认目标非空后运行 `npx --yes --package spec-superflow@0.10.0 ssf switch --json "$ARGUMENTS"`，将整个目标作为单一字面参数。只使用返回的恢复上下文切换当前对话的关注对象。存在 blocker 时停止并展示修复命令；不得改变文件、工作目录或任何隐藏指针。
