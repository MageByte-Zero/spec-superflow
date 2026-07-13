# Artifact Contract

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

For full/hotfix, SDD is the default execution mode. `inline` and
`batch-inline` require an explicit user override; Batch Inline remains serial
and is never an automatic default. After approval, `ssf execution plan` writes
the persisted execution plan to `<change>/.superpowers/sdd/execution-plan.json`.
That JSON records each wave's dependencies and parallel/serial strategy; it is
not stored in `execution-contract.md`. A current `pass` review receipt is
required for every wave before dependent work or closing proceeds. `tweak` is
exempt from execution-plan and review-receipt gates. `ssf execution revise`
retains or upgrades an existing plan as `sdd`, creates a new revision, and
clears prior review receipts; it never permits a downgrade. #47 slash commands for recovery,
switching, and manual save are not implemented, so `/ssf:*` commands must not
be claimed.

## Mapping

`spec-superflow` converts planning artifacts into execution inputs:

- `proposal.md` -> intent lock and scope fence
- `specs/` -> test obligations and acceptance checks
- `design.md` -> implementation constraints
- `tasks.md` -> execution-plan waves in `<change>/.superpowers/sdd/execution-plan.json`

## Guardrail

Implementation starts only after:

- planning artifacts exist
- `execution-contract.md` exists
- the user approves the execution contract
- full/hotfix have a current `ssf execution plan` with SDD as the default or an
  explicit override
- every completed wave records a current `pass` review receipt before closing
