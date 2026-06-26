# spec-superflow

`spec-superflow` is a self-contained workflow integration plugin for Claude Code and Trae.

It combines:

- OpenSpec-style artifact thinking: `proposal.md`, `specs/`, `design.md`, `tasks.md`
- Superpowers-style execution discipline: guardrails, TDD, review gates, controlled handoff

The key idea:

```text
clarify -> specify -> bridge -> execute -> close
```

Instead of requiring users to install both upstream systems and manually stitch them together, `spec-superflow` absorbs the useful parts of each and exposes one coherent workflow.

## Why It Exists

Most AI coding sessions fail in one of two ways:

1. The AI starts writing code before "what we are building" is stable.
2. The team does define the change, but implementation still drifts because testing, review, and handoff are too loose.

`spec-superflow` addresses both:

- `spec-explorer` and `spec-forger` make the change explicit.
- `bridge-contract` turns planning artifacts into an `execution-contract.md`.
- `execution-governor` treats that contract as the approved source for implementation behavior.

## Recommended Usage

### The Single Entry Point

**Everything starts from `workflow-orchestrator`.**

Whenever you begin or resume a change, just tell your agent:

```
use workflow-orchestrator to start
```

`workflow-orchestrator` inspects the current artifact directory, determines which stage you're in, and routes to the correct next skill. You don't need to memorize six skill names or manually figure out "what should I do next" — the entry point handles it.

### Full Flow: Six States, One Pipeline

```text
You: "add authorization to the API"
       │
       ▼
┌──────────────────────────┐
│  workflow-orchestrator    │  ← Single entry. Inspects state, routes forward
└──────┬───────────────────┘
       │
       ▼
   exploring         spec-explorer asks: "RBAC or ABAC?" "What granularity?" "Which endpoints?"
       │
       ▼
   specifying        spec-forger produces 4 artifacts: proposal + specs + design + tasks
       │
       ▼
   bridging          bridge-contract compresses 4 artifacts into 1 execution-contract.md
       │                 ┌────────────────────────────────────────┐
       │                 │ execution-contract.md                  │
       │                 │  - Input / Output / Boundaries         │
       │                 │  - Per-item test checklist             │
       │                 │  - Review gates                        │
       │                 └────────────────────────────────────────┘
       │
  ◇ User Approval ◇   ← The only human gate: you review, confirm, say "approved"
       │
       ▼
   executing         execution-governor enforces TDD, review gates, contract compliance
       │
       ▼
   closing           closure-archivist verifies, summarizes, archives
```

**Hard constraints:**

- No `execution-contract.md` or no user approval → **implementation is blocked**
- Violating the contract during implementation → **intercepted and rolled back**, not left to developer intuition
- Requirements change mid-execution → **forced rollback to `specifying` or `bridging`**, no silent scope creep

### The Superpower: Truly Integrating OpenSpec + Superpowers

Most AI coding workflows fall into two camps:

| Camp | Example | Strength | Weakness |
|---|---|---|---|
| Planning-first | OpenSpec | Clean proposal, specs, design, tasks | Stops at documentation. Implementation runs unguarded |
| Discipline-first | Superpowers | TDD, review gates, subagent-driven dev | No formal planning layer. No hard judgment on "is the spec stable?" |

**spec-superflow bridges both worlds:**

```text
OpenSpec strengths                 Superpowers strengths
    │                                    │
    │  proposal                          │  brainstorming
    │  specs                             │  TDD
    │  design                            │  review gates
    │  tasks                             │  subagent-driven-dev
    │                                    │
    └──────────┬─────────────────────────┘
               │
               ▼
      ┌─────────────────────┐
      │  execution-contract  │  ← spec-superflow's bridge layer
      │  .md                 │     Planning artifacts compressed into
      └─────────────────────┘     verifiable contract.
               │                  Execution discipline only activates
               ▼                  against approved contract.
        Planning is no longer just reference material.
        Execution no longer drifts on its own.
```

In concrete terms:

1. **Absorbs OpenSpec's planning capability** — proposal, specs, design, tasks as formal artifacts, not the end of the process
2. **Absorbs Superpowers' execution discipline** — TDD, review gates, violation interception, but requires an approved contract to activate
3. **`execution-contract.md` is the unique innovation** — not another planning doc, but a **verifiable contract**: inputs/outputs/boundaries/test checklist/review gates, each item checkable during implementation
4. **Self-Contained** — no OpenSpec install, no Superpowers install. One plugin, one workflow owner.

