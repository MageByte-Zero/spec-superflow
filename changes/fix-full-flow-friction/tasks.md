# 实现任务

## 交付与证明

| 批次 | 交付结果 | 证明 |
|---|---|---|
| 1 | 隔离与审查回执无需人工恢复 | 专项测试 |
| 2 | Delta 与状态错误在前置阶段发现 | 专项测试 |
| 3 | 默认回归不会被宿主并发放大 | 入口测试与全量回归 |

## Tasks

- [x] **1.1 修复 worktree 隔离**：计算仓库级路径并复制当前 change；证明：`node --test tests/lib/ensure-branch.test.mjs`。
- [x] **1.2 初始化审查证据目录**：写回执前创建 overlay，并更新报告路径说明；证明：`node --test tests/lib/execution-plan.test.mjs`。
- [x] **2.1 前置 Delta 基线检查**：`ssf validate` 检测不可应用的修改；证明：`node --test tests/lib/cmd-validate-paths.test.mjs`。
- [x] **2.2 修复状态进入与哈希同步**：允许正确的 specifying 入口并持久化当前哈希；证明：`node --test tests/lib/cmd-state.test.mjs`。
- [x] **2.3 修正冲突的入口测试**：将无产物拒绝断言移动到 `specifying → bridging`；证明：`node --test tests/lib/guard.test.mjs`。
- [x] **3.1 限制默认测试文件并发**：在 `package.json` 保持完整测试集合且固定 Node 文件级并发为 2；证明：`node --test tests/lib/node20-test-entry.test.mjs` 与重型集成批次。
- [x] **3.2 跑全量回归**：构建并运行全部测试；证明：`npm run build && npm test`（630/630 通过）。
