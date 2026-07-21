<h1 align="center">spec-superflow</h1>

<p align="center">
  <strong>A self-contained AI coding workflow plugin fusing OpenSpec planning + Superpowers execution discipline</strong>
</p>

<p align="center">
  <a href="../LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://github.com/MageByte-Zero/spec-superflow/stargazers"><img src="https://img.shields.io/github/stars/MageByte-Zero/spec-superflow" alt="GitHub Stars"></a>
  <a href="https://www.npmjs.com/package/spec-superflow"><img src="https://img.shields.io/npm/v/spec-superflow" alt="npm version"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> |
  <a href="#installation">Install</a> |
  <a href="#why">Why</a> |
  <a href="#core-skills">Skills</a> |
  <a href="#workflow">Workflow</a> |
  <a href="../README.md">中文</a> |
  <a href="showcase.html">Showcase</a> |
  <a href="#faq">FAQ</a>
</p>

---

## Quick Start

Once installed, just tell your agent:

```
use workflow-start to begin
```

The agent inspects your current artifacts, performs **content-level detection** (comparing proposal scope vs. contract intent lock, not just file timestamps), determines your workflow stage, and routes to the correct next skill.

- New change → `use workflow-start to begin`
- Resume work → `continue the workflow`
- Unsure → `check what state we're in`

## Installation

### Claude Code (Marketplace)

Claude Code's primary installation path is the plugin marketplace:

```bash
/plugin marketplace add MageByte-Zero/spec-superflow
/plugin install spec-superflow@spec-superflow
/plugin update spec-superflow@spec-superflow   # upgrade
```

### Cursor (Skills directories / GitHub import)

```bash
npx spec-superflow@latest install-cursor

# Or run the installer directly:
curl -fsSL https://raw.githubusercontent.com/MageByte-Zero/spec-superflow/main/scripts/install-cursor.mjs | node -
```

Cursor discovers `.cursor/skills/`, `.agents/skills/`, `~/.cursor/skills/`, and compatible Claude/Codex skill directories. You can also import a GitHub repo from Customize → Rules → Remote Rule (Github).

### OpenAI Codex CLI / App

Codex uses the Plugin Directory / marketplace model. This repo ships `.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json`.

```bash
codex
/plugins

# Or add the community marketplace and install:
codex plugin marketplace add hashgraph-online/awesome-codex-plugins
codex plugin add spec-superflow@spec-superflow
```

In the Codex app, open **Plugins** and install or enable `spec-superflow`. If installed from the CLI, restart the app and enable it in the Plugins panel.

### GitHub Copilot CLI

```bash
copilot plugin marketplace add MageByte-Zero/spec-superflow
copilot plugin install spec-superflow@spec-superflow
```

### Gemini CLI

```bash
gemini extensions install https://github.com/MageByte-Zero/spec-superflow
gemini extensions update spec-superflow   # upgrade
```

### OpenCode / WorkBuddy / Trae

| Platform | Method | Status |
|----------|--------|--------|
| **OpenCode** | `.opencode/plugins/spec-superflow.js` or `.agents/skills -> skills/` | Entry provided |
| **WorkBuddy** | `npx spec-superflow@latest install-workbuddy` | Installer provided |
| **Trae IDE / TRAE Work** | `.trae/skills/`, `~/.trae/skills/`, or zip/.skill upload | Manual/import |

> Full installation guide: [INSTALL.md](../INSTALL.md)

### CLI Toolchain

```bash
npm install -g spec-superflow
```