## Core Skills

| Skill | Stage | Responsibility |
|---|---|---|
| `workflow-orchestrator` | Entry | Inspect state, route to correct skill, block invalid transitions |
| `spec-explorer` | Exploring | Clarify intent, scope, constraints, and success criteria |
| `spec-forger` | Specifying | Generate proposal, specs, design, and tasks |
| `bridge-contract` | Bridging | Convert planning artifacts into `execution-contract.md` |
| `execution-governor` | Executing | Enforce TDD, review gates, and contract-first implementation |
| `closure-archivist` | Closing | Verify, summarize, and prepare for archive |

## Install

**Claude Code (recommended):**

```
/plugin marketplace add MageByte-Zero/spec-superflow
/plugin install spec-superflow@spec-superflow
```

That's it. Zero copy, zero config.

**Trae:**

```bash
git clone https://github.com/MageByte-Zero/spec-superflow.git
mkdir -p ~/.trae/skills
cp -R spec-superflow/skills/* ~/.trae/skills/
```

Full guide: [INSTALL.md](file:///Users/magebte/Documents/magebyte/open-source-plugins/spec-superflow/INSTALL.md)

## Quick Start

1. Install the plugin (see above).
2. Create or choose a change workspace under `workflow/changes/<change-name>/`.
3. Start from `workflow-orchestrator`.
4. Let the workflow move through exploration, specification, bridging, execution, and closure.

## How To Use

### 1. Start from the orchestrator

Ask the agent to use `workflow-orchestrator` when:

- starting a new change
- resuming an old change
- deciding what stage the work is in

### 2. Let the workflow move through five artifact steps

For a change named `<change-name>`, the plugin expects:

```text
workflow/
└── changes/<change-name>/
    ├── proposal.md
    ├── design.md
    ├── tasks.md
    ├── specs/
    │   └── <capability>.md
    └── execution-contract.md
```

### 3. Use one workflow owner

Do not ask the same session to separately run:

- OpenSpec workflow commands
- Superpowers workflow entry points
- `spec-superflow` orchestration

Pick `spec-superflow` as the visible workflow owner and let it absorb the rest.

### 4. Let the contract gate execution

Planning alone does not authorize implementation.

The intended handoff is:

```text
proposal/specs/design/tasks -> execution-contract.md -> approved build work
```

If the contract is missing, stale, or unapproved, route back instead of coding forward.

## Included Templates

Templates live in `templates/`:

- `proposal.md`
- `spec.md`
- `design.md`
- `tasks.md`
- `execution-contract.md`

## Example Workflow

Two complete change sets demonstrate the full progression from proposal to execution contract:

- `docs/examples/add-dark-mode/` -- net-new UI capability (dark mode)
- `docs/examples/refactor-auth-boundary/` -- brownfield backend refactor (auth layer)

Read each in artifact order: `proposal.md` -> `specs/` -> `design.md` -> `tasks.md` -> `execution-contract.md`.

## FAQ

<details>
<summary><strong>What's the difference between spec-superflow and OpenSpec / Superpowers?</strong></summary>

OpenSpec focuses on planning artifacts (proposal, specs, design, tasks). Superpowers focuses on execution discipline (TDD, review gates, subagent-driven development). spec-superflow merges both into one workflow: plan first, bridge through an execution contract, then build under guardrails.

You do not need to install OpenSpec or Superpowers at runtime.
</details>

<details>
<summary><strong>Can I use this with existing OpenSpec change folders?</strong></summary>

Partially. If your folder already has proposal, specs, design, and tasks, you can run bridge-contract to generate the execution contract. The folder structure is compatible. However, mixing OpenSpec CLI commands with spec-superflow skills in the same session is not recommended -- pick one workflow owner.
</details>

<details>
<summary><strong>Does this work with brownfield / existing codebases?</strong></summary>

Yes. The workflow does not assume a greenfield project. The spec-explorer inspects the current project context before asking clarifying questions. See the `refactor-auth-boundary` example for a brownfield scenario.
</details>

## Current Status

This repository currently contains a usable `v0.1` plugin scaffold:

- plugin metadata
- skill boundaries
- full planning and execution-contract templates
- supporting docs for artifact mapping and state transitions
- two complete example change sets
- install guide, license, and changelog
