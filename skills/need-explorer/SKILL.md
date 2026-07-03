---
name: need-explorer
description: Clarify intent, scope, constraints, and success criteria before artifact creation. Invoke when the request is fuzzy, the user is comparing options, or the workflow needs a stable change definition before writing artifacts.
---

# Need Explorer

Use this skill to turn a rough idea into a stable change definition.

## Use This Skill When

Invoke this skill when the user says things like:

- "I have an idea"
- "help me think this through"
- "compare these approaches"
- "I am not sure about scope yet"
- "let's figure out what we are actually building"

## Primary Goal

Make the user and the agent agree on:

- what problem is being solved
- what is in scope
- what is out of scope
- what success looks like
- whether the work should be split before specification

## Process

### 1. Inspect Context First

Before asking questions, inspect the current project context. Understand what already exists, what constraints are in place, and what the surrounding codebase looks like.

### 2. One Question at a Time

Do not ask multiple questions in one turn. Each question you ask focuses the conversation. Follow this pattern:

- Ask a single, clear question
- Wait for the user's answer
- Digest the answer before asking the next
- Let each answer inform what you ask next

This prevents the user from having to remember and answer 3+ questions at once. It also prevents you from making assumptions that cascade.

**Bad:** "What's the scope? What's the priority? What's the timeline? Are there dependencies?"
**Good:** "Let's start with one thing. What problem are you trying to solve?"

### 3. Prefer Multiple-Choice Questions

When a question has a finite set of reasonable answers, present them as options. This reduces cognitive load on the user and surfaces choices they may not have considered.

**Example:** "Authentication could work three ways here: (A) session tokens only, (B) JWT with refresh, (C) OAuth2 with third-party providers. Which direction fits your use case?"

### 4. Propose 2-3 Approaches with Trade-Offs

Once you understand the problem and constraints, propose 2-3 approaches:

For each approach, lay out:
- **What it is** (one sentence)
- **Upside** (why you'd choose it)
- **Downside** (what you're trading off)
- **Best for** (when this is the right choice)

Then **recommend one approach** and explain why.

**Never** present a single approach as the only path. Even when one approach is clearly dominant, name the alternative and explain why it's inferior — this builds trust and demonstrates thoroughness.

### 5. Validate Before Concluding

Before handing off to `spec-writer`, confirm with the user:

- "Here's what I'm hearing. [Restate problem, scope, non-goals, success criteria]. Does this match what you have in mind?"
- If the user corrects anything, incorporate it and re-validate.

### 6. DP-1: Requirement Confirmation Gate

After the user confirms the exploration summary, record the decision point:

```bash
ssf state set <change-dir> dp_1_result "confirmed: <one-line summary>"
ssf state set <change-dir> dp_1_timestamp $(date -u +%Y-%m-%dT%H:%M:%SZ)
```

DP-1 confirms that scope, non-goals, and success criteria are agreed before artifact creation begins. Without this gate, `spec-writer` may generate specs against unconfirmed assumptions.

### 7. Hand Off

Once DP-1 is recorded, hand off to `spec-writer`.

## Anti-Patterns

### Don't skip exploration because it seems simple

"Simple" changes have scope too. "Just add a button" needs:
- Where does it go?
- What does it do?
- What happens on error?
- Is it always visible or conditional?

Five minutes of exploration prevents two hours of rework.

### Don't propose solutions before clarifying the problem

If the user says "add caching," the first response is not "use Redis." The first response is "what problem are you seeing that caching would solve?"

### Don't explore indefinitely

Exploration ends when six things are clear. If all six are clear, hand off. If the user wants to keep exploring, that's their call — but name that all six are satisfied.

## Exploration Standard

Do not stop at "I understand the feature."

You should leave exploration with:

- a usable change name
- a crisp problem statement
- scope boundaries
- non-goals
- success criteria
- a sense of whether one change is enough or decomposition is needed

## Output Standard

At the end of exploration, the following should be clear:

- change name
- problem statement
- scope
- non-goals
- acceptance direction
- whether a single change is enough

If those are not yet clear, stay in exploration.

## Strong Rule

Do not produce implementation code.

This skill exists to stabilize intent, not to build.

## Self-Review Before Handoff

Before handing off to `spec-writer`, perform a self-review:

1. **Placeholder scan**: Are there any vague phrases like "probably", "maybe", "TBD", or "we'll figure it out later"? If yes, resolve them.
2. **Contradiction check**: Do any scope items conflict with non-goals? Does the success criteria contradict any stated constraint?
3. **Scope check**: Can you draw a bright line between what's in and what's out? If a developer read this, would they know where to stop?

If any of these checks fail, stay in exploration until they pass.

## Exception Handling

- **Parse failures**: If project context files cannot be read or parsed, report the specific file and proceed with available information. Do not block exploration on file read errors.
- **Missing files**: If essential project files (CLAUDE.md, package.json, etc.) are absent, note this as a constraint and continue. Exploration does not require a complete codebase.
- **User interruption**: Exploration is stateless — on resume, re-ask the current question. No state needs recovery.
