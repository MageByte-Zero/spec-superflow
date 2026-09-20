# AGENTS.md

This file provides guidance to Codex (codex.ai) when working with code in this repository.

## What This Is

A self-contained Codex plugin that integrates OpenSpec-style planning + Superpowers execution discipline. Zero runtime dependencies, supports 9 installation surfaces (Claude Code, Cursor, OpenAI Codex CLI, OpenAI Codex App, GitHub Copilot CLI, Gemini CLI, OpenCode, WorkBuddy, Trae).

## Commands

```bash
# Build TypeScript
npm run build

# Run integration tests
npm test

# Run single test (Node 20+ native test runner)
node --test tests/e2e.test.mjs --test-name-pattern="parseDeltaSpec"

# Validate artifacts (uses docs/examples/ data)
npm run validate
```

## Architecture

### Source Code (`src/`)

TypeScript interfaces + regex-based parsers. Compiles to `dist/` (ES2022 + NodeNext + strict).

- `schema/` — Type definitions: `base.ts` (Requirement, Scenario), `change.ts` (Delta operations), `spec.ts`
- `parsing/` — `requirement-blocks.ts` parses delta spec markdown. `change-parser.ts` extracts `## Why` + `## What Changes` + delta sections from proposal markdown.
- `validation/` — `validator.ts` validates artifacts against schema rules. `constants.ts` holds thresholds. All public API re-exported from `src/index.ts`.

### Validation Rules

- **spec.md**: Each Requirement must contain `SHALL` or `MUST`, at least 1 `#### Scenario:` block
- **Delta spec**: ADDED/MODIFIED must have requirement text + scenarios; cross-section conflicts blocked
- **proposal.md**: `## Why` ≥ 50 characters, `## What Changes` cannot be empty
- `Validator` returns `ValidationReport` with `{valid, issues: [{level, path, message}], summary}`. Strict mode treats warnings as errors.

### Skills (`skills/`)

9 skills, one per directory. Each contains a `SKILL.md` that Codex loads as an instruction set:

| Skill | Phase | Purpose |
|-------|-------|---------|
| `workflow-start` | Entry | Content-level state detection, 8-state routing, blocks illegal transitions |
| `need-explorer` | Exploring | One-question-at-a-time elicitation, 2-3 approach comparison with recommendation |
| `spec-writer` | Specifying | Generate planning artifacts + Schema engine validation |
| `contract-builder` | Bridging | Parsing engine auto-extracts 4 planning artifacts → compresses into `execution-contract.md` |
| `build-executor` | Executing | TDD Iron Law + SDD subagent-driven development + Review Gates |
| `bug-investigator` | Debugging | 4-phase root cause analysis. 3+ fix failures → question architecture → escalate |
| `code-reviewer` | Review | Structured review with 3 severity levels (Critical/Important/Minor) |
| `release-archivist` | Closing | Verification-before-completion Iron Law, archiving, risk summary |
| `spec-merger` | Sync | Delta Spec → intelligent merge into main specs, conflict detection |

### Skill Sub-Prompts

- `skills/build-executor/implementer-prompt.md` — Subagent implementation template with TDD evidence + self-review requirements
- `skills/build-executor/task-reviewer-prompt.md` — Dual-verdict review (spec compliance + code quality)
- `skills/code-reviewer/code-reviewer-prompt.md` — Structured code review template with 3 severity levels

### State Machine

8 states: `exploring`, `specifying`, `bridging`, `approved-for-build`, `executing`, `debugging`, `closing`, `abandoned`.

```
exploring → specifying → bridging → approved-for-build → executing → closing
                ↑              ↑             |                 ↑    |
                |              |             v                 |    |
                |              |         debugging ────────────┘    |
                |              |                                    |
                +--------------+------------------------------------+
                (scope change → re-specify)    (contract drift → re-bridge)
```

`workflow-start` is the single entry point. It reads artifact content (not just file existence) to determine current state.

