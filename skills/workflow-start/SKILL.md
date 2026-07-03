---
name: workflow-start
description: Primary entry point for the spec-superflow state-machine workflow. Invoke when the user is inside an active spec-superflow change directory (look for `.spec-superflow.yaml`, `changes/<name>/`, `proposal.md`, `specs/`, `design.md`, `tasks.md`, or `execution-contract.md`) and asks to start, continue, resume, implement, plan, or figure out the next workflow step. Also invoke when the user explicitly asks to start a new spec-superflow change or route through the spec-superflow workflow. Do not invoke for unrelated coding tasks that happen to use words like start, continue, implement, or plan.
---

# Workflow Start

This is the primary entry point for `spec-superflow`.

Its job is not to implement anything directly. Its job is to:

1. inspect the current change context
2. check whether the installed plugin is outdated and remind the user if so
3. confirm key decisions with the user before design (DP-0)
4. determine the current workflow state
5. route to the correct next skill
6. block invalid transitions

## Use This Skill When

Only invoke this skill when spec-superflow context is clearly present. Before invoking, verify that at least one of these conditions holds:

**Active change in progress (check the workspace):**
- `.spec-superflow.yaml` exists in the project
- Artifacts like `proposal.md`, `specs/`, `design.md`, `tasks.md`, or `execution-contract.md` are present
- The user is continuing/resuming a task that was previously managed through the spec-superflow workflow

**User explicitly invokes spec-superflow:**
- User mentions "spec-superflow" by name, or types `/spec-superflow:workflow-start`
- User explicitly asks to "start a spec-superflow change" or "route through the workflow"

**Do NOT invoke this skill when:**
- The user asks to "start", "continue", "implement", or "plan" a task that is NOT inside a spec-superflow managed change
- The user asks to write code, fix a bug, refactor, or implement a feature without spec-superflow artifacts present
- The user is asking a general question, making a casual request, or working on something unrelated

When in doubt, check for `.spec-superflow.yaml` first. If it doesn't exist and the user hasn't mentioned spec-superflow by name, do NOT invoke this skill — handle the request directly.

## Default States

- `exploring`
- `specifying`
- `bridging`
- `approved-for-build`
- `executing`
- `debugging`
- `closing`
- `abandoned`

Read `docs/state-machine.md` before making a state decision if the transition is ambiguous.

## Required Inspection

Before routing, inspect the current change folder if it exists.

Look for:

- `proposal.md`
- `specs/`
- `design.md`
- `tasks.md`
- `execution-contract.md`

Then answer these questions in order:

1. Is the change still fuzzy?
2. Are planning artifacts missing or unstable?
3. Does a bridge contract exist?
4. Has the user explicitly approved the contract for build work?
5. Is execution in progress or blocked by a bug?
6. Is the change already in verification or wrap-up?

## Update Check Reminder

