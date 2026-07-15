# Release Checklist

Use this checklist before publishing a new version of `spec-superflow`.

## Repository Shape

- `README.md` is current
- `docs/README_en.md` is current
- `INSTALL.md` matches the supported installation story
- `CHANGELOG.md` contains the new release entry
- `LICENSE` is present
- `ssf version <semver>` covers all manifests (JSON) + documentation (Markdown/shell)
- `node scripts/check-version-consistency.mjs` passes (also runs in CI)
- Verify all eight runtime-dependent canonical skills use the exact release version, and local installer output rewrites them to its bundled `scripts/spec-superflow.mjs`.
- Verify `.github/plugin/marketplace.json` and `.claude-plugin/marketplace.json` versions match

## Workflow Integrity

- skill descriptions still match their actual responsibilities
- `workflow-start` still acts as the primary entry point
- `contract-builder` still requires explicit approval before execution
- planning artifacts and execution contract roles remain distinct
- self-contained ownership is preserved

## Templates And Docs

- templates reflect the current workflow expectations
- `docs/artifact-contract.md` matches the templates and skills
- `docs/state-machine.md` matches the actual workflow routing model
- examples still demonstrate the documented workflow

## Example Quality

For each example in `docs/examples/`:

- `README.md` explains the scenario
- `proposal.md` defines intent and scope
- `specs/` define testable behavior
- `design.md` defines technical shape and constraints
- `tasks.md` defines execution order
- `execution-contract.md` defines approved build rules

## CLI And Config

- `node scripts/spec-superflow.mjs doctor` — all checks pass
- `node scripts/spec-superflow.mjs version <version> --dry-run` — reports all files in sync
- `node scripts/check-version-consistency.mjs` — exits 0
- `node scripts/spec-superflow.mjs --help` — all subcommands listed
- `node scripts/spec-superflow.mjs install-workbuddy --dry-run` — finds all 9 skills and target paths
- In a temporary HOME/CODEX_HOME with no global `ssf` or plugin-root environment variable, run the canonical runtime and a representative installer smoke test.
- `spec-superflow.config.json` absence still works (backward compatible defaults)
- `package.json` `bin` field points to correct entry script

## AI Agent Marketplace Delivery

- Review `README.md`, `INSTALL.md`, and `CHANGELOG.md` so their installation, upgrade, and release messages match.
- Verify external marketplace delivery instead of treating a tag or npm publish as completion:

  ```bash
  node scripts/verify-marketplace-release.mjs \
    --manifest-url https://raw.githubusercontent.com/hashgraph-online/awesome-codex-plugins/main/plugins/MageByte-Zero/spec-superflow/.codex-plugin/plugin.json \
    --expected-version <semver>
  ```

- Use one 干净 Codex configuration directory for marketplace add, plugin add, and plugin list:

  ```bash
  CODEX_HOME="$(mktemp -d)"
  export CODEX_HOME
  codex plugin marketplace add hashgraph-online/awesome-codex-plugins
  codex plugin add spec-superflow@awesome-codex-plugins
  codex plugin list | rg spec-superflow
  ```

- If the remote marketplace version lags, submit and track the 同步 PR; wait for maintainers to merge and the generator to finish, then rerun the delivery verification and clean-Codex installation check.

## Publishing Checks

- Release preparation does not authorize `git tag`, `npm publish`, GitHub Release creation, marketplace publication, issue closure, or external issue comments. Perform those only after the maintainer explicitly authorizes publication.
- there are no stray `TODO` or `TBD` markers
- links and referenced paths are still valid
- no local-only junk files are included
- `.gitignore` still excludes editor and OS artifacts

## Recommended Final Pass

Do one last read of:

- `README.md`
- `docs/README_en.md`
- `INSTALL.md`
- `skills/workflow-start/SKILL.md`
- `skills/contract-builder/SKILL.md`

If those five files feel coherent together, the release is usually in good shape.
