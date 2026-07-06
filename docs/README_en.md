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
| `ssf inject <dir>` | Generate multi-platform phase-guard artifacts |
| `ssf audit <dir>` | Generate decision-point audit report |
| `ssf install-cursor` | Deploy to `.cursor/` directory |
| `ssf install-workbuddy` | Deploy to WorkBuddy marketplace and enable skills |

### Version

- Current: `v0.8.12`
- Self-contained — no OpenSpec or Superpowers runtime required
- Upstream: [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec), [obra/superpowers](https://github.com/obra/superpowers)
- Changelog: [CHANGELOG.md](../CHANGELOG.md)

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

> **v0.6.0+ auto mode detection:** hotfix (≤2 files, skips planning) and tweak (≤4 files, config/docs only, skips planning + bridging) make lightweight changes efficient too.

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
| 8 | `release-archivist` | Closing | Verification-before-completion + archive + risk summary |
| 9 | `spec-merger` | Syncing | Delta spec → main spec merge with conflict detection |

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
       ▼
   closing            release-archivist: verify + archive
       ▼
   syncing            spec-merger (delta specs → main specs)
```

**Hard constraints:** No `execution-contract.md` or no approval → implementation blocked. Requirements change mid-execution → forced rollback. Bug encountered → must enter debugging state, no ad-hoc fixes.

### Fast Paths (hotfix / tweak)

- **hotfix** — ≤2 files, no new modules → minimal contract → inline execution
- **tweak** — ≤4 files, config/docs only → skip planning + bridging, direct edit

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

Per-task loop: dispatch implementer subagent → generate review diff → dispatch reviewer subagent → dual verdict (spec compliance + code quality) → fail → fix → re-review. Progress ledger prevents session-compression loss.

</details>

---

**Star the repo — find it when you need it.**
