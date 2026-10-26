# Legacy workflow recovery

Load this reference for existing legacy plans or workflow-selection receipts with schema 1/2, including Quick/Hotfix/Lightweight records with `workflow_variant: direct`. Current v2 direct requires a valid receipt `schema_version: 3`; current planned requires `workflow_variant: planned` and an execution plan `schema_version: 2`. New requests use the primary skills. Variant or internal `workflow: full` alone cannot identify a legacy change. Missing or corrupt evidence must be recovered, never treated as permission to downgrade.

Run the bundled CLI as defined in the invoking skill: replace `SSF` with `node "<plugin-root>/scripts/spec-superflow.mjs"`. Preserve recorded state, approvals, receipts and isolation. Missing or corrupt recovery evidence requires diagnosis, not reinitialization or automatic migration. Read only the section matching the current skill; these rules do not add gates to v2 changes.

## workflow-start

Do not convert an active legacy change or discard its receipts automatically. Resume its recorded obligations: Full/legacy Hotfix may still need contract-builder and old approval/review gates; old Quick/Tweak/Lightweight/direct Hotfix use their existing receipts. Read docs/decision-points.md only for the applicable old decision, not for every task. Use `SSF runtime asset read docs/state-machine.md` only when a legacy transition is unclear. Legacy `SSF state init` precedes `SSF workflow recommend`; a nonrecommended choice requires acknowledgment. Legacy Quick/direct Hotfix use `workflow accept --verification` and persist `test_result: pass` before closing; use `SSF state set <change-dir> dp_0_timestamp now` for portable timestamps.

Missing/stale Full plans block implementation, not investigation. Valid short paths and Tweak do not require plans.

## need-explorer

Use need-explorer's scope exploration and self-checks, then apply this recorded approval gate.

After user confirms the summary:
```bash
SSF state set <change-dir> dp_1_result "confirmed: <one-line summary>"
SSF state set <change-dir> dp_1_timestamp now
```
DP-1 confirms scope, non-goals, and success criteria before artifact creation.

#### 7. Hand Off

Once DP-1 is recorded, hand off to `spec-writer`.

## spec-writer

Read `.spec-superflow.yaml` (especially `dp_0_decisions`, `dp_0_confirmed`) and any existing planning artifacts. If `dp_0_confirmed` is not `true`, stop and route back to `workflow-start` for DP-0.

### Config Check

Run: `SSF runtime config --get artifacts.order` — generate in configured order (default: proposal → specs → design → tasks). Run with `artifacts.skip` — skip any listed artifacts.

### Artifact Roles

- `proposal.md`: why and scope
- `specs/`: required behavior (testable)
- `design.md`: architecture decisions and trade-offs (not line-by-line)
- `tasks.md`: dependency-aware implementation steps

### Working Rules

**Honor DP-0**: Read `dp_0_decisions`, respect confirmed constraints, don't silently expand scope. Pause on unconfirmed decisions.

#### proposal.md
Must state: observed problem, what changes, in/out scope, impact areas, and proof of completion. Prefer concrete facts over empty adjectives such as “better”, “robust”, or “efficient”.

#### specs/
Every requirement must be testable. Use SHALL or MUST. Every requirement must have at least one `#### Scenario:` with WHEN/THEN. Group under ADDED/MODIFIED/REMOVED Requirements headers.

#### design.md
Must have: relevant facts and constraints, goals and non-goals, decisions (Choice + Rationale + Alternatives + Consequences), and risks with verification evidence. Do not invent stakeholders, migration steps, or open questions when they do not affect the decision.

#### tasks.md
Must include a delivery/proof map and dependency-aware tasks. Each task names the affected path or bounded area, the observable outcome, and the evidence command. Keep RED/GREEN details, review receipts, and dispatch mechanics in the execution contract/task brief; do not inflate reader-facing tasks into five ritual substeps.

### Artifact Generation

Enter `specifying` before creating or editing planning artifacts: run `SSF state transition <change-dir> specifying` only if not already there. On resume, continue incomplete artifacts; do not self-transition. Full planning may omit specs only for explicitly unchanged behavior, and may omit design by configuration. Full cannot skip tasks: correct this configuration before generating the pack.

