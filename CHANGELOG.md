# Changelog

All notable changes to `spec-superflow` will be documented in this file.

The format loosely follows Keep a Changelog.

## [0.8.0] - 2026-07-01

### Added

- **Intuitive skill names** — All 9 skills renamed to action-object style: `workflow-start`, `need-explorer`, `spec-writer`, `contract-builder`, `build-executor`, `bug-investigator`, `code-reviewer`, `release-archivist`, `spec-merger`.
- **Batch Inline execution mode** — `build-executor` now supports `Batch Inline` for low-risk, same-module tasks, reducing subagent dispatch overhead for small changes like issue #5.
- **User confirmation gate (DP-0)** — `workflow-start` confirms key decisions with the user before routing to `spec-writer`; `spec-writer` honors confirmed constraints and pauses on unconfirmed decisions.
- **Migration guide** — Added `docs/skill-rename-v0.8.0.md` with old→new mapping and per-platform refresh instructions.

### Changed

- **Documentation sync** — `README.md`, `INSTALL.md`, `CLAUDE.md`, `docs/state-machine.md`, `docs/decision-points.md`, `GEMINI.md`, main `specs/`, `templates/`, and plugin manifests updated to use the new skill names and v0.8.0 install instructions.
- **Version sync** — `ssf version` now also updates `.codex-plugin/plugin.json`; `ssf doctor` checks all 7 manifests.

## [0.7.1] - 2026-06-30

### Fixed

- **README consistency** — 移除架构图中不存在的 `schemas/` 目录，补充 `scripts/guard/`、`install-cursor.mjs`、`infer-workflow.mjs`；明确 Cursor 的 session-start hook 需要手动复制到 `.cursor/hooks.json`。

## [0.7.0] - 2026-06-30

### Added

- **Multi-platform phase-guard injection** — `ssf inject` now generates phase-guard artifacts for Claude Code (`.claude/always/phase-guard.md`), Cursor (`.cursor/rules/phase-guard.mdc`), Copilot (`.github/copilot-instructions.md`), and Gemini (`GEMINI.md`). New `--platforms` flag limits output to a subset.
- **Auto workflow-mode detection** — `workflow-orchestrator` infers `hotfix`/`tweak`/`full` from artifact content when `.spec-superflow.yaml` workflow is `auto`. Added `scripts/infer-workflow.mjs` helper. Explicit workflow values are preserved.
- **Decision-point audit report** — New `ssf audit <change-dir>` command reads `.spec-superflow.yaml` DP fields and generates `decision-point-audit.md` with a summary table and per-DP interpretation.
- **Cursor local deploy** — New `scripts/install-cursor.mjs` copies skills to `.cursor/skills/` and creates `.cursor/rules/phase-guard.mdc` for Cursor Agent.
- **Template localization** — All planning templates under `templates/` are now in Chinese while keeping required parsing markers intact.

### Fixed

- **Copilot CLI plugin manifest** — Root `plugin.json` `author` is now an object (`{ "name": "..." }`) to satisfy Copilot CLI strict validation.
- **`ssf doctor` author check** — Added validation for root `plugin.json` `author` format.
- **INSTALL.md accuracy** — Cursor and Copilot CLI install instructions now describe the actual working mechanisms.

## [0.6.0] - 2026-06-29

### Added

- **Fast-path workflow modes** — hotfix and tweak modes skip full planning for small changes. Hotfix: ≤2 files, no new modules, minimal contract. Tweak: ≤4 files, config/doc only, direct edit. Auto-upgrade to full when thresholds exceeded.
- **Phase-drift prevention** — `ssf inject` command generates `rules/phase-guard.md` and installs to `.claude/always/` for per-turn Agent context injection. 9 state templates with allowed/forbidden operations. Forms a soft+hard dual defense with guard.mjs.
- **Decision point protocol** — `docs/decision-points.md` defines 7 standard decision points (DP-1 through DP-7) with triggers, inputs, outputs, and associated skills. All 4 affected skills reference DP numbers.
- **Guard mode awareness** — `guard.mjs` accepts `--workflow` parameter (full/hotfix/tweak) for mode-specific check skipping. 2 new transitions: `exploring→bridging`, `exploring→approved`.
- **State set command** — `ssf state set <dir> <field> <value>` with SETTABLE_FIELDS whitelist. 14 new decision point audit fields (dp_N_result + dp_N_timestamp).

### Changed

- **Guard schema-valid** — Uses `validateDeltaSpec` for change specs, fixing a format mismatch between delta spec and main spec validators.
- **4 skill files** — workflow-orchestrator (mode detection + fast-path routing + DP refs), bridge-contract (hotfix minimal contract), execution-governor (tweak direct edit), closure-archivist (lightweight closure).

## [0.5.0] - 2026-06-29

### Added

