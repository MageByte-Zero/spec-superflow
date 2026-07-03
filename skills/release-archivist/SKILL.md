---
name: release-archivist
description: Close out a spec-superflow change with verification, summary, and archive readiness. Invoke when implementation is complete, verification is underway, or the user asks for a final wrap-up.
---

# Release Archivist

Use this skill to finish a `spec-superflow` change cleanly.

## Use This Skill When

Invoke this skill when the user says things like:

- "wrap this up"
- "give me the final summary"
- "is this ready to close"
- "what remains before we ship"
- "prepare the handoff"

## The Iron Law: Verification Before Completion

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

Claiming work is complete without verification is dishonesty, not efficiency.

**Violating the letter of this rule is violating the spirit of this rule.**

If you haven't run the verification command in this session, you cannot claim anything passes.

### The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim

Skip any step = lying, not verifying
```

### Forbidden Words

These words MUST NOT appear in your output until AFTER verification evidence is presented:

- "should" (as in "tests should pass")
- "probably" (as in "it probably works")
- "seems to" (as in "it seems to be done")
- "Great!" / "Perfect!" / "Done!" (before verification output)
- Any expression of satisfaction without evidence

### Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "Linter passed" | Linter ≠ compiler |
| "Partial check is enough" | Partial proves nothing |
| "Different words so rule doesn't apply" | Spirit over letter |

## Verification Evidence Requirements

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, logs look good |
| Bug fixed | Test original symptom: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | Test passes once |
| Requirements met | Line-by-line checklist | Tests passing |

## Responsibilities

1. verify that the approved behavior was actually implemented
2. summarize what changed
3. identify remaining risks or follow-up work
4. prepare the change for archive or handoff
5. check for delta specs that need syncing

## Required Inputs

Read:

- `execution-contract.md`
- `tasks.md`
- relevant `specs/`
- change summary notes, if any

## Verification Steps

### Step 1: Test Suite Verification (Correctness)

Run the full test suite. Record:
- Total tests, passed, failed, skipped
- Zero failures required for PASS
- Any failure = CRITICAL finding in Correctness dimension

### Step 2: Completeness Verification

Compare the execution contract's task batches against the actual diff:
1. List all tasks from the execution contract
2. For each task, verify a corresponding code change exists in the diff
3. For each SHALL/MUST requirement in specs, verify at least one implementation artifact
4. Missing items = CRITICAL findings in Completeness dimension

### Step 3: Coherence Verification

Compare design.md decisions against the implementation:
1. Extract each decision's Choice from design.md
2. Verify the choice is reflected in the code (naming, patterns, architecture)
3. Check naming consistency between specs and implementation
4. Inconsistencies = IMPORTANT findings in Coherence dimension

### Step 4: Unintended Scope Detection

Check the diff for unplanned changes:
- Files modified that are not in the execution contract's scope fence
- New dependencies added that are not in the design's constraints
- Unplanned changes = WARN findings in Completeness dimension

### Step 5: Verification Report

Produce a structured report:

| Dimension | Status | Findings |
|-----------|--------|----------|
| Completeness | PASS/FAIL/WARN | [list] |
| Correctness | PASS/FAIL/WARN | [list] |
| Coherence | PASS/FAIL/WARN | [list] |

**Overall verdict**: PASS (all PASS) / CONDITIONAL (WARN only) / FAIL (any FAIL)

If FAIL → do not claim completion. Fix issues or route back to build-executor.
If CONDITIONAL → present WARN findings to user, proceed only with explicit acceptance.
If PASS → proceed to final checks.

## Final Checks

- Are required tests passing? (cite the command and output)
- Are execution batches complete? (cite batch-by-batch status)
- Was any scope added without artifact updates? (cite specific files if yes)
- Are there unresolved blockers or known risks?
- Is the change ready to archive, or should it remain active?
- Do delta specs exist that need merging into main specs?
- **Has `ssf audit <change-dir>` been run?** If not, run it now and include `decision-point-audit.md` in the archive.

## Decision-Point Audit Report

Before final closure, run:

```bash
ssf audit <change-dir>
```

This generates `changes/<change-dir>/decision-point-audit.md` from `.spec-superflow.yaml`. Include this report in the archive so the full decision history is preserved.

- If the audit report is missing, prompt the user to run `ssf audit <change-dir>` before DP-7 confirmation.
- The audit command is read-only and safe to run multiple times.

### DP-6 Record (Verification Outcome)

After presenting the verification report to the user:

```bash
ssf state set <change-dir> dp_6_result "<pass|conditional|fail>: <summary>"
ssf state set <change-dir> dp_6_timestamp $(date -u +%Y-%m-%dT%H:%M:%SZ)
```

If DP-6 is "fail", do NOT proceed to DP-7 — route back to `build-executor` or ask the user whether to abandon.

### DP-7 Record (Archive Confirmation)

After the user confirms the archive:

```bash
ssf state set <change-dir> dp_7_result "confirmed: <archive summary>"
ssf state set <change-dir> dp_7_timestamp $(date -u +%Y-%m-%dT%H:%M:%SZ)
```

Before DP-7, verify that all required DPs (DP-0 through DP-6) are recorded. If any are missing, flag them to the user.

## Exception Handling

- **Parse failures**: If `execution-contract.md` or any artifact cannot be parsed for verification, report the exact file and section.
- **Missing files**: If `decision-point-audit.md` cannot be generated, run `ssf audit` manually and report any errors.
- **User interruption**: The change state in `.spec-superflow.yaml` enables recovery. On resume, re-run verification from the beginning.
- **DP gap detection**: If any required DP (DP-0 through DP-6) is missing from `.spec-superflow.yaml`, flag it during DP-6 and ask the user whether to proceed or return to the missing DP's phase.

## Output

1. Verification report table (three dimensions with status and findings)
2. Overall verdict
3. If PASS: summary of all contract obligations met
4. If CONDITIONAL: list of accepted warnings
5. Risks and follow-ups
6. Archive readiness assessment

## Archive Rule

Do not archive blindly.

If implementation diverged from the contract, return to `bridging` before closure.

## Post-Verification Routing

After verification completes:

1. Run: `node scripts/spec-superflow.mjs state transition <change-dir> closing`
2. This updates `.spec-superflow.yaml` with `state: closing` and records the transition
3. If delta specs were created, route to `spec-merger` before final archiving
4. If no delta specs exist, the change is ready to archive

The closure is not complete until delta specs are merged. Specs that aren't synced become lies.

## Output Standard

Your response should include:

1. verification evidence (command run, output excerpt, exit code)
2. contract obligation status (which passed, which didn't)
3. delivered behavior summary
4. residual risks
5. delta spec status (exist or not)
6. recommended routing (to `spec-merger` or archive)

## Lightweight Closure (hotfix/tweak mode)

When workflow is `hotfix` or `tweak`, release-archivist performs lightweight verification:
1. Verify all changed files exist and are non-empty
2. Run syntax check on code files (`node --check` for .mjs/.js)
3. Skip the full 5-step three-dimensional verification
4. Still record DP-6 (验证失败) and DP-7 (归档确认) decision points
5. Delta specs are NOT generated in lightweight closure (no specs to sync)

Reference: `docs/decision-points.md` → DP-6, DP-7
