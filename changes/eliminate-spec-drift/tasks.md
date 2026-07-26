# 实现任务

## 文件结构

- `Modify: scripts/lib/cmd-sync.mjs` — 解析并应用 delta、写入回执。
- `Modify: scripts/lib/state-loader.mjs` — 持久化发布回执。
- `Modify: scripts/guard/checks/specs-merged.mjs` — 验证回执而非布尔值。
- `Modify: tests/lib/cmd-sync-paths.test.mjs` — 覆盖基线应用与回执。
- `Modify: tests/lib/guard-specs-merged.test.mjs` — 覆盖过期回执拒绝。

## 接口

### Batch 1 → Batch 2

- **Produces**: publication receipt `{ sourceHash, baselineHash, capabilities }` — closing guard 用于验证。

## 1. Batch 1: Delta publication

- [x] 1.1 为 ADDED、MODIFIED、REMOVED、RENAMED 的基线应用编写失败测试。
- [x] 1.2 运行 `node --test tests/lib/cmd-sync-paths.test.mjs` 并确认失败。
- [x] 1.3 在 `scripts/lib/cmd-sync.mjs` 实现最小 delta 应用与确定性哈希。
- [x] 1.4 运行同步测试并确认通过。
- [x] 1.5 审查基线不包含 delta 标头。

## 2. Batch 2: Receipt-gated closure

- [x] 2.1 为缺失或过期回执编写 closing guard 失败测试。
- [x] 2.2 运行 `node --test tests/lib/guard-specs-merged.test.mjs` 并确认失败。
- [x] 2.3 在状态加载器和 `specs-merged` guard 中实现回执持久化与验证。
- [x] 2.4 运行 guard 测试并确认通过。
- [x] 2.5 运行完整测试套件并确认通过。
