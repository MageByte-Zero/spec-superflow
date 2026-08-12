# Execution contract: add adjudication recovery

## Intent Lock

- **Change name**: `add-adjudication-recovery`.
- **Problem**: an SDD wave at `adjudication-required` has no supported CLI path to persist the requested human decision and record another review.
- **In scope**: plan-scoped decision evidence, exactly one authorized continuous review, CLI/show/help, tests, and recovery documentation.
- **Out of scope**: changing retry thresholds, resetting or deleting failures, synthesizing pass, adding workflow states, unrelated release changes, or publishing this delta.

## Approved Behavior

- A confirmed `execution adjudicate` command accepts only `--decision allow-review` for exactly one current wave already at `adjudication-required`.
- The receipt binds plan hash/revision, wave, failure count, previous head/report, latest failed receipt, decision, safe non-empty reason, and timestamp.
- An active receipt authorizes one review subject to existing Git-range, report-evidence, and repair-continuity checks.
- A pass resolves the repair chain and releases dependents through existing pass-only rules; a fail appends evidence and requires a new adjudication.
- Stale plans, wrong waves, invalid parameters, mismatched evidence, and replay attempts fail without changing control evidence.
- `execution show --json` exposes adjudication status separately from repair resolution.

## Design Constraints

- **Architecture**: adjudication is plan-scoped overlay evidence, not a ninth state and not a hand-edited repair-state flag.
- **Interface**: `ssf execution adjudicate <change-dir> --wave <id> --decision allow-review --confirm --reason <text>`.
- **Dependencies**: zero new runtime dependencies; preserve Node 20 support and existing public command behavior.
- **Data**: retain all failures and bind authorization to the exact current repair identity; do not infer success from adjudication.

## Execution Waves

### Wave 1

- **Wave ID**: `adjudication-recovery`
- **Tasks**: 1.1, 2.1, 2.2, 3.1
- **Depends on**: none
- **Strategy**: `serial`
- **Goal**: implement, expose, document, and verify plan-scoped one-shot authorization as one bounded batch.
- **Inputs**: approved delta and design; current execution-plan/overlay implementation.
- **Outputs**: adjudication storage and APIs, CLI/help, tests, documentation, and fresh integrated evidence.
- **Completion**: focused tests prove all adjudication boundaries; build, full tests, strict validation, doctor, and diff checks pass.
- **Review gate**: distinct report plus current base/head `pass` receipt.

## Test Obligations

- **RED first**: tests must initially demonstrate that no adjudication command/API exists and that review remains blocked.
- **Required boundaries**: missing confirmation/reason/decision, non-blocked or unknown wave, stale plan, active-authorization replay, one-shot consumption, failed authorized review, successful authorized review, dependent blocking, and exact repair continuity.
- **Regression-sensitive areas**: legacy failed-review behavior below threshold, review report integrity, plan revision isolation, cleanup retention, help output, and JSON show shape.

## Execution Mode

- **Available modes and recommendation**: obtain with `ssf execution recommend` for one serial wave containing all four tasks.
- **User-confirmed mode**: `sdd`, matching the repository's Full state-machine/API change recommendation and the user's request to implement and submit the fix.
- **Execution plan**: persist only after this contract is approved and current hashes are rebuilt.

## Verification Dimensions

| Dimension | Status | Finding |
|---|---|---|
| Completeness | Pass | Every delta scenario maps to tasks and test obligations. |
| Correctness | Pass | Authorization never replaces pass and is bound to current evidence. |
| Coherence | Pass | Overlay, CLI, tests, and documentation share one one-shot model. |

**Overall conclusion**: Approved for bounded implementation after DP-3 and a current execution plan.

## Review Gates

- Every wave requires a separate non-empty review report and current `pass` receipt.
- Critical or Important findings block dependent waves; no receipt or stale evidence also blocks.
- Completion requires all current wave receipts to pass plus final broad review.

## Escalation Rules

- Return to `specifying` if adjudication must support decisions other than `allow-review`, change retry thresholds, or alter dependent completion semantics.
- Return to `bridging` if storage/API shape changes materially while approved behavior remains stable.
- Stop implementation if one-shot safety cannot be enforced without rewriting repair history or if existing plan isolation assumptions fail.