Before doing anything else, run the update check script:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/check-update.mjs"
```

### How to surface the result

- Exit code 0 → no action, continue.
- Exit code 1 → prepend a non-blocking upgrade reminder to your response, then continue normally. Include the platform-appropriate command, e.g.:
  > 💡 A new version of spec-superflow is available. Upgrade with `/plugin update spec-superflow@spec-superflow`.
- Exit code 2 or script missing → silently skip.

Do not block workflow progress on an available upgrade; simply inform the user.

## DP-0: User Confirmation Gate (Design-Preparation)

Before routing to `spec-writer` for a new or incomplete change, confirm key decisions with the user. Do not generate planning artifacts until this gate is passed.

### When to run DP-0

Run DP-0 when **all** of the following are true:
- The change folder does not exist, OR
- Planning artifacts (`proposal.md`, `specs/`, `design.md`, `tasks.md`) are missing or empty, OR
- `.spec-superflow.yaml` does not contain `dp_0_confirmed: true`.

If `dp_0_confirmed` is `true`, skip this gate and proceed with normal state detection.

### Required Questions

Ask the user at least these questions. Record the answers in `.spec-superflow.yaml`.

1. **Scope**: What is the change name and one-sentence intent?
2. **Constraints**: Are there known constraints (naming style, compatibility policy, platforms affected)?
3. **Related optimizations**: Should this change include related optimizations (e.g., issue #5 Batch Inline) or stay focused?
4. **Communication preference**: Do you prefer to be asked before each design decision, or receive a draft for review?

### Recording DP-0

After the user confirms:

```bash
ssf state set <change-dir> dp_0_decisions "<summary>"
ssf state set <change-dir> dp_0_confirmed true
ssf state set <change-dir> dp_0_timestamp $(date -u +%Y-%m-%dT%H:%M:%SZ)
```

Then proceed to normal state detection and routing.

### Config-Aware Routing

Before routing, check project configuration:
- Run: `bash "${CLAUDE_PLUGIN_ROOT}/scripts/get-config" artifacts.order`
- If the config specifies a custom artifact order, follow it when checking artifact completeness
- Run: `bash "${CLAUDE_PLUGIN_ROOT}/scripts/get-config" artifacts.skip`
- If artifacts are in the skip list, do not require them for state transitions

## Mode Detection

Before routing, determine the workflow mode.

### Auto-Detection

If `.spec-superflow.yaml` workflow is `auto`, `null`, or unset:

1. Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/infer-workflow.mjs" <change-dir>`
2. The script inspects `proposal.md` scope and `tasks.md` to infer `hotfix`, `tweak`, or `full`.
3. Run: `ssf state set <dir> workflow <mode>` to persist the inferred mode.
4. Output the inferred mode and reason to the user.

Inference rules:

- **hotfix**: ≤2 tasks, ≤2 files, no schema/API changes, no new modules.
- **tweak**: ≤4 tasks, only config/doc files (`.md`, `.json`, `.yaml`, etc.), no schema/API changes, no new modules.
- **full**: anything larger, or changes that touch code files, schemas, APIs, or add new modules.

### Explicit Override

If workflow is already set to `hotfix`, `tweak`, or `full`, do **not** overwrite it unless the user explicitly asks to re-detect.

### Validation

After the mode is known, validate it against artifact content:

1. Run: `ssf state get <change-dir> workflow`
2. If workflow is `full` → standard routing (no fast-path)
3. If workflow is `hotfix`:
   - Validate: ≤2 files? No new modules? No schema changes?
   - All pass → use hotfix fast-path routing
   - Any fail → upgrade to `full`, run `ssf state set <dir> workflow full`, output upgrade reason
4. If workflow is `tweak`:
   - Validate: ≤4 files? Single module? Config/doc/prompt only?
   - All pass → use tweak fast-path routing
   - Any fail → upgrade to `full`, run `ssf state set <dir> workflow full`, output upgrade reason

### Example

- A one-line fix in `scripts/lib/cmd-doctor.mjs` with ≤2 tasks → infer `hotfix`.
- Updating `README.md` and `CHANGELOG.md` with ≤4 tasks → infer `tweak`.
- Adding a new platform inject path with new files, tests, and schema changes → infer `full`.

## Enhanced Stale Detection via Content Inspection

Do not rely solely on file existence to determine staleness. Inspect file **contents** to detect drift:

### Detecting stale `execution-contract.md`

Compare the **intent lock** in the contract against the current proposal:

