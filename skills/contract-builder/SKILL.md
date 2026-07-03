---
name: contract-builder
description: Convert approved planning artifacts into an execution contract. Invoke when the user wants to start building, asks to move from planning to implementation, or when `execution-contract.md` is missing or stale.
---

# Contract Builder

This skill is the defining layer of `spec-superflow`.

It converts planning artifacts into a single execution handshake:

- `execution-contract.md`

Use `templates/execution-contract.md` as the baseline structure.

## Use This Skill When

Invoke this skill when the user says things like:

- "now implement it"
- "we are ready to build"
- "turn this plan into execution rules"
- "prepare the handoff"
- "refresh the contract"
- "the spec changed, update the execution contract"

## Input Artifacts

Read:

- `proposal.md`
- `specs/`
- `design.md`
- `tasks.md`
- `docs/artifact-contract.md`

Do not rely on chat memory as a substitute for these files.

## Auto-Extraction via Artifact Parsing

When available, use structured artifact parsing to auto-extract contract fields. This produces a more accurate and complete contract than manual copying.

### Parse `proposal.md` for Intent & Scope

Extract by parsing the proposal's structure:

- **Intent Lock**: Read `## Why` section → compress into the "Problem being solved" field. Read `## What Changes` → compress into "In scope" list.
- **Scope Fence**: Read `## Scope > ### Out of Scope` → directly populate the "Out of scope" field.
- **Non-Goals**: Any explicit non-goals from the proposal → include verbatim.

### Parse `specs/` for Test Obligations

Extract by iterating through each spec file:

- **Approved Requirements Summary**: For each requirement with SHALL/MUST, extract the requirement name and a one-sentence summary.
- **Key Scenarios**: For each `#### Scenario:` block, extract the scenario name.
- **Acceptance Checks**: Each scenario's THEN clause becomes an acceptance check.
- **Test Obligations**: Any requirement that describes observable behavior → must start with a failing test.

### Parse `design.md` for Constraints

Extract by parsing the design's structure:

- **Architecture Constraints**: Read `## Decisions` → each decision's "Choice" becomes a constraint.
- **Interface Constraints**: Read `## Risks And Trade-Offs` → interface-related risks become constraints.
- **Dependency Constraints**: Read `## Context > Constraints` → dependency-related items become constraints.
- **Data Constraints**: Any data format, schema, or migration notes → capture as constraints.

### Parse `tasks.md` for Batches

Extract by parsing the task structure:

- **Execution Batches**: Group numbered tasks by their major section (1.x → Batch 1, 2.x → Batch 2).
- **Completion Definitions**: For each batch, derive "Done when" from the tasks' acceptance criteria.
- **Review Timing**: Identify natural review points between batches.

### Manual Extraction Fallback

If the parsing engine is unavailable (no Node.js or runtime constraints), manually extract using the mapping rules below. The manual extraction must be equally thorough — cross-check each extracted field against the source artifact.

## Mapping Rules

### From `proposal.md`

Extract:

- intent lock
- scope fence
- non-goals

### From `specs/`

Extract:

- approved behavior summary
- required scenarios
- test obligations

### From `design.md`

Extract:

- implementation constraints
- interface constraints
- dependency constraints

### From `tasks.md`

Extract:

- execution batches
- completion definitions
- review timing

## Cross-Check: Requirement Coverage

Before finalizing the execution contract, perform a coverage check:

1. List every requirement (SHALL/MUST statement) from `specs/`
2. Check each requirement against the contract:
   - Is it reflected in the **Approved Behavior** section?
   - Is there a corresponding **test obligation**?
   - Is it represented in at least one **execution batch** or **acceptance check**?
3. If a requirement is not covered by a test obligation or batch, **flag it** in the contract's "Escalation Rules" section.
4. If a requirement spans multiple batches, note the dependency in the batch descriptions.

**Output requirement**: The contract must explicitly state if any requirement could not be mapped. Do not silently drop requirements.

## Purpose

The execution contract is not a duplicate planning document.

It must compress planning into execution-ready rules:

- what cannot drift
- what must be tested first
- where review is mandatory
- when implementation must stop and return to planning

## Contract Writing Standard

The resulting `execution-contract.md` must make it obvious:

- what behavior is approved
- what is explicitly out of scope
- which constraints implementation must obey
- how work is grouped into execution batches
- which tests must fail first before code is written
- which conditions force a rewind to planning

Prefer compression and operational clarity over repeating every planning detail.

## Approval Model

This skill prepares implementation readiness. It does not silently authorize implementation.

After drafting or refreshing the contract:

1. summarize the important handoff rules
2. identify anything still ambiguous
3. highlight any requirements that could not be mapped to test obligations or batches
4. ask the user to approve the contract explicitly

Only after explicit approval may the workflow move to `build-executor`.

### DP-3 Record

After the user explicitly approves the execution contract:

```bash
ssf state set <change-dir> dp_3_result "approved: <one-line summary>"
ssf state set <change-dir> dp_3_timestamp $(date -u +%Y-%m-%dT%H:%M:%SZ)
```

DP-3 is a hard gate — implementation SHALL NOT begin without this record.

## Exception Handling

- **Parse failures**: If any planning artifact (`proposal.md`, `specs/`, `design.md`, `tasks.md`) cannot be parsed or has malformed sections, report the specific file and section. Suggest running `spec-writer` to regenerate the problematic artifact.
- **Missing files**: List every missing artifact explicitly. Do not generate incomplete contracts — route back to `spec-writer` for missing planning artifacts.
- **User interruption**: The contract file itself serves as the recovery checkpoint. On resume, re-read all planning artifacts and check if the existing contract is stale (content comparison, not timestamp).
- **Validation failure**: If the generated contract fails cross-check (unmapped requirements), flag them explicitly in the contract's Escalation Rules section and in the approval summary. Do not silently drop requirements.

## Stale Contract Detection

Refresh the contract if any of the following are true:

- scope changed in `proposal.md`
- approved requirements changed in `specs/`
- architecture or interface constraints changed in `design.md`
- execution batches changed materially in `tasks.md`
- the current contract no longer matches what the team intends to build

## Hotfix Mode: Minimal Contract

When workflow is `hotfix`, generate a minimal execution-contract.md containing only:
1. **Intent Lock** — one-sentence description of the change intent
2. **Task List** — numbered list of tasks to complete
3. **Approval Gate** — DP-3 prompt for user confirmation

Skip: Scope Fence, Build Rules, Review Gates, Test Evidence requirements.

The minimal contract still requires explicit user approval (DP-3) before execution begins.

Reference: `docs/decision-points.md` → DP-3

## Guardrails

- Do not continue to implementation if major ambiguity remains.
- Do not approve the execution contract on the user's behalf.
- After generating the contract, ask the user to review it.
- Implementation begins only after explicit approval.
- Do not skip `execution-contract.md` just because the planning docs look complete.
- Do not write production code inside this skill.
- If the coverage cross-check reveals unmapped requirements, flag them explicitly in the contract and in the approval summary.

## After Contract Generation

After `execution-contract.md` is written and validated:

1. Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/spec-superflow.mjs" state init <change-dir>`
2. This creates `.spec-superflow.yaml` with `artifacts_hash` and `contract_hash`
3. The state file enables fast staleness detection in subsequent phases

## Output Standard

Your response should include:

1. a brief statement that the bridge is being created or refreshed
2. the key intent lock and scope fence
3. the most important test obligations
4. the main review or rewind triggers
5. any requirements that could not be mapped to test obligations or batches (coverage gaps)
6. a direct request for user approval
