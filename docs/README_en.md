<h1 align="center">spec-superflow</h1>

<p align="center"><strong>A lean, recoverable AI coding workflow from agreed scope to verified completion</strong></p>

<p align="center">
  <a href="../LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://github.com/MageByte-Zero/spec-superflow/stargazers"><img src="https://img.shields.io/github/stars/MageByte-Zero/spec-superflow" alt="GitHub Stars"></a>
  <a href="https://www.npmjs.com/package/spec-superflow"><img src="https://img.shields.io/npm/v/spec-superflow" alt="npm version"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> · <a href="#two-execution-paths">Execution paths</a> · <a href="#installation">Installation</a> · <a href="#commands">Commands</a> · <a href="../README.md">中文</a>
</p>

---

spec-superflow combines OpenSpec-style planning with Superpowers-style verification discipline in one self-contained plugin. v2 gives new work two entry points: execute a clear, bounded change directly, or approve one short plan before implementation.

Current: `v2.0.1`

The defaults minimize overhead: execute in the current session, review once at the end, verify once at completion, and keep ordinary debugging inside execution. Subagents, per-wave reviews, and worktrees are explicit choices.

Marketplace and platform installers upgrade each skill together with its same-version CLI runtime. Skills invoke only the runtime bundled with that installation, never an unrelated older `ssf` found on `PATH`.

## Why v2

The old flow classified work into several modes and copied state across planning, contracts, execution, and reviews. It could constrain complex work, but charged the same fixed cost to ordinary changes and could bounce between phases when receipts were stale or damaged.

v2 removes the intake questionnaire and handwritten `execution-contract.md` for new work. One execution plan is the sole basis for implementation.

| Previous default | v2 default |
|---|---|
| Five workflow modes | `direct` or `planned` |
| Four planning documents plus a contract | `proposal.md` + `tasks.md`; specs/design only when needed |
| Approval at several phases | One approval of the concrete plan |
| SDD/subagents and task reviews | Current-session execution and one final review |
| Automatic worktree | Feature branch in the current checkout; worktree by request |
| Separate debugging state | Ordinary diagnosis stays in `executing` |
| Several caches can veto a plan | The approved schema v2 execution plan is the only decision record |

Existing changes keep their original state, approval records, and review results. They are not silently migrated or reset.

## Quick start

Node.js 20+ is required.

```bash
npm install -g spec-superflow
mkdir -p changes/fix-login-timeout
```

Use direct execution when the outcome, boundary, and verification are already clear:

```bash
ssf workflow start changes/fix-login-timeout \
  --path direct \
  --scope "Fix login timeout without changing the authentication protocol"

ssf workflow complete changes/fix-login-timeout \
  --verification-command "npm test"
```

When scope needs agreement, create two short files:

```text
changes/add-session-refresh/
├── proposal.md   # outcome, boundaries, acceptance, risks
└── tasks.md      # ordered checkbox tasks and the check result for each task
```

After the user approves that concrete plan:

```bash
ssf workflow start changes/add-session-refresh \
  --path planned \
  --confirm \
  --reason "The user approved proposal.md and tasks.md"

ssf workflow complete changes/add-session-refresh \
  --verification-command "npm test"
```

Planned work defaults to an `inline + final` execution plan. Add `--mode sdd` only when delegation is wanted. Run `ssf isolate <dir> --worktree` only when the change needs a separate checkout.

## Two execution paths

### Direct

Direct fits work with a clear intent, bounded impact, and reproducible verification. It creates no planning pack, recommendation receipt, or execution contract. It records the requested scope and final verification.

If the scope grows, add `proposal.md` and `tasks.md`, then upgrade to planned with one explicit approval. No state-machine restart is required.

### Planned

Planned fits cross-module changes, public interfaces, data semantics, installers, state machines, or any work that needs scope agreement first.

- `proposal.md`: outcome, non-goals, acceptance criteria, and major risks.
- `tasks.md`: uniquely numbered checkbox tasks with completion criteria and check results.
- `specs/`: add when behavioral constraints or the published baseline changes.
- `design.md`: add only when a real technical trade-off needs a decision.

Implementation is serial in the current session by default, followed by a review of the complete Git range. Failed reviews use stable issue IDs. Only three unresolved failures for the same issue require human adjudication; unrelated findings do not share a retry budget.

