---
name: code-reviewer
description: Review completed implementation batches for spec compliance and code quality. Invoke after execution batches complete, before merging, or when a review gate is reached in the workflow.
---

# Code Reviewer

This skill unifies two review responsibilities: requesting review (dispatching a reviewer subagent with a precise brief) and receiving review (acting on feedback with technical rigor, not performative agreement).

**Core principle:** Review early, review often. Verify before implementing feedback. Technical correctness over social comfort.

---

## Part 1: Requesting Review

### When to Request Review

**Mandatory:**

- After each task in subagent-driven development (via build-executor)
- After completing a major feature
- After each execution batch
- Before merge to main

**Optional but valuable:**

- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing complex bug

### How to Request

**1. Get git SHAs:**

```bash
BASE_SHA=$(git rev-parse HEAD~1)  # or origin/main
HEAD_SHA=$(git rev-parse HEAD)
```

**2. Dispatch code reviewer subagent:**

Dispatch a `general-purpose` subagent using the template at `${CLAUDE_PLUGIN_ROOT}/skills/code-reviewer/code-reviewer-prompt.md`.

**Placeholders to fill:**

- `[DESCRIPTION]` — Brief summary of what was built
- `[PLAN_OR_REQUIREMENTS]` — What it should do (reference the execution-contract.md or relevant spec)
- `[BASE_SHA]` — Starting commit
- `[HEAD_SHA]` — Ending commit

**3. Act on feedback:**

- Fix Critical issues immediately
- Fix Important issues before proceeding
- Note Minor issues for later
- Push back if reviewer is wrong (with reasoning — see Part 2)

### Example

```
[Just completed Batch 1 of execution]

BASE_SHA=$(git log --oneline | grep "Before batch 1" | head -1 | awk '{print $1}')
HEAD_SHA=$(git rev-parse HEAD)

[Dispatch code reviewer subagent with code-reviewer-prompt.md]
  DESCRIPTION: Batch 1 — auth module with session tokens and test suite
  PLAN_OR_REQUIREMENTS: execution-contract.md Batch 1 obligations + specs/auth/spec.md
  BASE_SHA: a7981ec
  HEAD_SHA: 3df7661

[Subagent returns]:
  Strengths: Clean architecture, real tests
  Issues:
    Important: Missing error handling for expired tokens
    Minor: Magic number (3600) for session timeout
  Assessment: Needs fixes

[Fix Important issues]
[Continue to Batch 2]
```

### Red Flags — Requesting

**Never:**

- Skip review because "it's simple"
- Ignore Critical issues
- Proceed with unfixed Important issues
- Argue with valid technical feedback

**If reviewer is wrong:**

- Push back with technical reasoning
- Show code/tests that prove it works
- Request clarification

---

## Part 2: Receiving and Acting on Review Feedback

### The Response Pattern

```
WHEN receiving code review feedback:

1. READ: Complete feedback without reacting
2. UNDERSTAND: Restate requirement in own words (or ask)
3. VERIFY: Check against codebase reality
4. EVALUATE: Technically sound for THIS codebase?
5. RESPOND: Technical acknowledgment or reasoned pushback
6. IMPLEMENT: One item at a time, test each
```

### Three Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| **Critical** (Must Fix) | Bugs, security issues, data loss risks, broken functionality | Fix immediately before anything else |
| **Important** (Should Fix) | Architecture problems, missing features, poor error handling, test gaps | Fix before proceeding to next batch |
| **Minor** (Nice to Have) | Code style, optimization opportunities, documentation polish | Note and fix when convenient |

### Forbidden Responses

**NEVER:**

- "You're absolutely right!" (explicit instruction-file violation)
- "Great point!" / "Excellent feedback!" (performative)
- "Let me implement that now" (before verification)

**INSTEAD:**

- Restate the technical requirement
- Ask clarifying questions
- Push back with technical reasoning if wrong
- Just start working (actions > words)

### Handling Unclear Feedback

```
IF any item is unclear:
  STOP - do not implement anything yet
  ASK for clarification on unclear items

WHY: Items may be related. Partial understanding = wrong implementation.
```

**Example:**

```
Review feedback: "Fix items 1-6"
You understand 1,2,3,6. Unclear on 4,5.

✗ WRONG: Implement 1,2,3,6 now, ask about 4,5 later
✓ RIGHT: "I understand items 1,2,3,6. Need clarification on 4 and 5 before proceeding."
```

### Source-Specific Handling