| Command | Purpose |
|---------|---------|
| `ssf list` | List all changes and status |
| `ssf validate <dir>` | Validate artifact completeness |
| `ssf doctor` | Health check (versions, hooks, skills, docs) |
| `ssf version <semver>` | Sync version across all manifests |
| `ssf state <sub> <dir>` | Manage `.spec-superflow.yaml` state file |
| `ssf inject <dir>` | Generate phase-guard artifacts; omit `--platforms` only when exactly one platform marker is detected |
| `ssf audit <dir>` | Generate decision-point audit report |
| `ssf checkpoint save <dir> --task <id> --next <text>` | Save a task-level recovery checkpoint |
| `ssf checkpoint list <dir>` | List checkpoints and stale status |
| `ssf checkpoint show <dir> <id>` | Show one recovery checkpoint |
| `ssf resume [change]` | Read-only recovery summary; auto-selects the only active change |
| `ssf switch <change>` | Read-only recovery context for an explicit change; an adapter may use it to focus the current AI conversation |
| `ssf save <change> --task <id> --next <text>` | Manually reuses the existing checkpoint protocol; never commits, pushes, or syncs automatically |
| `ssf handoff create <dir> --type <type> ...` | Create a prototype/research/experiment handoff |
| `ssf handoff list <dir>` | List handoff lifecycle status |
| `ssf handoff finish <dir> <id>` | Validate a handoff result |
| `ssf handoff resolve <dir> <id> --decision <decision>` | Record an explicit handoff decision |
| `ssf install-cursor` | Deploy to `.cursor/` directory |
| `ssf install-workbuddy` | Deploy to WorkBuddy marketplace and enable skills |

### Version

