# Task 1.2 implementer report

## Result

Added internal, script-local in-process boundaries for CLI dispatch, execution
command output, and guard evaluation. They are not re-exported from `src/`,
package exports, or public documentation. The public CLI and guard wrappers
remain child-process smoke-tested for success, validation failure, streams,
exit status, and relative-path cwd behavior.

## TDD evidence

- **RED:** `node --test tests/lib/internal-command-guard-boundaries.test.mjs`
  failed before implementation: `SyntaxError: The requested module
  '../../scripts/spec-superflow.mjs' does not provide an export named
  'dispatchCli'` (1 test file failed; 0 passed).
- **GREEN:** `node --test tests/lib/internal-command-guard-boundaries.test.mjs`
  passed: 7 tests, 0 failed, 2 suites (6.31 s). It covers injected command,
  execution, and guard streams plus both wrapper smoke matrices.
- **Regression:** `npm run build` succeeded; `node --test
  tests/lib/cmd-execution.test.mjs tests/lib/guard.test.mjs
  tests/lib/cmd-runtime.test.mjs` exited 0; `git diff --check` passed.
- **Falsifiability:** Removing stream forwarding, returning the wrong exit
  status, or treating the wrapper cwd as the repository root makes the focused
  tests fail.

## Changed files

- `scripts/spec-superflow.mjs`
- `scripts/lib/cmd-execution.mjs`
- `scripts/guard/guard.mjs`
- `tests/lib/internal-command-guard-boundaries.test.mjs`

## Self-review and risk

The script exports are intentionally internal test seams only; no library or
documented API surface changed. Legacy commands can still own their existing
process-level exits, while the repeated execution command and guard paths now
return statuses for in-process use. Wrapper smoke tests retain the public
boundary. The remaining risk is un-migrated heavy suites, explicitly reserved
for task 1.3.

## Commit range

- Base: `96d1e0cb66965792a61a1d9e4da4fcc58391ddc3`
- Head: `HEAD` (the Task 1.2 implementation commit)
