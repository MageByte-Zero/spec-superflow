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

In a project using this plugin, `specs/` within an active `changes/<change>/` directory is the change's delta-spec source and the only spec input to that change's workflow state. The project-root `specs/` directory is a separately published baseline: `ssf sync` applies delta operations to it and records a publication receipt on the active change. Root baseline files never determine active transitions; closing verifies the receipt against both sides. The plugin repository itself ships only curated examples, not live change directories or generated baselines.

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

For Full/legacy Hotfix, `ssf execution recommend` lists applicable execution modes and
recommends one from task count and wave strategy, and persists a recommendation
receipt at `<change>/.superpowers/sdd/execution-recommendation.json`. `plan`
and `revise` require the receipt to match the current artifacts, contract, and
waves. The user confirms the selected mode with `--confirm`; a non-recommended mode additionally requires
`--acknowledge-recommendation`. Batch Inline remains serial. After approval,
`ssf execution plan` writes
the persisted execution plan to `<change>/.superpowers/sdd/execution-plan.json`.
That JSON records each wave's dependencies and parallel/serial strategy; it is
not stored in `execution-contract.md`. A current `pass` review receipt is
required for every wave before dependent work or closing proceeds. Quick, direct Hotfix, and Tweak are exempt from execution-plan and review-receipt gates and persist `test_result: pass` after bounded verification. `ssf execution revise`
retains or upgrades an existing plan as `sdd`, requires fresh confirmation,
creates a new revision, and
clears prior review receipts; it never permits a downgrade.

### Recovery control-plane overlay

Recovery commands operate beside the eight-state workflow, without creating a
ninth state or a new transition. `ssf resume [change-dir]` and `ssf switch
<change-dir>` are read-only: resume returns a recovery summary and chooses a
target automatically only when there is one active change; switch returns the
explicit target's recovery context and never changes cwd, a TUI session, or a
hidden pointer. Its CodeBuddy/WorkBuddy adapter may use that context to focus a
conversation. `ssf save <change-dir> --task <id> --next <text>` manually writes a
compatible checkpoint through the existing checkpoint save protocol. It never
commits, pushes, or syncs automatically. `/ssf:resume`, `/ssf:switch`, and
`/ssf:save` are CodeBuddy/WorkBuddy Markdown command adapters that dispatch to
the same CLI guards; other platforms are not promised identical slash names.

## Mapping

`spec-superflow` converts planning artifacts into execution inputs:

- `proposal.md` -> intent lock and scope fence
- `specs/` -> test obligations and acceptance checks
- `design.md` -> implementation constraints
- `tasks.md` -> execution-plan waves in `<change>/.superpowers/sdd/execution-plan.json`

## Guardrail

For Full/legacy Hotfix, implementation starts only after:

- planning artifacts exist
- `execution-contract.md` exists
- the user approves the execution contract
- Full/legacy Hotfix have a current `ssf execution plan` with a user-confirmed mode and
  persisted recommendation evidence
- every completed wave records a current `pass` review receipt before closing
