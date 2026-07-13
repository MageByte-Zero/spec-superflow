# State Machine

`spec-superflow` treats workflow progression as explicit state transitions.

## States

### `exploring`

- intent is still fuzzy
- options are still being compared
- no implementation is allowed
- `need-explorer` is active

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
- hotfix also passes through this state with a fresh minimal contract and DP-3 approval before build

### `approved-for-build`

- the execution contract exists
- the user has approved it
- full/hotfix still require a current execution plan before implementation can begin

### `executing`

- implementation follows the execution contract
- TDD, SDD (subagent-driven), review gates, and escalation rules apply
- `build-executor` is active
- `code-reviewer` invoked after each execution batch

## Execution Plan Control Plane

For full/hotfix, DP-4 is the persisted execution plan created by `ssf execution
plan` at `<change>/.superpowers/sdd/execution-plan.json`, not an arbitrary
state value or content stored in `execution-contract.md`. SDD is the default. `inline` and
`batch-inline` require an explicit user override; Batch Inline remains serial
and is never an automatic default or a substitute for parallel execution.
`tweak` is exempt from execution-plan and review-receipt requirements.

The plan names ordered execution waves, dependencies, and parallel/serial
strategy. `ssf execution show <change-dir> --json` reports which current waves
are eligible. Each completed wave must have a current
`pass` review receipt, recorded with `ssf execution review`, before a dependent
wave or `closing` can proceed. `ssf execution revise` retains or upgrades an
existing plan as `sdd`; that new revision invalidates old review receipts and
does not permit a downgrade. #47 recovery/switch/save
slash commands are not implemented; do not assume `/ssf:*` commands exist.

### `debugging`

- execution has hit a bug, test failure, or unexpected behavior
- `bug-investigator` is active
- 4-phase debugging (Root Cause → Pattern Analysis → Hypothesis → Implementation)
- After debugging completes, returns to `executing`

### `closing`

- verification is complete with evidence
- `release-archivist` is active
- `verification-before-completion` gate enforced
- `spec-merger` invoked if delta specs need merging into main specs
- the change can be summarized, archived, or handed off

### `abandoned`

- the change has been abandoned by the user or after bug-investigator escalation
- no delta spec merge is allowed
- no further state transitions are allowed
- delta specs are preserved for reference only

## Terminal States

- `closing` — successful completion with verification
- `abandoned` — change abandoned (no delta spec merge, no further transitions allowed)

## Recovery Overlays

Checkpoints, handoffs, and prototypes are durable overlays, not workflow states.
They do not add transitions to the state machine or change the meaning of the
eight core states.

- `ssf checkpoint save <change-dir> --task <id> --next <text>` records task-level
  recovery context under `.superpowers/sdd/checkpoints/`.
- `ssf handoff create <change-dir> --type <type> ...` creates explicit side-work
  contracts under `.superpowers/sdd/handoffs/`.
- `workflow-start` lists overlays before normal routing. `result-ready` handoffs
  require explicit review and resolution before affected work resumes; stale
  checkpoints remain historical evidence only.
- Prototype work is optional and requires explicit user confirmation. Results
  are reviewed manually and never mutate `design.md` or `tasks.md`.

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
                     (scope change → re-specify)

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

- `hotfix` follows `exploring -> bridging -> approved-for-build -> executing`.
- `hotfix` may skip full planning artifacts such as `proposal.md`, `design.md`, `tasks.md`, and `specs/`.
- `hotfix` still requires a fresh minimal `execution-contract.md` and explicit DP-3 approval before implementation.
- `tweak` remains the only path that can jump directly from `exploring` to `approved-for-build`.
