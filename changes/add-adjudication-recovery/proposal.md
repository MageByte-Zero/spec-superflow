# Add adjudication recovery

## Why

An SDD wave that reaches `adjudication-required` cannot progress: the CLI rejects every further review but provides no command that records the human decision requested by the workflow. Operators must either abandon valid evidence or create a new plan revision, which is not equivalent to resolving the existing repair chain.

## What Changes

- Add an explicit `ssf execution adjudicate` command for a current, blocked wave.
- Persist an auditable, plan-scoped authorization for exactly one continuous review attempt.
- Keep the wave and all dependents blocked until that authorized review records `pass`; a failed authorized review returns the wave to `adjudication-required`.
- Expose adjudication status through `execution show --json` and document the recovery command.

## Scope

### In Scope

- Execution-plan state, CLI validation, plan-scoped adjudication evidence, tests, help, and operator guidance.

### Out of Scope

- Changing the automatic repair limit, manufacturing a pass receipt, rewriting prior failure evidence, adding workflow states, or publishing a release.

## Impact

- **Affected areas**: `scripts/lib/execution-plan.mjs`, execution CLI/help, SDD overlay paths, execution tests, workflow skills, and user documentation.
- **Completion proof**: focused tests reproduce the former dead end and prove one-shot recovery, invalidation, replay rejection, dependent blocking, and pass/fail outcomes; the full build and test suite pass.
