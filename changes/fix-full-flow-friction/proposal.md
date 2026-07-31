# 全流程可靠性修复

## Why

一次真实的 Full 演练表明，隔离后的工作树缺少未提交的规划工件，执行无法依据合同继续；首次审查回执和缺失主规格又会在过晚阶段失败。这些不是业务风险，而是工作流自身增加的等待、重复解释和 token 消耗。

## What Changes

- 让隔离工作树位于仓库旁并带入当前 change 的规划工件。
- 让审查回执在首次写入时初始化证据目录，并明确报告位置。
- 在 `ssf validate` 阶段预检 Delta 对主规格的可应用性。
- 消除 entering `specifying` 的工件顺序矛盾，并在状态迁移时同步哈希。

## Scope

### In Scope

- 隔离、审查回执、验证和状态转换的可靠性与测试。

### Out of Scope

- 新增工作流阶段、修改 Full 的审批语义，或重写既有规格格式。

## Verification

- 新增回归测试；运行 `npm run build && npm test`。
