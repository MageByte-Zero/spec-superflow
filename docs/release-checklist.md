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
- Verify all nine runtime-dependent canonical skills use the exact release version, and local installer output rewrites them to its bundled `scripts/spec-superflow.mjs`.
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
- Recovery remains a control-plane overlay: resume/switch are read-only, save writes only the compatible checkpoint, and no ninth state is documented.
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
- Verify `commands/ssf/resume.md`, `commands/ssf/switch.md`, and `commands/ssf/save.md` are complete canonical Markdown command assets.
- `node --test tests/lib/recovery-command-assets.test.mjs` — scans every command asset for checkout-specific absolute paths; any failure is a release blocker.
- `node scripts/spec-superflow.mjs install-workbuddy --dry-run` — finds all 9 skills, all 3 recovery commands, and target paths.
- Run `install-workbuddy` against a temporary home and verify it installs `ssf:resume`, `ssf:switch`, and `ssf:save` as complete command assets.

  ```bash
  # Local release-candidate smoke: never writes ~/.workbuddy or downloads latest.
  SSF_WORKBUDDY_SMOKE_HOME="$(mktemp -d)"
  if grep -R -F "$PWD/" commands/ssf; then
    echo "Canonical command assets contain the local checkout path" >&2
    exit 1
  fi
  node scripts/spec-superflow.mjs install-workbuddy --local "$PWD" --home "$SSF_WORKBUDDY_SMOKE_HOME"
  SSF_WORKBUDDY_PLUGIN="$SSF_WORKBUDDY_SMOKE_HOME/.workbuddy/plugins/marketplaces/cb_teams_marketplace/plugins/spec-superflow"
  test -f "$SSF_WORKBUDDY_PLUGIN/commands/ssf/resume.md"
  test -f "$SSF_WORKBUDDY_PLUGIN/commands/ssf/switch.md"
  test -f "$SSF_WORKBUDDY_PLUGIN/commands/ssf/save.md"
  if grep -R -F "$PWD/" "$SSF_WORKBUDDY_PLUGIN/commands/ssf"; then
    echo "Installed command assets contain the local checkout path" >&2
    exit 1
  fi
  test "$(find "$SSF_WORKBUDDY_PLUGIN/skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" = 9
  test -d "$SSF_WORKBUDDY_PLUGIN/scripts"
  test -d "$SSF_WORKBUDDY_PLUGIN/docs"
  test -d "$SSF_WORKBUDDY_PLUGIN/templates"
  test -d "$SSF_WORKBUDDY_PLUGIN/dist"
  test -d "$SSF_WORKBUDDY_PLUGIN/hooks"
  test -f "$SSF_WORKBUDDY_PLUGIN/rules/phase-guard.md"
  test -f "$SSF_WORKBUDDY_PLUGIN/.codebuddy-plugin/plugin.json"
  node --input-type=module -e 'import { readFileSync } from "node:fs"; const settings = JSON.parse(readFileSync(process.argv[1], "utf8")); if (settings.enabledPlugins?.["spec-superflow@cb_teams_marketplace"] !== true) throw new Error("WorkBuddy plugin is not enabled");' "$SSF_WORKBUDDY_SMOKE_HOME/.workbuddy/settings.json"
  node --test tests/lib/cmd-install-workbuddy.test.mjs
  ```
- Run `install-codebuddy` against a temporary config dir and verify the `settings.json` SessionStart contract, command rewrite, phase-guard frontmatter, and safe uninstall.

  ```bash
  # Local release-candidate smoke for CodeBuddy (never writes ~/.codebuddy).
  SSF_CODEBUDDY_SMOKE_HOME="$(mktemp -d)"
  node scripts/spec-superflow.mjs install-codebuddy --local "$PWD" --config-dir "$SSF_CODEBUDDY_SMOKE_HOME"
  test -f "$SSF_CODEBUDDY_SMOKE_HOME/settings.json"
  grep -q '"SessionStart"' "$SSF_CODEBUDDY_SMOKE_HOME/settings.json"
  grep -q 'alwaysApply: false' "$SSF_CODEBUDDY_SMOKE_HOME/rules/phase-guard.md"
  ! grep -q 'npx --yes --package spec-superflow@' "$SSF_CODEBUDDY_SMOKE_HOME/commands/ssf/resume.md"
  grep -q 'Bash(node:\*)' "$SSF_CODEBUDDY_SMOKE_HOME/commands/ssf/resume.md"
  test "$(find "$SSF_CODEBUDDY_SMOKE_HOME/skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" = 9
  # Uninstall must preserve unrelated skills/settings.
  mkdir -p "$SSF_CODEBUDDY_SMOKE_HOME/skills/other-skill"
  printf -- '---\nname: other-skill\n---\n' > "$SSF_CODEBUDDY_SMOKE_HOME/skills/other-skill/SKILL.md"
  node scripts/spec-superflow.mjs uninstall-codebuddy --config-dir "$SSF_CODEBUDDY_SMOKE_HOME"
  test -d "$SSF_CODEBUDDY_SMOKE_HOME/skills/other-skill"
  test ! -d "$SSF_CODEBUDDY_SMOKE_HOME/spec-superflow"
  node --test tests/lib/cmd-install-codebuddy.test.mjs
  ```
- `npm run test:raw-mode` — packs the current source and runs a canonical runtime in an empty directory with no plugin-root variables or global `ssf`.
- Run a representative local-installer smoke test.
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

- This check is a **blocking release CI gate**: the upstream marketplace PR must be submitted and merged, and its generated manifest must report the release version, before pushing the `v<semver>` tag. The gate runs before GitHub Release creation and npm publishing.

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
