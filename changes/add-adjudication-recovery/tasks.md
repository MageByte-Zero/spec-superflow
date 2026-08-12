# Implementation tasks

## Delivery and Proof

| Batch | Delivery result | Dependencies | Proof |
|---|---|---|---|
| 1 | Plan-scoped one-shot adjudication state and behavior | None | `node --test tests/lib/execution-plan.test.mjs` |
| 2 | Public CLI, recovery output, help, and operator guidance | Batch 1 | `node --test tests/lib/cmd-execution.test.mjs tests/lib/cli-help.test.mjs` |
| 3 | Integrated compatibility verification | Batches 1–2 | `npm run build && npm test` |

## Tasks

- [x] **1.1 Add adjudication state and one-shot review authorization**: update `scripts/lib/sdd-overlay.mjs` and `scripts/lib/execution-plan.mjs` so only a current blocked repair chain can receive and consume an audited authorization while dependents remain pass-gated; proof: `node --test tests/lib/execution-plan.test.mjs`.
- [x] **2.1 Add the guarded CLI boundary**: update `scripts/lib/cmd-execution.mjs`, `scripts/spec-superflow.mjs`, and command tests for `execution adjudicate --decision allow-review --confirm --reason`; proof: `node --test tests/lib/cmd-execution.test.mjs tests/lib/cli-help.test.mjs`.
- [x] **2.2 Document operator recovery**: update `README.md`, `docs/README_en.md`, and execution skills with the exact adjudication and one-shot review semantics; proof: `git diff --check` and documentation-contract assertions.
- [x] **3.1 Run integrated verification and review**: build committed `dist`, run the complete suite, validate the change, and review the bounded diff against this contract; proof: `npm run build && npm test && node scripts/spec-superflow.mjs validate changes/add-adjudication-recovery --strict`.