- Current: `v0.11.0`
- v0.9.1 highlights: DP-4 execution-mode recommendations, a portable runtime across 17 platforms, and a raw-package smoke with no plugin-root variable.
- Self-contained — no OpenSpec or Superpowers runtime required
- Upstream: [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec), [obra/superpowers](https://github.com/obra/superpowers)
- Changelog: [CHANGELOG.md](../CHANGELOG.md)

`ssf inject` examples:

```bash
ssf inject changes/my-change --platforms cursor
ssf inject changes/my-change --platforms all
```

If `--platforms` is omitted, injection only proceeds when exactly one project marker is detected. Ambiguous projects must use `--platforms <platform>` or `--platforms all`.

Session recovery and optional prototypes:

```bash
ssf resume                         # auto-select only when exactly one change is active
ssf resume changes/my-change       # read-only summary for one explicit change
ssf switch changes/another-change  # read-only recovery context for one explicit change
ssf save changes/my-change --task 1.1 --next "Run focused tests"
ssf checkpoint save changes/my-change --task 1.1 --next "Run focused tests"
ssf checkpoint list changes/my-change
ssf handoff create changes/my-change --type research --objective "Compare approaches" --expected-output "Recommendation" --acceptance "Evidence recorded"
```

`resume` and `switch` are read-only recovery operations; `resume` auto-selects a target only when exactly one active change exists. `switch` only returns the explicit target's recovery context and never changes cwd, a TUI session, or a hidden pointer; the CLI itself does not mutate conversation focus, while a CodeBuddy/WorkBuddy adapter or host agent may use that context to focus the conversation. `save` only manually reuses the existing checkpoint protocol; it never commits, pushes, or syncs automatically. `/ssf:resume`, `/ssf:switch`, and `/ssf:save` are Markdown command adapters for CodeBuddy/WorkBuddy that dispatch to the same CLI guards; other platforms are not promised identical slash names.

Prototype work starts only after explicit user confirmation. Backend, CLI,
configuration, and internal-refactor work does not enter the prototype route
automatically. Handoff results never edit `design.md` or `tasks.md` automatically.

Canonical delta specs live at `specs/<capability>/spec.md`; flat `specs/<capability>.md` and root-level `specs/spec.md` are not valid canonical paths.

---

## Why

AI coding sessions fail in one of two ways:

- **The AI starts coding before you've decided what to build.** You say "add authorization" and it touches 40 files before you realize — RBAC or ABAC?

- **The plan is solid, but execution drifts.** The proposal, specs, and design are written, but nobody enforces testing, nobody gates reviews, and by merge time the behavior doesn't match.

**spec-superflow builds a hard wall between these two failure points:** intent exploration → formal artifacts (Schema-validated) → execution contract bridge → TDD + SDD + Review Gate enforcement → verified closure → delta spec sync to prevent spec rot.

| Principle | Meaning |
|---|---|
| Spec First | No stable planning artifacts → implementation blocked |
| Guarded Handoff | `execution-contract.md` is the only bridge to implementation |
| Strong Guardrails | Contract violations intercepted and rolled back |
| Schema Validated | Planning artifacts validated by embedded engine |
| Execute Disciplined | TDD Iron Law + SDD subagents + Review Gates |
| Self-Contained | No external runtime dependencies |

### When to Use

**✅ Recommended:** Large features, multi-person collaboration, long-term maintenance, brownfield projects needing TDD + review gates.

**❌ Skip:** One-off scripts, pure Q&A conversations.

> **v0.6.0+ auto mode detection:** hotfix (≤2 files, minimal contract + DP-3 before execution) and tweak (≤4 files, config/docs only, skips planning + bridging) make lightweight changes efficient too.

---

## Core Skills

| # | Skill | Stage | Purpose |
|---|-------|-------|---------|
| 1 | `workflow-start` | Entry | Content-level state detection, 8-state routing, blocks illegal transitions |
| 2 | `need-explorer` | Exploring | One question at a time, approach comparison, recommendation |
| 3 | `spec-writer` | Specifying | Generate proposal/specs/design/tasks with Schema engine validation |
| 4 | `contract-builder` | Bridging | Parse 4 artifacts → compress into execution-contract.md |
| 5 | `build-executor` | Executing | TDD Iron Law + SDD subagent-driven + Review Gates |
| 6 | `bug-investigator` | Debugging | 4-phase root cause analysis; 3+ failures → escalate |
| 7 | `code-reviewer` | Review | Structured review with 3-level severity classification |
| 8 | `release-archivist` | Pre-closing within executing | Verification-before-completion + archive + risk summary |
| 9 | `spec-merger` | Pre-closing within executing | Delta spec → main spec merge with conflict detection |

---

## Workflow

```text
You: "add authorization to the API"
       │
       ▼
   workflow-start     ← Single entry. Content-level detection, routes to correct skill
       │
       ▼
   exploring          need-explorer: "RBAC or ABAC? What granularity?"
       ▼
   specifying         spec-writer generates 4 artifacts + Schema validation
       ▼
   bridging           contract-builder auto-extracts → execution-contract.md
       │
  ◇ User Approval ◇   ← The only human gate
       │
       ▼
   executing          build-executor: TDD → SDD → Review Gate
       │
       ├──[bug]──→ debugging  → bug-investigator
       │
       ▼
   pre-closing (a wrap-up step within executing, not a ninth state)
       │ release-archivist verifies → spec-merger sync → archive confirmation
       ▼
   closing            CLOSED successful terminal state (no next skill)
```

**Hard constraints:** No `execution-contract.md` or no approval → implementation blocked. Requirements change mid-execution → forced rollback. Bug encountered → must enter debugging state, no ad-hoc fixes.

### Guarded execution plans

For full/hotfix, DP-4 is a persisted, current execution plan at
`<change>/.superpowers/sdd/execution-plan.json`, rather than an arbitrary text
field or content stored in `execution-contract.md`. Run `ssf execution recommend`
first: it lists `inline`, `batch-inline`, and `sdd` from task count and wave
strategy, with auditable reasons, and saves a recommendation receipt at
`<change>/.superpowers/sdd/execution-recommendation.json`. The agent presents that recommendation and the
user records a choice with `--confirm`; `plan` and `revise` require a receipt matching the current
artifacts, contract, and waves. A non-recommended choice also requires
`--acknowledge-recommendation`. Batch Inline remains serial and never claims
parallel work.
`tweak` is exempt from this execution-plan and review-receipt gate.

```bash
ssf execution recommend changes/my-change \
  --wave foundation:parallel:1.1,1.2 \
  --wave integration:serial:2.1:foundation --json
ssf execution plan changes/my-change --mode sdd --confirm --reason "independent work" \
  --wave foundation:parallel:1.1,1.2 \
  --wave integration:serial:2.1:foundation
ssf execution show changes/my-change --json
# Retains/upgrades an existing plan as sdd; it can replan waves and dependencies,
# creates a new revision, and clears old review receipts. Downgrades are rejected.
ssf execution recommend changes/my-change \
  --wave foundation:parallel:1.1,1.2 \
  --wave integration:serial:2.1:foundation --json
ssf execution revise changes/my-change --mode sdd --confirm --reason "need parallel work" \
  --wave foundation:parallel:1.1,1.2 \
  --wave integration:serial:2.1:foundation
ssf execution review changes/my-change --wave foundation --base <sha> --head <sha> \
  --report .superpowers/sdd/reviews/foundation.md --verdict pass
```

The `--report` path is resolved relative to `<change>` and must remain under
`<change>/.superpowers/sdd/reviews/`. `--base` and `--head` must be real commits
in the `<change>` Git worktree, and `base` must be an ancestor of `head`.
The `<change>/.superpowers/sdd/reviews/` directory hierarchy must be physical,
non-symlink directories. The report itself must be a regular, non-empty,
non-symlink file.

Every planned wave needs a current `pass` review receipt before dependent
waves or closing may proceed; revising a plan invalidates earlier receipts.
Recovery, switching, and manual save form a control-plane overlay, not a ninth
workflow state; their CLI and CodeBuddy/WorkBuddy Markdown adapters keep the
same guards.

### Fast Paths (hotfix / tweak)

- **hotfix** — ≤2 files, no new modules → `exploring -> bridging -> approved-for-build -> executing`. It may skip full planning artifacts such as `proposal.md`, `design.md`, `tasks.md`, and `specs/`, but it still requires a fresh minimal `execution-contract.md` plus DP-3 approval before implementation
- **tweak** — ≤4 files, config/docs only → skip planning + bridging, direct edit

---

## Model Profiles (Optional Configuration)

Configure platform model IDs for execution roles in the project-root `spec-superflow.config.json`:

```json
{
  "models": {
    "mechanical": "vendor-small",
    "standard": "vendor-standard",
    "strong": "vendor-strong",
    "review": "vendor-review"
  }
}
```

| Profile | Role |
|---|---|
| `mechanical` | Low-cost, routine edits |
| `standard` | Integration and judgment work |
| `strong` | Architecture, design, and final review |
| `review` | Code review that matches the diff |

Resolve a profile in read-only mode:

```bash
ssf config --resolve-model mechanical
```

This command only resolves local configuration, does not call platform APIs, and does not switch models in the current session. The controller explicitly passes the returned model ID only to platforms whose dispatch supports a `model` field. A `configured: false` result means automatic selection is unavailable: never invent a provider model and continue to meet the existing explicit `model` requirement.

---

## FAQ

<details>
<summary><strong>How is this different from OpenSpec or Superpowers?</strong></summary>

spec-superflow is a source-level fusion, not side-by-side installation. It absorbs OpenSpec's Schema/validation/parsing engine and Superpowers' TDD/SDD/debugging/review discipline, while adding a unique contract-builder bridge layer and 8-state routing. Self-contained — no upstream runtimes needed.

</details>

<details>
<summary><strong>Can I use this alongside existing OpenSpec or Superpowers?</strong></summary>

Not recommended in the same session. Projects with existing OpenSpec artifacts can be adopted directly — `contract-builder` reads your existing proposal/specs/design/tasks to generate the execution contract.

</details>

<details>
<summary><strong>How does the execution contract detect staleness?</strong></summary>

Content-level detection, not timestamps: proposal scope changed, approved spec behavior changed, design constraints changed, or task batches changed → contract marked stale → route back to `contract-builder`.

</details>

<details>
<summary><strong>How does SDD (Subagent-Driven Development) work?</strong></summary>

For full/hotfix, `ssf execution recommend` first presents Inline, Batch Inline,
and SDD with evidence from the change, then recommends one. The user confirms a
selection with `--confirm`; a different selection requires
`--acknowledge-recommendation`. The saved execution plan at
`<change>/.superpowers/sdd/execution-plan.json` names waves, dependencies, and
strategies before dispatching implementers. Each wave gets a review report and a
`pass`/`fail` receipt. Batch Inline remains serial, and the progress ledger
prevents session-compression loss.

</details>

---

**Star the repo — find it when you need it.**
