---
name: workflow-start
description: Primary entry point for the spec-superflow state-machine workflow. Invoke only when the user explicitly requests spec-superflow or an active change contains .spec-superflow.yaml and the user asks to continue that change. Generic proposal, specs, design, task, or contract files are not activation signals.
---

# Workflow Start

Use only for an explicit spec-superflow request or an existing change. Ordinary coding does not require a spec workflow.

## Resume

Run `ssf resume <change-dir> --json` once. It combines state, handoffs, checkpoints and current-plan inspection. Use the returned absolute `change.path` for all subsequent operations: recovery may redirect a stale source copy into its recorded worktree. Follow `next_action`; do not repeat all component commands unless diagnosing that result. A blocked continuation is not a retry instruction; resolve its named cause before running it again. Read only the artifacts relevant to the next action.

- `debugging`: diagnose first, even if a plan is stale. Never dispatch an eligible wave during diagnosis.
- `closing`: logical completion. If a recorded isolation still has physical finish pending, route to release-archivist for that remaining action, subject to existing merge authorization. Otherwise stop.
- `abandoned`: stop.
- A ready handoff needs review through `ssf handoff resolve`; an active handoff is non-blocking. Stale checkpoints are history, not current evidence.
- Missing/stale Full plans block implementation, not investigation. Valid short paths and Tweak do not require plans.

Update checks are optional (`ssf runtime check-update`), cached and non-blocking. Never make network access a recovery prerequisite.

## New request

Infer scope and risks from the request and repository. Ask only for facts that would change the decision; do not turn CLI fields into a questionnaire. Validate the change name as a single safe relative path segment under `changes/`, then `ssf state init <change-dir>` if absent.

Run `ssf workflow recommend` with observed task/file counts, config-doc-only, schema-api-change, new-module, behavioral-constraint-change, cross-module-change, uncertainty and request-kind. Show the recommendation and its reason briefly. Workflow path is separate from execution mode.

| Path | Boundary |
|---|---|
| Tweak | ≤4 config/doc-only tasks/files, no risk signals |
| Quick | ≤3 low-risk code tasks/files |
| Direct Hotfix | Incident, reproducible symptom, ≤2 tasks/files |
| Lightweight | Eligibility reported by CLI; confirmed scope, focused review and verification |
| Full | Requirements, cross-module behavior, uncertain design, or explicit user choice |

Handle bounded Quick/direct Hotfix in the same turn. Quick/direct Hotfix use `ssf workflow accept <dir> --source direct-request --verification <tdd|new-test|bounded>` with the user's verification choice. Full/Tweak/Lightweight use `workflow select --mode <mode> --confirm --reason <text>` and any receipt-required options. A nonrecommended choice requires acknowledgment. Reuse authorization already given; do not ask again. Legacy Hotfix without a direct receipt retains contract/DP-3/plan gates.

Direct paths must not create planning packs, contracts, execution plans or wave receipts. If scope grows, refresh observed facts and obtain the user's path choice; do not silently promote every issue to Full.

## Full intake and routing

Record one DP-0 summary covering intent, scope, constraints, workflow path and concrete `artifact_language`. Resolve language from explicit user preference, conversation, configured non-auto language, existing artifacts, then templates. Preserve prior decisions. Set `dp_0_decisions`, `dp_0_result`, `dp_0_confirmed`, `dp_0_timestamp` only after confirmation.

Route by the next missing obligation:

| State / need | Skill |
|---|---|
| Fuzzy intent | need-explorer |
| Planning artifacts | spec-writer |
| Approved plan needs contract | contract-builder |
| Approved contract / direct receipt | build-executor |
| Unexpected failure | bug-investigator |
| Review required by policy | code-reviewer |
| Verified work / pending finish | release-archivist |
| Delta synchronization before closing | spec-merger |

The destination skill enters its state **before** editing that stage's artifacts. Skip transitions already satisfied. Scope change returns Full to specifying; contract drift returns it to bridging, including from debugging. Do not bypass guards or modify state YAML manually.

Use `ssf runtime asset read docs/state-machine.md` or `docs/decision-points.md` only when the applicable rule is unclear. Honor configured artifact omissions; reject Full `tasks` omission before drafting. Never infer approval from artifact existence.

Continue authorized internal work without phase-by-phase handoff questions. Progress updates state the result and next action in one short paragraph. Request input only for missing material decisions or actual authorization boundaries.

Persist short-path `test_result: pass` before closing. Use `ssf state set <change-dir> dp_0_timestamp now` for portable timestamps.
