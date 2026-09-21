# Artifact Contract

新任务走紧凑流程：draft（尚未批准的 proposal/tasks）→ executing → closing，abandoned 为取消。直接请求从 executing 开始。普通调试和验证是执行活动，不单独扭转状态。`workflow start` 记录一次具体计划批准并生成计划；`workflow complete` 验证交付。planned 的权威执行记录是 schema_version 2 plan，派生状态摘要不构成门禁；不要求 execution-contract、推荐凭据或 DP-0..DP-4。用户可明确选择 accepted-risk 结束，不能伪造测试通过，且不自动物理集成。

**下文保留旧八状态和 DP 协议，仅供既有 legacy 任务恢复。不要为新任务重走这些步骤。**


`spec-superflow` uses five primary artifacts in each change:

1. `proposal.md`
2. `specs/`
3. `design.md`
4. `tasks.md`
5. `execution-contract.md`

The first four are planning artifacts. The fifth is the execution handshake.

## Artifact Roles

### `proposal.md`

Defines:

- why the change exists
- what is in scope
- what is explicitly out of scope
- which capabilities are affected

### `specs/`

Defines:

- required behavior
- scenarios and acceptance conditions
- behavioral edges the implementation must respect

In a project using this plugin, `specs/` within an active `changes/<change>/` directory is the change's delta-spec source and the only spec input to that change's workflow state. The project-root `specs/` directory is a separately published baseline: `ssf sync` applies delta operations to it and records a publication receipt on the active change. Root baseline files never determine active transitions; closing verifies the receipt against both sides. The plugin repository itself ships only curated examples, not live change directories or generated baselines.

#### Delta publication compatibility

`## Purpose` is an optional top-level extension in a delta spec, not a newly required field. It is used only to create a new published main spec; an absent or empty value receives a deterministic default Purpose, while an existing main spec Purpose is preserved. Consequently, older templates and historical deltas without this section remain publishable.

A no-op means an already synchronized, semantically equivalent delta operation: it produces a successful receipt but no baseline write. A missing operation target with a case- or whitespace-only near-match must fail rather than being treated as a no-op. `ssf sync` constructs and validates every candidate before it writes any baseline file, so an invalid candidate prevents partial publication.

### `design.md`

Defines:

- architecture and component boundaries
- interface and dependency decisions
- trade-offs and risk areas

### `tasks.md`

Defines:

- implementation ordering
- dependency-aware work breakdown
- completion units that become named execution waves in the execution plan

### `execution-contract.md`

Defines:

- the approved intent lock
- the approved behavior summary
- implementation constraints
- the instructions for the execution plan and named execution waves
- test obligations
- review gates and their review receipts
- escalation rules

For Full/legacy Hotfix, `ssf execution recommend` lists applicable execution modes and
recommends one from task count and wave strategy, and persists a recommendation
receipt at `<change>/.superpowers/sdd/execution-recommendation.json`. `plan`
and `revise` require the receipt to match the current artifacts, contract, and
waves. The user confirms the selected mode with `--confirm`; a non-recommended mode additionally requires
`--acknowledge-recommendation`. Batch Inline remains serial. After approval,
`ssf execution plan` writes
the persisted execution plan to `<change>/.superpowers/sdd/execution-plan.json`.
That JSON records each wave's dependencies and parallel/serial strategy; it is
not stored in `execution-contract.md`. Native uses `review_policy: final`; SDD and legacy plans use wave review gates. Task/file/wave counts alone never require SDD. Quick, direct Hotfix, and Tweak are exempt from execution-plan and review-receipt gates and persist `test_result: pass` after bounded verification. `ssf execution revise`
may retain or switch any confirmed mode. Applicable evidence survives mode-only revisions; scope changes invalidate passing evidence conservatively and preserve open failures.

### Recovery control-plane overlay

Recovery commands operate beside the eight-state workflow, without creating a
ninth state or a new transition. `ssf resume [change-dir]` and `ssf switch
<change-dir>` are read-only: resume returns a recovery summary and chooses a
target automatically only when there is one active change; switch returns the
explicit target's recovery context and never changes cwd, a TUI session, or a
hidden pointer. Its CodeBuddy/WorkBuddy adapter may use that context to focus a
conversation. `ssf save <change-dir> --task <id> --next <text>` manually writes a
compatible checkpoint through the existing checkpoint save protocol. It never
commits, pushes, or syncs automatically. `/ssf:resume`, `/ssf:switch`, and
`/ssf:save` are CodeBuddy/WorkBuddy Markdown command adapters that dispatch to
the same CLI guards; other platforms are not promised identical slash names.

## Mapping

`spec-superflow` converts planning artifacts into execution inputs:

- `proposal.md` -> intent lock and scope fence
- `specs/` -> test obligations and acceptance checks
- `design.md` -> implementation constraints
- `tasks.md` -> execution-plan waves in `<change>/.superpowers/sdd/execution-plan.json`

## Guardrail

For Full/legacy Hotfix, implementation starts only after:

- planning artifacts exist
- `execution-contract.md` exists
- the user approves the execution contract
- Full/legacy Hotfix have a current `ssf execution plan` with a user-confirmed mode and
  persisted recommendation evidence
- closing requires a current `pass` under the final/wave policy; checked tasks alone do not certify code

Execution efficiency: Native = `inline`, default review policy `final`; SDD = optional delegation with `wave` review. `execution revise` may retain or change mode. Reports are immutable snapshots. `closing` is logical completion; recorded pending physical finish remains resumable. `finish` uses the recorded target and never force-removes work.


### Recovery and execution cost boundaries

Default isolation uses a feature branch in the current checkout; worktrees require explicit `--worktree`. Native execution reuses unchanged approvals and requires explicit authorization for delegation. Final reviews cover the full change through repairs. Unfinished physical finish remains recoverable and revalidates once per attempt.
