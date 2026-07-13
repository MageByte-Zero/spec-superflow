# Contributing

Thanks for considering a contribution to `spec-superflow`.

This repository is not just a collection of prompt files. It is a workflow system.

Contributions should preserve three core properties:

- spec-first planning
- guarded handoff through `execution-contract.md`
- one visible workflow owner

## Contribution Areas

Good contributions include:

- improving skill trigger clarity
- strengthening workflow guardrails
- adding or refining templates
- adding realistic example change sets
- improving installation or publishing docs
- clarifying artifact contracts or state transitions

## Before You Change Anything

Read these files first:

- `README.md`
- `INSTALL.md`
- `docs/artifact-contract.md`
- `docs/state-machine.md`
- `docs/release-checklist.md`

If your change affects workflow behavior, also read:

- `skills/workflow-start/SKILL.md`
- `skills/contract-builder/SKILL.md`

## Repository Conventions

### 1. Preserve self-contained ownership

Do not turn `spec-superflow` into a runtime wrapper that depends on separately installed OpenSpec or Superpowers packages.

It can learn from those systems, but this repository should remain self-contained.

### 2. Keep planning and execution distinct

Planning artifacts define the change.

`execution-contract.md` is the formal bridge into implementation.

Do not blur these roles.

### 3. Examples must be complete

If you add an example under `docs/examples/<change-name>/`, include:

- `README.md`
- `proposal.md`
- `specs/`
- `design.md`
- `tasks.md`
- `execution-contract.md`

### 4. Repository Artifact Boundaries

`docs/examples/` is the public location for complete example change sets.
The following root-local paths are working artifacts and must remain local and
uncommitted:

- `changes/`
- `.superpowers/`
- `docs/superpowers/`
- `contest-2026/`
- `scripts/sdd-workspace/`

### 5. Prefer operational wording

Skill text should help an agent decide:

- when to trigger
- what to inspect
- what to block
- what to do next

Avoid vague motivational language when an operational rule would be clearer.

## Pull Request Guidance

When opening a change, explain:

- what problem you are solving
- which workflow stage or artifact is affected
- whether any behavior, trigger logic, or guardrails changed
- whether docs and examples were updated to match

## Quality Checklist

Before submitting:

- remove placeholder text like `TODO` or `TBD`
- verify all markdown links still make sense
- keep README and README.zh-CN aligned when behavior changes
- keep example indexes aligned with actual example folders
- update `CHANGELOG.md` for user-visible repository changes
- review `docs/release-checklist.md` if the change affects release readiness

## Large Changes

If you want to make a major workflow or architecture change, start by writing a design note in:

- `docs/`

Then update the relevant skills, templates, and examples together so the repository stays coherent.
