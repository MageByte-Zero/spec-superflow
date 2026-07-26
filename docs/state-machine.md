# State Machine

`spec-superflow` treats workflow progression as explicit state transitions.

## States

### `exploring`

- intent is still fuzzy
- options are still being compared
- no implementation is allowed
- `need-explorer` is active

#### Workflow Path Intake

At entry, `workflow-start` reads the persisted `workflow` selection first. An
explicit `full`, `hotfix`, `tweak`, or `quick` selection wins. Otherwise it runs `ssf
workflow show`, asks only for `missing_facts`, runs `ssf workflow recommend`,
and presents Observed, Available, Recommended, and Why. Recommendation does
not change state or select a path: only an explicit `ssf workflow select
--confirm` writes `workflow`. A non-recommended selection requires
`--acknowledge-recommendation`. The legacy `runtime infer` compatibility API
may return `full` for an empty directory, but it never replaces the user's
intake selection.

This intake completes before DP-0 is marked confirmed. Artifact language may
be resolved first, but `dp_0_confirmed=true` is written only after the selected
path summary and the remaining scope, constraints, and communication decisions
are confirmed together. The full selection receipt lives at
`.superpowers/sdd/workflow-selection.json`; DP-0 state stores only the
idempotent summary while preserving scope and `artifact_language`.

This is the DP-0 planning-path decision. DP-4 remains the separate execution
mode decision among Inline, Batch Inline, and SDD. Neither recommendation nor
selection creates a ninth state or performs a phase transition.

### `specifying`

- planning artifacts are being written or revised
- proposal, specs, design, and tasks are refined
- `spec-writer` is active
- schema validation runs on every artifact generation

### `bridging`

- planning artifacts are translated into `execution-contract.md`
- ambiguity is compressed into explicit approved decisions
- `contract-builder` is active
- parsing engine auto-extracts intent/scope/test-obligations/constraints/batches
- legacy Hotfix passes through this state with a fresh minimal contract and DP-3 approval; direct Hotfix does not

### `approved-for-build`

- Full/legacy Hotfix have an approved execution contract and current plan; Quick/direct Hotfix/Tweak use their receipt-aware short path

### `executing`

- implementation follows the execution contract
- TDD, SDD (subagent-driven), review gates, and escalation rules apply
- `build-executor` is active
- `code-reviewer` invoked after each execution batch
- 发布验证、delta-spec 同步与审计都必须在此状态完成；必要时调用 `release-archivist` 和 `spec-merger`，再执行最终状态转换

## Execution Plan Control Plane

For Full/legacy Hotfix, DP-4 is the persisted execution plan created by `ssf execution
plan` at `<change>/.superpowers/sdd/execution-plan.json`, not an arbitrary
state value or content stored in `execution-contract.md`. Before planning, run
`ssf execution recommend`; it lists applicable `inline`, `batch-inline`, and
`sdd` modes with evidence and one recommendation, and persists a receipt at
`<change>/.superpowers/sdd/execution-recommendation.json`. `plan` and `revise`
accept only a receipt whose artifacts, contract, and waves still match. The user must record the
selected mode with `--confirm`; a non-recommended selection also requires
`--acknowledge-recommendation`. Batch Inline remains serial and is never a
substitute for parallel execution.
Quick, direct Hotfix, and Tweak are exempt from execution-plan and review-receipt requirements; each closes only with `test_result: pass`.

The plan names ordered execution waves, dependencies, and parallel/serial
strategy. `ssf execution show <change-dir> --json` reports which current waves
are eligible. Each completed wave must have a current
`pass` review receipt, recorded with `ssf execution review`, before a dependent
wave or `closing` can proceed. `ssf execution revise` retains or upgrades an
existing plan as `sdd`; that new revision requires a fresh confirmation (and
acknowledgement when it differs from the new recommendation), invalidates old
review receipts, and does not permit a downgrade. Recovery, switching, and
manual save are a control-plane overlay; they do not create a ninth workflow
state.

### `debugging`

- execution has hit a bug, test failure, or unexpected behavior
- `bug-investigator` is active
- 4-phase debugging (Root Cause → Pattern Analysis → Hypothesis → Implementation)
- After debugging completes, returns to `executing`

### `closing`

