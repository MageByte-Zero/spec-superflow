---
name: build-executor
description: Govern implementation from an approved execution contract. Invoke when execution-contract.md is approved and the user wants disciplined build work, TDD execution, or guarded batch-by-batch implementation.
---

# Build Executor

Read the workflow receipt first. Full/legacy Hotfix require the approved execution contract; read linked requirements/design only for the current task. Quick/direct Hotfix/Tweak use their bounded request and verification strategy. Lightweight follows its receipt's focused review and verification requirements.

## Preflight

Full/legacy Hotfix run `ssf isolate <change-dir>` before edits and use the returned absolute worktree path for every command. Failure blocks edits in protected branches; preserve an existing isolation and diagnose initialization failures. Direct paths do not require isolation or physical finish.

For Full, honor DP-3 approval. Do not reconstruct permission from chat when the record is absent, and do not request approval again when already recorded. Enter `executing` only with a current plan and passing guard; skip the transition if already executing.

## Native first

Native means the current agent implements continuously; persisted mode is `inline`. Task count, file count and number of waves do not justify delegation. `batch-inline` remains compatible serial execution. Select SDD only when independently scoped delegation has a concrete benefit and the user has authorized it.

```bash
ssf execution recommend <dir> --wave <id>:serial:<task,...>[:<dependencies>] --json
ssf execution plan <dir> --mode inline --review-policy final --confirm --reason "<authorized choice>" --wave <id>:serial:<task,...>[:<dependencies>]
```

Reuse the user's existing mode choice. For a nonrecommended choice add `--acknowledge-recommendation`. New Native plans default to `final` review; SDD defaults to `wave`. `--review-policy wave` is available for explicit risk boundaries. Old plans with no policy retain wave review obligations. Mode and review granularity are separate.

Use `ssf execution show <dir> --json` to resolve uncertainty, interruptions and repair status, not as a ritual before every edit. A Native wave's dependencies are completed tasks; checked tasks never substitute for the final whole-range review.

## Implementation loop

1. Implement tasks in dependency order. Full/legacy Hotfix use a failing behavioral regression, confirm RED, make the minimal fix, then confirm GREEN. Documentation changes use format/link/build checks instead of invented unit tests.
2. Run affected tests per task, integration tests at meaningful boundaries, and the required complete checks once at the final code snapshot. Reuse a result only when code, environment and command match; changes invalidate affected evidence.
3. Mark completed tasks and append a brief progress entry: outcome, files/commit, verification, next action, unresolved risk. Do not create a task book, delivery report and checkpoint for every small task. Save `ssf checkpoint save` when interruption or long-running work needs recovery.
4. Continue without requesting permission between authorized tasks. A pending task or review is not a reason to end the controller turn. Give concise progress commentary; do not promise autonomous background execution.

If a real defect is encountered, enter `debugging` and use bug-investigator. Expected RED is test evidence, not an unexpected defect. Scope changes rewind Full to specifying; contract drift to bridging. Short paths refresh their risk receipt instead of inventing a contract.

Read `ssf runtime asset read skills/build-executor/writing-good-tests.md` when selecting uncertain test evidence.

## Reviews

For Native `final`, the current executor performs one whole-range review after implementation and required tests, covering spec compliance and code quality. Do not start a reviewer subagent. Commit the code and bind the report to its actual Git range. Record through:

```bash
ssf execution review <dir> --wave final --base <base-sha> --head <head-sha> --report .superpowers/sdd/reviews/final.md --verdict <pass|fail>
```

For `wave`, review once per planned wave, using its ID instead of `final`; dependencies require a current passing receipt. SDD may use one reviewer subagent per wave because the user authorized delegation. Do not add per-task and final duplicates. Critical/Important findings require fail → focused repair → one focused re-review → pass.

Read the CLI repair status before a retry. Never edit repair-state files. The third unresolved failure requires human adjudication; `ssf execution adjudicate <dir> --wave <id> --decision allow-review --confirm --reason <text>` authorizes one further review, never a pass. Preserve the prior review head so repair ranges remain continuous. For a final review, re-review the original complete range plus fixes when needed to certify the final snapshot.

## Optional SDD

Only load dispatch material when SDD is selected. Load the reviewer prompt only when a wave reaches review:

- `ssf runtime asset read skills/build-executor/implementer-prompt.md`
- `ssf runtime asset read skills/code-reviewer/code-reviewer-prompt.md`

Send only the task's objective, bounded files, interfaces, relevant requirement IDs and test command. Reuse an implementer for its focused repair; no nested delegation or repeated full planning packs. Batch closely related small tasks. Dispatch concurrently only for independent work with platform support; otherwise report the limitation and execute serially.

Profiles: `mechanical`, `standard`, `strong`, `review`. Resolve `ssf runtime config --resolve-model <profile>` once per role. Pass the configured model if supported. With `configured: false`, inherit the host model; do not invent a model or block execution. Retry blocked work only with new evidence, context or strategy; after three unresolved attempts use DP-5.

## Plan correction and completion

Nonsemantic planning corrections use `ssf execution resync <dir> --confirm --reason <text>`, including during an open repair chain; history and failure counts remain binding. Semantic scope changes require reapproval and `execution revise`. Revisions may retain or change the authorized mode. Old receipts remain history and do not automatically certify changed scope or a new final snapshot.

Before completion, satisfy contract obligations, tests and the plan's review policy. Record `batches_completed` when useful. Route to release-archivist; merge, push or publication require their own existing authorization.

Quick/direct Hotfix persist `test_result: pass` after bounded verification; Hotfix must demonstrate the original symptom is fixed. Tweak verifies file integrity. They do not require DP-4, execution plans, wave receipts, DP-6 or DP-7. Lightweight additionally persists the focused review and passing command required by its receipt.

Quick follows the verification strategy persisted in its receipt. Tweak skips TDD. Full and legacy Hotfix use RED → GREEN → REFACTOR.
