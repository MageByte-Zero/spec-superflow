# refactor-auth-boundary Example

This example demonstrates how `spec-superflow` handles a brownfield backend refactor instead of a net-new UI feature.

The scenario is a codebase where authentication checks have drifted across controllers, services, and helpers.

Included artifacts:

- `proposal.md`
- `specs/auth-boundary/spec.md`
- `design.md`
- `tasks.md`
- `execution-contract.md`

Read these files in order to see how a scattered auth implementation is converted into a stable execution contract without silently expanding scope into a full auth redesign.