### Hard Constraints

- No `execution-contract.md` or no user approval → implementation is **blocked**
- Requirements change mid-execution → forced rewind to `specifying` or `bridging`
- Bug encountered → must enter `debugging` state; no "just try random fixes"
- Contract scope drift detected (proposal intent lock ≠ contract intent) → re-bridge

### Helper Scripts (`scripts/`)

- `spec-superflow.mjs` — CLI entrypoint for `ssf` / `spec-superflow` commands.
- `lib/` — CLI subcommand modules (`cmd-validate.mjs`, `cmd-doctor.mjs`, `cmd-state.mjs`, etc.), config loader, hash utilities.
- `validate-artifacts` — Reads a change directory, validates proposal.md + all specs/*/spec.md, prints a report.

### Hooks (`hooks/`)

- `hooks/session-start` — Emits a short resume pointer only when the current project/change directory contains `.spec-superflow.yaml`; inactive sessions receive no injected context.
- `hooks/hooks.json` — Claude Code hook config (SessionStart).
- `hooks/hooks-cursor.json` — Cursor equivalent.

### Key Files

- `templates/*.md` — Templates for the 5 artifacts (proposal, spec, design, tasks, execution-contract)
- `docs/examples/` — Two complete change sets (`add-dark-mode`, `refactor-auth-boundary`) used by tests as real input data
- `docs/state-machine.md` — Formal state machine documentation
- `docs/artifact-contract.md` — Artifact roles and mapping from planning to execution
- `docs/decision-points.md` — Standard decision-point protocol

### Fast Paths (v0.6.0+)

- **hotfix** — ≤2 files, no new modules; skips full exploration and specification.
- **tweak** — ≤4 files, config/docs only; skips exploration, specification, and bridging.

## Design Decisions

- **`dist/` is committed** — the plugin is consumed via skills and scripts, not as an npm package. Tracking `dist/` lets validation scripts work immediately after cloning.
- **Tests import from `dist/`, not `src/`** — always run `npm run build` before `npm test`.
- **Content-level stale detection** — `workflow-start` compares proposal scope vs contract intent lock, not file timestamps.
- **Self-contained** — does not require OpenSpec or Superpowers to be installed. Absorbed concepts are reimplemented here.
- **Zero runtime dependencies** — only TypeScript as devDependency.
- **Multi-platform, single source** — Same 9 skills across Claude Code, Cursor, Codex CLI/App, Copilot CLI, Gemini CLI, OpenCode, WorkBuddy, and Trae. Platform-specific wiring is isolated to hooks, plugin manifests, local skill directories, and installers (`.claude-plugin/`, `.cursor-plugin/`, `.codex-plugin/`, `.github/plugin/`, `.opencode/`, `.agents/`, `gemini-extension.json`, `scripts/lib/cmd-install-workbuddy.mjs`).

## CI/CD (`.github/workflows/ci.yml`)

- **Push/PR to `main`**: Build + test on a Node 20/22 matrix + Plugin Scanner
- **Tag push `v*`**: Build + test → `gh release create` → `npm publish --provenance --access public`
- Release requires `NPM_TOKEN` secret and `id-token: write` permission for provenance

## Testing

Tests import from `dist/index.js` (compiled output), not source. Run `npm run build` before `npm test`.

Test data lives in `docs/examples/` — real proposal/spec/design artifacts from `add-dark-mode` and `refactor-auth-boundary` scenarios.

## Release Checklist

Refer to `docs/release-checklist.md` before publishing. Key items:
- Keep `README.md`, `docs/README_en.md`, `INSTALL.md`, `CHANGELOG.md`, and all plugin manifests/installers in sync. Use `ssf version <semver>`.
- Verify all examples are complete (proposal + specs + design + tasks + execution-contract + README)
- No stray `TODO` or `TBD` markers
- `package.json` version matches `.claude-plugin/plugin.json` version