- successful terminal state（成功终态）；验证、同步和审计证据已在 `executing` 完成
- 没有 active skill，next skill 为 `none`
- 进入后不运行 handoff、checkpoint 或 execution-control 恢复扫描，也不再路由 `release-archivist` 或 `spec-merger`
- 不允许继续、恢复、交接或发生任何后续状态转换

### `abandoned`

- the change has been abandoned by the user or after bug-investigator escalation
- no delta spec merge is allowed
- no further state transitions are allowed
- delta specs are preserved for reference only

## Terminal States

- `closing` — successful terminal completion；所有收尾动作均在 `executing` 完成后才可进入
- `abandoned` — change abandoned (no delta spec merge, no further transitions allowed)

## Recovery Overlays

Checkpoints, handoffs, and prototypes are durable overlays, not workflow states.
They do not add transitions to the state machine or change the meaning of the
eight core states.

- `ssf resume [change-dir]` is read-only and returns a recovery summary. With no
  target, it auto-selects only the unique active change.
- `ssf switch <change-dir>` is read-only and returns the explicit target's
  recovery context; it never changes cwd, a TUI session, or a hidden pointer.
- `ssf save <change-dir> --task <id> --next <text>` manually writes a compatible
  checkpoint. It never commits, pushes, or syncs automatically.
- `ssf checkpoint save <change-dir> --task <id> --next <text>` records task-level
  recovery context under `.superpowers/sdd/checkpoints/`.
- `ssf handoff create <change-dir> --type <type> ...` creates explicit side-work
  contracts under `.superpowers/sdd/handoffs/`.
- `workflow-start` 仅对非终态在正常路由前列出 overlays；`closing` 会在
  overlay recovery 前短路。`result-ready` handoff 在受影响工作恢复前仍需显式
  审查和 resolve；stale checkpoint 仅保留为历史证据。
- Prototype work is optional and requires explicit user confirmation. Results
  are reviewed manually and never mutate `design.md` or `tasks.md`.
- `/ssf:resume`, `/ssf:switch`, and `/ssf:save` are CodeBuddy/WorkBuddy Markdown
  command adapters for these CLI guards. The switch adapter may use its returned
  context to focus a conversation; these names are not promised on every platform.

## Transitions

```text
  exploring ──── hotfix ─────────> bridging          (fast-path)
  bridging  ──── hotfix ─────────> approved-for-build
  exploring ──── tweak ──────────> approved-for-build (fast-path)

  exploring -> specifying -> bridging -> approved-for-build -> executing -> closing
                ^              ^             |                 ^    |
                |              |             v                 |    |
                |              |         debugging ────────────┘    |
                |              |                                    |
                |              +------------------------------------+
                |              (contract drift → re-bridge)
                +---------------------------------------------------+
                     (scope change in a non-terminal state → re-specify)

  closing ─── scope change ───> create new change

  (any non-terminal state) ──> abandoned
                                (terminal, no further transitions)
```

## Mandatory Rewind

The workflow must move back to `specifying` or `bridging` when:

- new scope appears
- a critical interface changes
- a key design assumption is wrong
- current artifacts no longer define the intended behavior
- `execution-contract.md` intent lock no longer matches `proposal.md` scope
- the execution plan is stale, its mode no longer matches state, or its waves
  need different dependencies

## Debugging State

During `executing`, if a bug, test failure, or unexpected behavior blocks progress:

1. Pause `executing` and enter `debugging`
2. `bug-investigator` performs 4-phase root cause analysis
3. If root cause found → fix (with TDD) → return to `executing`
4. If 3+ fix attempts fail → question architecture → escalate to user

## Anti-Pattern

Do not stay in `executing` and "just adjust things in chat" when scope or behavior changes.

If the contract changed, the artifacts changed.

## Fast-Path Notes

- **direct Hotfix** (incident, ≤2 files/tasks) and **Quick** (≤3 files/tasks) follow `exploring -> approved-for-build -> executing` with a valid direct receipt; no artifacts, contract, plan, review receipt, or DP approval. Direct Hotfix proves the original symptom; Quick runs focused verification.
- **legacy Hotfix** follows `exploring -> bridging -> approved-for-build -> executing` and retains its minimal contract and DP-3.
- **Tweak** (≤4 configuration/doc files) also jumps directly from `exploring` to `approved-for-build`.