## Completion and recovery

`workflow complete` runs final verification once. Planned work also requires completed tasks, a current final review, and synchronization of any delta specs. A failure remains in execution for repair and never becomes a forged pass.

“Completion” means saving results that a person can check: the verification command, its exit code, the Git range covered by review, and whether each check passed. A successful verification records `verified`. Only an explicit human decision to ship with a known issue records `accepted-risk`. A failed check, empty review range, or damaged record cannot count as completion.

To end with a known issue after an explicit human decision:

```bash
ssf workflow complete changes/example \
  --accept-risk \
  --confirm \
  --reason "Accept the documented compatibility limit for separate follow-up"
```

The outcome is `accepted-risk`; the original failures remain recorded, and the branch is not integrated automatically.

Recover existing work with:

```bash
ssf resume changes/example
ssf checkpoint list changes/example
```

Missing or damaged approval records, review results, or Git range information fail explicitly. Defaults never synthesize success. See the [state-machine reference](state-machine.md) for legacy and recovery rules.

## Git isolation

The default creates a feature branch in the current checkout:

```bash
ssf isolate changes/example
```

Opt into a worktree only when concurrent checkouts are useful:

```bash
ssf isolate changes/example --worktree
```

The repository, branch, and path are recorded and checked during recovery. `ssf finish` only integrates a verified isolation branch. Failed verification preserves the branch and checkout for repair.

## Installation

### Claude Code

```bash
/plugin marketplace add MageByte-Zero/spec-superflow
/plugin install spec-superflow@spec-superflow
```

### OpenAI Codex CLI / App

```bash
codex plugin marketplace add MageByte-Zero/spec-superflow --ref v2.0.1
codex plugin add spec-superflow@spec-superflow
```

Codex does not enable SessionStart injection; invoke `workflow-start` only when needed, or recover an existing spec-superflow change.

### Cursor

```bash
npx spec-superflow@latest install-cursor
```

### GitHub Copilot CLI

```bash
copilot plugin marketplace add MageByte-Zero/spec-superflow
copilot plugin install spec-superflow@spec-superflow
```

### Gemini CLI

```bash
gemini extensions install https://github.com/MageByte-Zero/spec-superflow
```

The project supports 19 AI coding platforms. See [INSTALL.md](../INSTALL.md) for every installer and uninstall path, and the [platform matrix](platform-matrix.md) for capability differences.

## Commands

| Command | Purpose |
|---|---|
| `ssf workflow start <dir> --path direct|planned` | Start new work |
| `ssf workflow complete <dir> ...` | Verify and record delivery |
| `ssf isolate <dir> [--worktree]` | Create a feature branch or explicit worktree |
| `ssf resume [dir]` | Read recovery context |
| `ssf checkpoint save|list|show` | Save or read task recovery points |
| `ssf validate <dir>` | Validate planning artifacts and delta specs |
| `ssf sync <dir>` | Atomically publish delta specs to the baseline |
| `ssf doctor` | Check installation, versions, and assets |
| `ssf finish <dir>` | Verify and merge recorded isolation |

Run `ssf --help` for the full command list. `workflow recommend/select/accept`, legacy execution plans, and the eight-state router remain only for v1 recovery.

## Design boundaries

- **Planning on demand:** small changes do not pay the fixed cost of full SDD.
- **One authorization source:** the schema v2 plan carries approval and execution mode for new planned work.
- **Evidence first:** empty Git ranges, truncated scopes, damaged hashes, and stale reviews cannot pass.
- **Visible human decisions:** users may accept risk, but the reason remains recorded and verification is never forged.
- **Zero runtime dependencies:** the CLI uses Node.js standard libraries; TypeScript is build-only.
- **Context on demand:** ordinary sessions should not receive the full workflow through global rules or SessionStart hooks.

The project draws from [OpenSpec](https://github.com/Fission-AI/OpenSpec) for specification structure and [Superpowers](https://github.com/obra/superpowers) for TDD, debugging, and review discipline. Neither is a runtime dependency.

## Development

```bash
npm install
npm run build
npm test
npm run validate
npm run check-versions
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) and [CHANGELOG.md](../CHANGELOG.md).

## License

[MIT](../LICENSE)