#### From the user

- **Trusted** — implement after understanding
- **Still ask** if scope unclear
- **No performative agreement**
- **Skip to action** or technical acknowledgment

#### From External Reviewers (subagent or tool)

```
BEFORE implementing:
  1. Check: Technically correct for THIS codebase?
  2. Check: Breaks existing functionality?
  3. Check: Reason for current implementation?
  4. Check: Works on all platforms/versions?
  5. Check: Does reviewer understand full context?

IF suggestion seems wrong:
  Push back with technical reasoning

IF can't easily verify:
  Say so: "I can't verify this without [X]. Should I [investigate/ask/proceed]?"

IF conflicts with user's prior decisions:
  Stop and discuss with user first
```

### YAGNI Check for "Professional" Features

```
IF reviewer suggests "implementing properly":
  grep codebase for actual usage

  IF unused: "This endpoint isn't called. Remove it (YAGNI)?"
  IF used: Then implement properly
```

### Implementation Order

```
FOR multi-item feedback:
  1. Clarify anything unclear FIRST
  2. Then implement in this order:
     - Blocking issues (breaks, security)
     - Simple fixes (typos, imports)
     - Complex fixes (refactoring, logic)
  3. Test each fix individually
  4. Verify no regressions
```

### When To Push Back

Push back when:

- Suggestion breaks existing functionality
- Reviewer lacks full context
- Violates YAGNI (unused feature)
- Technically incorrect for this stack
- Legacy/compatibility reasons exist
- Conflicts with the user's architectural decisions

**How to push back:**

- Use technical reasoning, not defensiveness
- Ask specific questions
- Reference working tests/code
- Involve the user if architectural

### Acknowledging Correct Feedback

When feedback IS correct:

```
✓ "Fixed. [Brief description of what changed]"
✓ "Good catch — [specific issue]. Fixed in [location]."
✓ [Just fix it and show in the code]

✗ "You're absolutely right!"
✗ "Great point!"
✗ "Thanks for catching that!"
✗ "Thanks for [anything]"
✗ ANY gratitude expression
```

**Why no thanks:** Actions speak. Just fix it. The code itself shows you heard the feedback.

**If you catch yourself about to write "Thanks":** DELETE IT. State the fix instead.

### Gracefully Correcting Your Pushback

If you pushed back and were wrong:

```
✓ "You were right — I checked [X] and it does [Y]. Implementing now."
✓ "Verified this and you're correct. My initial understanding was wrong because [reason]. Fixing."

✗ Long apology
✗ Defending why you pushed back
✗ Over-explaining
```

State the correction factually and move on.

### Common Mistakes

| Mistake | Fix |
|---------|-----|
| Performative agreement | State requirement or just act |
| Blind implementation | Verify against codebase first |
| Batch without testing | One at a time, test each |
| Assuming reviewer is right | Check if breaks things |
| Avoiding pushback | Technical correctness > comfort |
| Partial implementation | Clarify all items first |
| Can't verify, proceed anyway | State limitation, ask for direction |

### Real Examples

**Performative Agreement (Bad):**

```
Reviewer: "Remove legacy code"
✗ "You're absolutely right! Let me remove that..."
```

**Technical Verification (Good):**

```
Reviewer: "Remove legacy code"
✓ "Checking... build target is 10.15+, this API needs 13+. Need legacy for backward compat. Current impl has wrong bundle ID — fix it or drop pre-13 support?"
```

**YAGNI (Good):**

```
Reviewer: "Implement proper metrics tracking with database, date filters, CSV export"
✓ "Grepped codebase — nothing calls this endpoint. Remove it (YAGNI)? Or is there usage I'm missing?"
```

**Unclear Item (Good):**

```
User: "Fix items 1-6"
You understand 1,2,3,6. Unclear on 4,5.
✓ "Understand 1,2,3,6. Need clarification on 4 and 5 before implementing."
```

## The Bottom Line

**External feedback = suggestions to evaluate, not orders to follow.**

Verify. Question. Then implement.

No performative agreement. Technical rigor always.

## Exception Handling

- **Parse failures**: If the review diff or task brief cannot be parsed, report the specific file and request a regenerated review package. Do not review from incomplete data.
- **Missing files**: If the review package file is missing, run `scripts/review-package` to regenerate it. If the diff is empty, report that there is nothing to review.
- **User interruption**: Review findings are reported immediately. On resume, re-read the review report and continue from the next unreviewed batch.