When DP-0 has made the scope clear, generate the configured planning pack (proposal, delta specs from `templates/spec.md`, design, and tasks) in order without pausing between individual artifacts. Validate the pack, then request one DP-2 review. Pause earlier only when the missing decision can change user-visible behavior, compatibility, security, delivery scope, or the selected design; or when artifacts state incompatible scope.

### Validation Checklist

#### proposal.md
- `## Why` > 50 chars, `## What Changes`, `## Scope` (In/Out), `## Impact`, no TBD/TODO; claims name an observed problem and a completion proof

#### specs/
- SHALL/MUST for required behavior, `#### Scenario:` with WHEN/THEN per requirement, grouped under delta headers, no contradictions

#### design.md
- facts/constraints, goals/non-goals, `## Decisions` (≥1, with Choice+Rationale+Alternatives+Consequences), risks and verification

#### tasks.md
- delivery/proof map, numbered tasks, affected paths or bounded areas, observable outcomes, no placeholders, every requirement mapped, explicit dependencies
- Must use the template checkbox format (one `- [ ]` per task on its own line); the guard enforces this format when entering execution

**If any artifact fails validation, fix before handing off to contract-builder.**

### DP-2: Artifact Review Gate

Present a concise summary of the configured artifacts. Self-check five questions once: problem, command boundary, invalidation boundary, continuation boundary, and document flow. Do not dispatch a blind-reader subagent unless the user explicitly requested delegation. Reuse approval already covering these artifacts; ask one consolidated question only for a new material decision or missing artifact approval. Do not add a separate continuation question. After approval:
```bash
SSF state set <change-dir> dp_2_result "approved: <summary>"
SSF state set <change-dir> dp_2_timestamp now
```

After DP-2 is recorded, remain in `specifying` and continue to contract-builder.

### Handoff Rule

Do not start implementation after writing planning artifacts. Once stable, validated, and DP-2 is recorded, hand off to `contract-builder`.

### Exception Handling

- **Parse failures**: Report specific file/error; don't generate from corrupted templates
- **Missing templates**: Fall back to artifact structure defined in this skill
- **User interruption**: Artifacts on disk are the recovery checkpoint; resume from first missing/incomplete one
- **Validation failure**: Fix before handoff — do not hand off broken artifacts

## build-executor

Full/legacy Hotfix read the approved execution contract and linked requirements for the current task. Quick/direct Hotfix/Tweak read their bounded request and verification strategy; Lightweight follows its receipt's focused review requirements.

Legacy Full/Hotfix run `SSF isolate <change-dir>` before edits and use the returned absolute checkout path for every command. The default is a feature branch in the current checkout; create a worktree only when the user explicitly selects `--worktree`. Failure blocks edits in protected branches; preserve an existing isolation and diagnose initialization failures. Direct paths do not require isolation or physical finish.

For legacy Full, honor DP-3 approval. When the record is missing but the user explicitly approved this exact contract in the conversation, persist that existing decision and continue. Never infer approval of unseen or changed behavior, or request the same unchanged approval again. Enter `executing` only with a current plan and passing guard; skip the transition if already executing.

### Native first

Native means the current agent implements continuously; persisted mode is `inline`. Task count, file count and number of waves do not justify delegation. `batch-inline` remains compatible serial execution. Select SDD only when the user explicitly chooses delegation for this change and independently scoped work has a concrete benefit. Tool availability, many tasks, a long context, or generic implementation approval never authorize subagents. This includes reviewer and exploratory subagents.

For legacy Full/Hotfix paths requiring a plan only:

```bash
SSF execution recommend <dir> --wave <id>:serial:<task,...>[:<dependencies>] --json
SSF execution plan <dir> --mode inline --review-policy final --confirm --reason "<authorized choice>" --wave <id>:serial:<task,...>[:<dependencies>]
```

Reuse the user's existing mode choice. For a nonrecommended choice add `--acknowledge-recommendation`. New Native plans default to `final` review; SDD defaults to `wave`. `--review-policy wave` is available for explicit risk boundaries. Old plans with no policy retain wave review obligations. Mode and review granularity are separate.

Use `SSF execution show <dir> --json` to resolve uncertainty, interruptions and repair status, not as a ritual before every edit. A Native wave's dependencies are completed tasks; checked tasks never substitute for the final whole-range review.

### One bounded preflight