- Open `proposal.md` and read the scope (## What Changes, ## Scope sections)
- Open `execution-contract.md` and read the **Intent Lock** section
- If the proposal's scope has expanded beyond what the contract's scope fence allows → **stale**
- If the contract references capabilities no longer in the proposal → **stale**

### Detecting stale planning artifacts

Compare the proposal's scope against spec files:

- Open `proposal.md` and note which capabilities are in scope
- Open `specs/<capability>/spec.md` for each listed capability
- If a proposal-listed capability has no spec file → **stale artifacts**
- If a spec file exists for a capability not in the proposal scope → **drift detected**

### Detecting stale spec vs. tasks

- Open `specs/` and list all requirement names (SHALL/MUST statements)
- Open `tasks.md` and check that each spec requirement is represented in at least one task
- If a requirement has no corresponding task → **stale tasks**

## Routing Rules

### Route to `need-explorer` when:

- the request is still fuzzy
- scope is unclear
- the user is comparing options
- there is no stable change name yet

### Route to `spec-writer` when:

- **Guard check**: If a change directory exists, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/guard/guard.mjs" check <dir> exploring specifying --json`
  - If exit code ≠ 0 → BLOCK. Report failures, do not route.
  - If exit code = 0 → proceed.
- the user knows what they want
- planning artifacts are missing or incomplete
- proposal, specs, design, or tasks need to be created or revised

### Route to `contract-builder` when:

- **Guard check**: Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/guard/guard.mjs" check <dir> specifying bridging --json`
  - If exit code ≠ 0 → BLOCK. Report failures (missing artifacts or schema validation errors), do not route.
  - If exit code = 0 → proceed.
- planning artifacts exist
- implementation is requested or about to begin
- the execution contract is missing or stale
- planning artifacts changed after the last contract draft

### Route to `build-executor` when:

- **Guard check**: Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/guard/guard.mjs" check <dir> approved-for-build executing --json`
  - If exit code ≠ 0 → BLOCK. Report failures (contract stale or artifacts missing), do not route.
  - If exit code = 0 → proceed.
- `execution-contract.md` exists
- the user has explicitly approved it
- implementation is the active task
- the contract still matches the current planning artifacts

### Route to `bug-investigator` when:

- execution is in the `executing` state but has hit a blockage
- a test failure, unexpected behavior, or build error has stopped progress
- the build-executor reports a task cannot proceed
- the user reports a bug during active implementation

After debugging completes, route back to `build-executor` to resume the executing state.

### Route to `code-reviewer` when:

- an execution batch has been completed
- the build-executor has finished a group of related tasks
- a full batch is ready for spec-compliance and code-quality verification
- the user asks for a review checkpoint

### Route to `release-archivist` when:

- **Guard check**: Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/guard/guard.mjs" check <dir> executing closing --json`
  - If exit code ≠ 0 → BLOCK. Report failures (unfinished tasks or missing test evidence), do not route.
  - If exit code = 0 → proceed.
- implementation is complete
- verification is complete or nearly complete
- the user wants a final summary, archive, or wrap-up

### Route to `spec-merger` when:

- release-archivist reports delta specs exist that need merging
- the change is closing and has ADDED/MODIFIED/REMOVED/RENAMED specs
- multiple changes have accumulated unsynced delta specs
- the user asks about spec consistency

### Route to abandoned state when:

- the user explicitly requests to abandon the change
- bug-investigator has escalated after 3+ consecutive fix failures AND the user chooses to abandon
- scope change during specifying makes the change no longer worthwhile AND the user confirms abandonment
- the current state is NOT `closing` or `abandoned` (terminal states block abandonment transition)

### Hotfix Fast-Path Routing

When workflow is `hotfix`:
- Route to `contract-builder` with minimal contract mode (intent + task list only)
- Skip `need-explorer` and full `spec-writer`
- Guard check: `node "${CLAUDE_PLUGIN_ROOT}/scripts/guard/guard.mjs" check <dir> exploring bridging --workflow hotfix --json`
- After bridge: DP-3 契约批准
- After approval: route to `build-executor` (inline mode)
- After execution: route to `release-archivist` (lightweight closure)

### Tweak Fast-Path Routing

When workflow is `tweak`:
- Route directly to `build-executor` (direct edit mode)
- Skip `need-explorer`, `spec-writer`, and `contract-builder`
- Guard check: `node "${CLAUDE_PLUGIN_ROOT}/scripts/guard/guard.mjs" check <dir> exploring approved-for-build --workflow tweak --json`
- After execution: route to `release-archivist` (lightweight closure: file exists + syntax check)

### Post-Transition Injection Prompt

After every successful `ssf state transition`, output:
> 💡 Run `ssf inject <change-dir>` to update phase-guard artifacts across platforms (Claude, Cursor, Copilot, Gemini).

To limit platforms, use `--platforms claude,cursor` or any subset.

## Staleness Rules

Treat `execution-contract.md` as stale if:

- `proposal.md` changed scope (confirmed by content comparison, not just timestamp)
- `specs/` changed approved behavior
- `design.md` changed architecture constraints
- `tasks.md` changed execution batches materially
- the contract's intent lock no longer matches the proposal's scope (content-level check)

If stale, do not continue implementation. Route back to `contract-builder`.

Treat planning artifacts as stale if:

- A requirement in `specs/` has no corresponding task in `tasks.md`
- A capability listed in `proposal.md` has no spec file
- The design references decisions no longer valid given current specs

## Guardrails

- Do not allow implementation before planning artifacts exist.
- Do not allow implementation before `execution-contract.md` exists.
- Do not treat "continue" as permission to skip state inspection.
- Do not allow continued implementation if scope or core behavior changed without artifact updates.
- If the user is in `executing` but the contract is stale, route backward to `contract-builder`.
- Do not allow implementation to continue past a bug without `bug-investigator` investigation.
- Do not move from execution batches to closure without code review first.
- Do not close a change with unsynced delta specs without routing to `spec-merger`.
- If the detected state is `debugging`, ensure `bug-investigator` completes before routing back.
- If the user asks to skip a review gate, explain why the gate exists and ask for confirmation.
- Do not allow any state transitions FROM `abandoned` — it is a terminal state.
- Do not allow transition to `abandoned` from `closing` or `abandoned` — these are already terminal.
- Do not auto-abandon without user confirmation — even if bug-investigator recommends it.
- When transitioning to `abandoned`, prompt for abandonment summary generation before confirming.
- Do not merge delta specs from an abandoned change — spec-merger must block this.

## Output Standard

Your response should always make three things explicit:

1. current detected state
2. why that state was chosen (cite the specific file, content, or condition that determined the state)
3. which skill should run next

If transition blocking is required, explain the missing artifact or approval clearly.

If content-level inspection was performed, include a brief note on what was compared (e.g., "Compared proposal scope (3 capabilities) against contract intent lock (2 capabilities) — contract is stale").

### Decision Point References

When routing to a skill that has an associated decision point, include the decision point number in the output:
- Route to contract-builder → include `DP-3: 契约批准 — 用户需明确批准 execution-contract.md`
- Route to build-executor → include `DP-4: 执行模式选择 — 用户选择 TDD 或 SDD`
- Route to bug-investigator (escalation) → include `DP-5: 调试升级`
- Route to release-archivist (verification failure) → include `DP-6: 验证失败 — 验证未通过时需用户决定`
- Route to release-archivist → include `DP-7: 归档确认`

Reference: `docs/decision-points.md`

## Preferred User Experience

- Keep the user on one visible workflow.
- Avoid making them choose between upstream mental models.
- Treat OpenSpec ideas as planning inputs and Superpowers ideas as execution discipline, but keep `spec-superflow` as the only workflow owner.

## Exception Handling

- **Parse failures**: If `.spec-superflow.yaml` is malformed, fall back to content-level detection (read artifact files directly). If artifacts themselves cannot be parsed, report the specific file and suggest running `spec-writer` or `contract-builder`.
- **Missing files**: If the change directory exists but critical files are missing, route to the skill that generates the missing files (e.g., missing `proposal.md` → route to `need-explorer` or `spec-writer`).
- **User interruption**: On session resume, re-inspect the change directory content (not cached state) to determine actual state. The content-level detection approach is designed to survive incomplete sessions.