- **Guard script system** — `scripts/guard/guard.mjs` provides dimension-based phase transition validation with 5 check dimensions. Exit code ≠ 0 blocks transitions. Reuses existing Validator engine for schema validation.
  - `artifacts-exist` — checks all 4 planning artifacts + specs/ are present and non-empty
  - `schema-valid` — validates proposal.md and all specs/*/spec.md using the Validator engine
  - `contract-fresh` — compares stored artifacts hash against current artifacts for staleness detection
  - `tasks-complete` — verifies all tasks.md items are checked off
  - `tests-passing` — confirms test_result: pass is recorded in state file
- **Lightweight state file** — `.spec-superflow.yaml` as a derived cache (12 fields) for fast context recovery. Always rebuildable from artifacts via `ssf state rebuild`. Artifacts are the source of truth; state file is a performance optimization.
- **SHA256 hash acceleration** — `scripts/lib/hash.mjs` computes artifact hashes for O(1) staleness detection. Reduces staleness detection from ~3500 tokens (full content read) to ~50 tokens (single script call).
- **ssf state CLI** — New `state` subcommand with 5 operations: `init`, `check`, `transition`, `get`, `rebuild`.

### Changed

- **workflow-orchestrator** — Each routing rule now includes a guard script invocation step before allowing transitions.
- **bridge-contract** — Automatically runs `ssf state init` after contract generation.
- **closure-archivist** — Runs `ssf state transition` after verification completes.
- **execution-governor** — Updates `batches_completed` in state file after each batch.

## [0.4.0] - 2026-06-29

### Added

- **CLI toolchain** — `ssf` command with 6 subcommands: `list` (scan changes and report status), `validate` (artifact validation via Validator), `doctor` (health check: version sync, hooks, skills, dist, node, docs, config), `version` (one-command version sync to all manifests), `sync` (delta spec merge with conflict detection), `config` (display/modify configuration). Zero dependencies via `node:util.parseArgs`.
- **Configuration system** — Optional `spec-superflow.config.json` for customizing artifact order, skip list, execution thresholds, and verification language. Absence = v0.3.0 defaults. Deep-merge with built-in defaults. Skills query config at runtime via `scripts/get-config` bash helper.
- **Multi-language tokenizer** — `src/validation/tokenizer.ts` with English stemmer (extracted from validator) + Chinese CJK tokenizer (Unicode ranges + 2-5 char sliding window + stop words). Auto-detection based on CJK character ratio. Mixed mode runs both tokenizers and unions results.
- **Conflict detection** — `Validator.detectSyncConflicts()` detects when multiple changes modify the same requirement across unsynced delta specs. Integrated into `ssf sync` command and `spec-syncer` skill pre-flight check.
- **git worktree isolation** — execution-governor now recommends worktree creation when executing on main/master branch. Pure SKILL.md guidance, no code changes.

### Changed

- **package.json** — Added `bin` field exposing `ssf` and `spec-superflow` commands.
- **validateImplementation()** — Refactored to use `tokenize()` instead of inline `stem()`. Added optional `config` parameter for language override (`'auto' | 'en' | 'zh'`). Backward compatible — existing callers work unchanged.
- **Tokenizer refinements** — CJK sliding window extended to 2-5 chars (covers compound words like "令牌桶算法"). English min token length lowered to 3 (preserves short tokens like "jwt"). Added "based"/"using"/"used" to English stop words.
- **Version manifests** — `.cursor-plugin/plugin.json` and `gemini-extension.json` now tracked in version sync (previously lagging at 0.2.0 and 0.1.0).

### Fixed

- **Version consistency** — `ssf version` command ensures all 5 manifest files stay in sync. `ssf doctor` reports inconsistencies as warnings.

## [0.3.0] - 2026-06-27

### Added

- **Inline execution mode** — Lightweight single-session execution for small changes (≤ 3 tasks, no cross-module dependencies). Parallel to SDD subagent mode. Preserves TDD Iron Law with checkpoint review per task. Automatic mode selection with user override.
- **Abandoned terminal state** — 8th workflow state allowing graceful change abandonment from any non-terminal state. Generates `abandonment-summary.md` with reason, lessons learned, and recommendations. Blocks delta spec merge for abandoned changes. Partial code preservation supported.
- **Three-dimensional verification** — closure-archivist now verifies Completeness (all tasks/requirements implemented), Correctness (tests pass, no placeholders), and Coherence (design decisions reflected in code). New `Validator.validateImplementation()` API with word-stemming and keyword matching.
- **abandonment-summary.md template** — Structured template for documenting abandoned changes.
- **Verification types** — New exports: `VerificationDimension`, `VerificationStatus`, `VerificationFinding`, `VerificationReport`.

### Changed

- **spec-forger task planning** — Rewritten with writing-plans methodology: File Structure section, Interfaces block (Consumes/Produces), per-task TDD expansion (5 phases), exact file paths with line ranges, zero placeholder enforcement, 2-5 minute granularity per step.
- **execution-contract.md template** — Added Execution Mode (SDD | Inline) selection field and Verification Dimensions table.
- **tasks.md template** — Added File Structure and Interfaces sections for cross-batch dependency tracking.
- **State machine** — Extended from 7 to 8 states (+abandoned terminal state). Universal abandoned transition from any non-terminal state.
- **Validator engine** — New `validateImplementation(diffSummary, specContent, designContent)` method with three-dimensional `VerificationReport` return type. Word-stemming for Completeness matching, keyword-based Coherence checking.
- **closure-archivist** — Verification steps expanded from 3 to 5 (Correctness, Completeness, Coherence, Unintended Scope Detection, Verification Report). Structured output with PASS/CONDITIONAL/FAIL verdict.
- **spec-syncer** — Pre-flight guard blocks sync for abandoned changes.

## [0.2.1] - 2026-06-27

### Fixed

- **hooks.json format** — Changed from incorrect array format to Claude Code plugin record format. Event name corrected from `Startup|Clear|Compact` to standard `SessionStart`. Command path now uses `${CLAUDE_PLUGIN_ROOT}` environment variable for cross-platform compatibility.

## [0.2.0] - 2026-06-26

### Added

- **Engine layer (`src/`)** — embedded OpenSpec schema/validation/parsing engine in TypeScript
  - `src/schema/` — Requirement, Delta (ADDED/MODIFIED/REMOVED/RENAMED), Spec, Change type definitions
  - `src/validation/` — Validator class with validateSpecContent, validateChangeContent, validateDeltaSpec
  - `src/parsing/` — Requirement block parser + Delta spec parser (self-contained, no external deps)
- **3 new skills** (6 → 9 total):
  - `systematic-debugger` — 4-phase root cause debugging (Root Cause → Pattern → Hypothesis → Implementation)
  - `code-reviewer` — Unified code review (request + receive), 3 severity levels (Critical/Important/Minor)
  - `spec-syncer` — Delta Spec → Main Spec intelligent merge with conflict detection
- **SDD (Subagent-Driven Development)** — Full implementation discipline embedded in `execution-governor`:
  - `implementer-prompt.md` — Subagent implementation template with TDD evidence + self-review
  - `task-reviewer-prompt.md` — Dual-verdict review (spec compliance + code quality)
  - `code-reviewer-prompt.md` — Structured code review template
- **Helper scripts (`scripts/`)** — `task-brief`, `review-package`, `validate-artifacts`
- **Session-start hooks (`hooks/`)** — Multi-platform bootstrap (Claude Code / Cursor / Copilot CLI)
- **Content-level stale detection** — `workflow-orchestrator` now compares proposal scope vs contract intent lock

### Changed

- State machine extended from 6 to 7 states (+`debugging`)
- All 6 existing skills enhanced with embedded engine capabilities:
  - `spec-explorer` — embedded brainstorming's "one question at a time + 2-3 approach comparison"
  - `spec-forger` — Schema engine validation on every artifact + writing-plans task granularity
  - `bridge-contract` — parsing engine auto-extraction of contract fields
  - `execution-governor` — Full TDD Iron Law + SDD workflow + Review Gates
  - `closure-archivist` — verification-before-completion Iron Law
  - `workflow-orchestrator` — content-level inspection + 3 new routing targets
- Plugin metadata updated to v0.2.0 with expanded keywords across all manifest files

### Release Quality

- **TypeScript compilation** — Added `tsconfig.json` (ES2022, NodeNext, strict mode), `npm run build` produces `dist/` with declarations
- **Integration tests** — 8 test cases using real example artifacts (`docs/examples/`), `npm test` passes
- **package.json** — `main` points to `dist/index.js`, `types` to `dist/index.d.ts`
- **Documentation** — Updated English README Current Status to v0.2.0

## [0.1.0] - 2026-06-25

### Added

- Initial self-contained `spec-superflow` plugin structure
- Plugin metadata in `.claude-plugin/plugin.json`
- Six workflow skills:
  - `workflow-orchestrator`
  - `spec-explorer`
  - `spec-forger`
  - `bridge-contract`
  - `execution-governor`
  - `closure-archivist`
- Planning templates:
  - `proposal.md`
  - `spec.md`
  - `design.md`
  - `tasks.md`
  - `execution-contract.md`
- Workflow docs:
  - `docs/artifact-contract.md`
  - `docs/state-machine.md`
- Example change sets:
  - `docs/examples/add-dark-mode/` (net-new UI capability)
  - `docs/examples/refactor-auth-boundary/` (brownfield backend refactor)
- Installation guide in `INSTALL.md`
- Chinese publishing README in `README.zh-CN.md`
- Repository governance files: `.gitignore`, `CONTRIBUTING.md`, `docs/release-checklist.md`

### Notes

- First release targets Claude Code and Trae style local skill loading
- Runtime ownership remains inside `spec-superflow`
- OpenSpec and Superpowers are reference influences, not runtime dependencies