Before the first edit, inspect only shared producer/consumer interfaces and the test entry points the approved tasks depend on. Check that named symbols, payload fields and acceptance tests can be located. Record mismatches in the existing progress entry; resolve implementation details within approved behavior. Ask only when resolving a mismatch changes behavior, scope, permissions or external effects. Do not dispatch an exploration agent or create another planning pack for this check.

### Implementation loop

1. Implement tasks in dependency order. Full/legacy Hotfix use a failing behavioral regression, confirm RED, make the minimal fix, then confirm GREEN. Documentation changes use format/link/build checks instead of invented unit tests.
2. Run affected tests per task, integration tests at meaningful boundaries, and the required complete checks once at the final code snapshot. Reuse a result only when code, environment and command match; changes invalidate affected evidence.
3. Mark completed tasks and append a brief progress entry: outcome, files/commit, verification, next action, unresolved risk. Do not create a task book, delivery report and checkpoint for every small task. Save `SSF checkpoint save` when interruption or long-running work needs recovery.
4. Continue without requesting permission between authorized tasks. A pending task or review is not a reason to end the controller turn. Reuse existing authorizations; never ask “continue?” for the next authorized task. Give concise progress commentary; do not promise autonomous background execution.

Legacy changes may enter `debugging` and use bug-investigator. Expected RED is test evidence, not an unexpected defect. Scope changes rewind Full to specifying; contract drift to bridging. Short paths refresh their risk receipt instead of inventing a contract.

Read `SSF runtime asset read skills/build-executor/writing-good-tests.md` when selecting uncertain test evidence.

### Reviews

For Native `final`, the current executor performs one whole-range review after implementation and required tests, covering spec compliance and code quality. Do not start a reviewer subagent. Commit the code and bind the report to its actual Git range. Record through:

```bash
SSF execution review <dir> --wave final --base <base-sha> --head <head-sha> --report .superpowers/sdd/reviews/final.md --verdict <pass|fail>
```

For `wave`, review once per planned wave, using its ID instead of `final`; dependencies require a current passing receipt. SDD may use one reviewer subagent per wave because the user authorized delegation. Do not add per-task and final duplicates. Critical/Important findings require fail → focused repair → one focused re-review → pass.

Read the CLI repair status before a retry. Never edit repair-state files. In new plans, record a stable `--issue <finding-id>` on failed reviews and keep that ID for the same unresolved defect. Three failures for that issue require human adjudication; different findings do not share the budget. Legacy plans retain their recorded aggregate budget; `SSF execution adjudicate <dir> --wave <id> --decision allow-review --confirm --reason <text>` authorizes one further review, never a pass. Preserve the prior review head so repair ranges remain continuous. For a final review, re-review the original complete range plus fixes when needed to certify the final snapshot.

### Optional SDD

Only load dispatch material when SDD is selected. Load the reviewer prompt only when a wave reaches review:

- `SSF runtime asset read skills/build-executor/implementer-prompt.md`
- `SSF runtime asset read skills/code-reviewer/code-reviewer-prompt.md`

Send only the task's objective, bounded files, interfaces, relevant requirement IDs and test command. Reuse an implementer for its focused repair; no nested delegation or repeated full planning packs. Batch closely related small tasks. Dispatch concurrently only for independent work with platform support; otherwise report the limitation and execute serially.

Profiles: `mechanical`, `standard`, `strong`, `review`. Resolve `SSF runtime config --resolve-model <profile>` once per role. Pass the configured model if supported. With `configured: false`, inherit the host model; do not invent a model or block execution. Retry blocked work only with new evidence, context or strategy; after three unresolved attempts use DP-5.

### Plan correction and completion

Nonsemantic planning corrections use `SSF execution resync <dir> --confirm --reason <text>`, including during an open repair chain; history and failure counts remain binding. Semantic scope changes require reapproval and `execution revise`. Revisions may retain or change the authorized mode. Old receipts remain history and do not automatically certify changed scope or a new final snapshot.

Before completion, satisfy contract obligations, tests and the plan's review policy. Record `batches_completed` when useful. Route to release-archivist for the recorded legacy closure path. Merge, push or publication require their own existing authorization.

Quick/direct Hotfix persist `test_result: pass` after bounded verification; Hotfix must demonstrate the original symptom is fixed. Tweak verifies file integrity. They do not require DP-4, execution plans, wave receipts, DP-6 or DP-7. Lightweight additionally persists the focused review and passing command required by its receipt.

