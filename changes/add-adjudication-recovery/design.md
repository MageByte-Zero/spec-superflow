# Adjudication recovery design

## Facts and Constraints

- `recordReview` currently refuses every review once plan-scoped repair state is `adjudication-required`, while no CLI command can persist the requested human decision.
- Review receipts, repair state, and execution work are isolated by plan hash and revision; adjudication evidence must preserve the same boundary.
- Existing continuity validation requires a repair review base to equal the previous review head, except for the established corrected-pass range behavior.
- The fix must preserve all failures, never synthesize `pass`, and add no runtime dependency.

## Goals and Non-goals

- **Goals**: provide an auditable explicit decision, authorize one review only, reject stale/replayed decisions, expose recovery status, and retain dependent-wave blocking until pass.
- **Non-goals**: alter the failure threshold, automatically decide for a human, reset failure counts, publish specs, or introduce a new core workflow state.

## Decisions

### Decision: Store a plan-scoped adjudication receipt

- **Choice**: add `plans/<plan-identity>/adjudications/<wave>.json`, bound to the current repair chain by plan identity, failure count, previous head, and previous report.
- **Rationale**: a separate immutable decision record preserves repair evidence and avoids making hand-edited repair state authoritative.
- **Alternatives**: mutate repair status to `repairing` or create a new plan revision. The former erases why the circuit opened; the latter discards the identity of the chain being adjudicated.
- **Consequences**: `execution show` gains an `adjudication` object and storage gains one plan-scoped directory.

### Decision: Make authorization self-invalidating when review state changes

- **Choice**: an authorization is active only while its bound failure count, previous head, previous report, and latest fail receipt still match. `recordReview` consumes it after writing the authorized result; even an interruption after the review write changes the repair identity and prevents replay.
- **Rationale**: binding authorization to immutable evidence supplies one-shot behavior without weakening review continuity.
- **Alternatives**: a free-standing boolean or manual repair-state edit. Both can be replayed or detached from the evidence that was adjudicated.
- **Consequences**: a failed authorized review returns to `adjudication-required` and requires a fresh decision.

### Decision: Keep dependents blocked until pass

- **Choice**: an active authorization makes only the adjudicated wave eligible/retryable; dependency checks continue to require a current pass receipt.
- **Rationale**: adjudication permits evidence gathering, not completion.
- **Alternatives**: treat adjudication as pass. This would violate the existing review gate.
- **Consequences**: `execution show --json` clearly distinguishes authorization from resolution.

## Risks and Verification

- **Stale or forged authorization** → validate current plan and exact repair identity → tests mutate plan/repair inputs and assert rejection.
- **Authorization replay** → consume after review and bind to failure identity → tests attempt a second review without a new adjudication.
- **Accidental dependent release** → preserve pass-only dependency logic → tests inspect dependent eligibility before and after pass.
- **CLI ambiguity** → require one `--wave`, `--decision allow-review`, `--confirm`, and safe `--reason` → command tests cover missing and invalid inputs.
