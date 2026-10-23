# AGENTS.md

This file provides guidance to Codex (codex.ai) when working with code in this repository.

## Current default (new changes)

Use only when the user opts into spec-superflow. New tasks have direct and planned entry points (`workflow start`), not a five-path questionnaire. Planned work uses proposal.md + tasks.md and one concrete approval; specs/design are optional. No handwritten execution-contract or recommendation receipt is required. Native/final is default, delegation and worktrees are explicit. Ordinary debugging stays in executing. `workflow complete` runs final checks and records verified or explicit accepted-risk delivery; failure is never rewritten as pass. User instructions always take precedence.

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

### Skills and workflow

New changes use direct or planned. Read `skills/workflow-start/SKILL.md` when explicitly enabling the workflow. Planned work has proposal.md + tasks.md, optional behavior specs/design, one concrete approval, current-session execution and final review. Ordinary debugging stays in executing. Complete with `workflow complete`; merge and release remain separately authorized operations.

For an existing change, identify the current path using recorded state and evidence: direct requires a valid schema-3 workflow-selection receipt; planned requires a schema-2 execution plan. Schema-1/2 direct receipts and legacy plans use [legacy recovery](docs/legacy-workflow.md), retaining original approvals and receipt obligations. A direct variant alone is insufficient, and internal `workflow: full` also occurs in v2 planned changes. Missing or corrupt evidence requires investigation rather than initialization or downgrade. Do not migrate active legacy changes automatically.

Load only the skill needed for the current action: need-explorer for uncertain scope, spec-writer for a concrete plan, build-executor for implementation, bug-investigator for diagnosis, code-reviewer for review, spec-merger for actual delta specs, release-archivist for verification/closure. Contract-builder is only for existing legacy contracts.

### Runtime and supporting assets

`scripts/spec-superflow.mjs` is the bundled CLI. Source skills use `SSF` as a placeholder for this runtime, never an arbitrary binary from PATH. Runtime references are read through its allowlisted `runtime asset read` command. Preserve this access path when moving guidance: installers must carry both skills and referenced assets.

`templates/` supplies artifact formats; `docs/examples/` contains legacy fixtures used by tests. State-machine, decision-point and execution-contract documents describe compatibility rules, not additional steps for new changes. Hooks only supply recovery pointers for active changes; ordinary coding does not opt into the workflow automatically.

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
- Validate examples according to their workflow variant; legacy contract fixtures retain their existing artifacts.
- No stray `TODO` or `TBD` markers
- `package.json` version matches `.claude-plugin/plugin.json` version
