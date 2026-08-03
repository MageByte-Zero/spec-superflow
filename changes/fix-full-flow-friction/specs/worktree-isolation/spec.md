## MODIFIED Requirements

### Requirement: 保持隔离安全行为

isolate wrapper SHALL 保留 literal command invocation、15 秒 child timeout、显式 `--force` 转发，以及没有批准时拒绝在 protected branch 原地编辑的现有行为；在创建 worktree 时，系统 SHALL 将其放在 Git 仓库旁，并让 active change 工件位于相同的仓库相对路径。

#### Scenario: Uncommitted planning artifacts

- **WHEN** an active change contains uncommitted planning artifacts
- **THEN** the isolated worktree contains that change directory without copying unrelated working-tree changes
