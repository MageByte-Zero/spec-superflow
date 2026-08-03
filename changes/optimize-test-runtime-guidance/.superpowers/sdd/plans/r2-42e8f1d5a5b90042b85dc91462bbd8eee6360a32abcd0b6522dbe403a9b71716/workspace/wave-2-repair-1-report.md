# Wave 2 repair 1 report

## Scope

Resolve the Wave 2 Important finding only: an eligible `lightweight` change
must not close with `test_result: pass` alone.

## RED

Added a lightweight closing test. Before the repair, the guard returned success
with only a valid selection and `test_result: pass`; the test expected a block.

## GREEN

- Added `ssf workflow evidence` to write one focused-review summary and a
  passing verification command/result into the selected, hash-protected
  `workflow-selection.json` receipt.
- A second evidence write is rejected, so the receipt represents exactly one
  focused review.
- Lightweight `executing -> closing` now requires the direct receipt,
  `test_result: pass`, and the lightweight completion evidence.
- No Full planning pack, contract, DP-3/DP-4, execution plan, or wave receipt
  is created or required by this path.

## Verification

`node --test tests/lib/workflow-recommendation.test.mjs tests/lib/cmd-workflow.test.mjs`

Result: 46 passing, 0 failing.