Quick follows the verification strategy persisted in its receipt. Tweak skips TDD. Full and legacy Hotfix use RED → GREEN → REFACTOR.

## bug-investigator

Use the four investigation phases in bug-investigator, then apply the recorded debugging state and ledger requirements below.

3+ failed fixes = architectural problem. Each fix revealing new problems elsewhere = wrong architecture.

After every failed fix, preserve its failure output in a physical file inside the change directory, then record the distinct attempt:

Full and legacy Hotfix require a current, valid execution plan before this command; establish one with `SSF execution recommend` and `SSF execution plan` if needed. Quick, Tweak, lightweight, and direct Hotfix keep their planless contract: their valid workflow receipt authorizes debugging, and the ledger binds attempts to that receipt plus the current workflow, artifact, and contract hashes. The debug command rejects a missing or replaced receipt or a stale required plan.

```bash
SSF debug attempt record <change-dir> \
  --id <unique-attempt-id> \
  --summary "<what was tried and why it failed>" \
  --evidence <change-local-failure-log>
```

Use `SSF debug attempt show <change-dir> --json` to present the complete attempt ledger. Wave Review repair failures are separate evidence and never count as debugging attempts.

After at least three distinct evidence-backed attempts, stop and discuss the architectural decision with the user. Only after the user explicitly chooses may DP-5 be recorded:

```bash
SSF debug escalate <change-dir> \
  --decision <continue|abandon> \
  --reason "<user-confirmed decision>" \
  --confirm
```

Never write `dp_5_*` through raw `SSF state set`; those fields are guarded by the debug ledger. If the user chooses `abandon`, transition to `abandoned` only after the guarded DP-5 receipt is recorded.

## release-archivist

Quick/direct Hotfix/Tweak record changed files, focused command and result, persist `test_result: pass`, then transition to closing. Hotfix must prove the original symptom fixed. Lightweight also needs its receipt's focused review and passing verification evidence. These paths require no contract, execution plan, wave reviews, audit, DP-6/DP-7 or `SSF finish`.

### Full / legacy Hotfix

1. Verify the final code snapshot with required build/test/validation commands. Reuse fresh results only when the code, environment and command are identical; don't rerun the same full suite just because the skill changed.
2. Check contract coverage, design consistency, scope and unresolved findings against the actual diff. Cite commands/results; do not infer success from edits or unchecked claims.
3. Require the current plan's review policy: one final whole-range review for Native `final`, or the required wave receipts for `wave`/legacy plans. Do not request a duplicate review of unchanged evidence.
4. Synchronize actual delta specs using spec-merger while executing. If specs were explicitly omitted and no delta exists, don't recreate them.
5. Run `SSF audit <dir>` and record verification outcome (`dp_6_result`, timestamp and `test_result`). Record DP-7 only with the user's archive authorization already obtained or explicitly requested. Do not fabricate missing decisions.
6. With blockers resolved, run `SSF state transition <dir> closing`. This is logical closure; it does not claim merge or cleanup succeeded.

Report only the outcome, key verification, unresolved risks and next action. Preserve the approved contract and implementation evidence; don't copy all planning files into a second summary.

### Physical finish

For authorized Full/legacy Hotfix integration, run `SSF finish <dir> [--test-cmd <command>]`. It uses recorded target checkout/branch, merges if necessary, verifies the target, and safely removes isolation. It verifies an archive of ignored change artifacts and preserves the previous target before cleanup. It never force-removes uncommitted work. Branch-only isolation never deletes the checkout.

Verification failure preserves isolation. For recorded `verify-pending`, recovery offers the guarded `closing -> debugging` transition; diagnose, repair within approved scope, reverify and review before closing again. Completed finish and abandoned changes cannot reopen. Cleanup failure remains cleanup-pending. Resume performs the remaining steps; each unfinished finish retry verifies once again because ignored dependencies, local configuration and external services may have changed even at the same HEAD. Completed finish does not rerun verification. Completed finish is idempotent. A missing or ambiguous target is a real blocker: recover provenance before merging, never guess the target from the current directory.

If the user requested branch delivery without merging, leave the branch/worktree intact and report that status. Do not treat logical closure as permission to merge, push or release.

Use `SSF state set <change-dir> dp_6_timestamp now` and `SSF state set <change-dir> dp_7_timestamp now` when recording those decisions.
