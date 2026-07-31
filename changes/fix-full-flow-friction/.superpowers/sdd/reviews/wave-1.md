# Wave 1 审查报告

- wave：`wave-1`
- 范围：`9105098..08f67cf`
- 合同：[execution-contract.md](../../../execution-contract.md)
- verdict: fail

## Strengths

- 隔离工作树现在从 Git 仓库根目录计算相邻路径，并只复制 active change；实测已提交目录上有未提交工件时，目标工作树得到更新后的工件内容，未复制无关文件（`scripts/ensure-branch.mjs:50-83`）。
- `writePlan` 与 `recordReview` 均会初始化 review overlay，避免第一次写回执需要人工建目录（`scripts/lib/execution-plan.mjs:40-56, 129-133`）。
- Delta 预检复用发布实现，且仅对标准 `changes/<name>` 布局启用，保留独立夹具的验证兼容性（`scripts/lib/cmd-validate.mjs:26-42, 87-103`）。
- 状态转换在写入前刷新 artifact 与 contract hash，修复了转换后立即 `state check` 不一致的问题（`scripts/lib/cmd-state.mjs:173-179`）。

## Issues

### Critical

无。

### Important

1. `scripts/ensure-branch.mjs:65-66` — `changeName` 被直接拼接进 worktree 路径，未拒绝路径分隔符或 `..`。例如 `join('/tmp', 'repo-../../outside')` 的结果为 `/tmp/outside`，因此 `node scripts/ensure-branch.mjs changes/x ../../outside` 可把 worktree 放到并非仓库相邻命名空间的位置，违背合同中“位于仓库旁”的保证，也可能与用户已有目录冲突。
   - 修复：将 name 限制为单个安全路径段（拒绝 `.`、`..`、`/`、`\\`、NUL），或对路径解析后校验 `dirname(worktreePath) === dirname(repoRoot)`；同时为 `../../outside` 增加拒绝型回归测试。

### Minor

无。

## Test Evidence

- 通过：`node --test tests/lib/ensure-branch.test.mjs tests/lib/execution-plan.test.mjs tests/lib/cmd-validate-paths.test.mjs tests/lib/cmd-state.test.mjs`
- 通过：`npm run build && npm test`（由本轮前的独立审查执行；本次快速复审未重复运行）。
- 通过：`git diff --check 9105098..08f67cf`。
- 手工复现：已提交 active change 加未提交覆盖内容后执行 isolate，目标 worktree 的同路径文件内容为未提交版本；验证了正常复制路径。

## Assessment

**Ready to merge?** No。

唯一 Important 问题位于此次 P0 隔离路径修复的核心边界；需先限制 `changeName`，并以专项测试证明不能逃逸目标父目录，再记录通过回执。

```bash
ssf execution review changes/fix-full-flow-friction --wave wave-1 --base 9105098 --head 08f67cf --report .superpowers/sdd/reviews/wave-1.md --verdict fail
```
