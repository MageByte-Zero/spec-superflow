#!/usr/bin/env node
// spec-superflow CLI — zero-dependency CLI for spec management
// Usage: ssf <command> [options]

import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';

const COMMANDS = {
  list:           () => import('./lib/cmd-list.mjs'),
  validate:       () => import('./lib/cmd-validate.mjs'),
  doctor:         () => import('./lib/cmd-doctor.mjs'),
  version:        () => import('./lib/cmd-version.mjs'),
  sync:           () => import('./lib/cmd-sync.mjs'),
  config:         () => import('./lib/cmd-config.mjs'),
  state:          () => import('./lib/cmd-state.mjs'),
  debug:          () => import('./lib/cmd-debug.mjs'),
  inject:         () => import('./lib/cmd-inject.mjs'),
  audit:          () => import('./lib/cmd-audit.mjs'),
  checkpoint:     () => import('./lib/cmd-checkpoint.mjs'),
  save:           () => import('./lib/cmd-save.mjs'),
  handoff:        () => import('./lib/cmd-handoff.mjs'),
  isolate:        () => import('./lib/cmd-isolate.mjs'),
  execution:      () => import('./lib/cmd-execution.mjs'),
  resume:         () => import('./lib/cmd-resume.mjs'),
  switch:         () => import('./lib/cmd-switch.mjs'),
  runtime:        () => import('./lib/cmd-runtime.mjs'),
  workflow:       () => import('./lib/cmd-workflow.mjs'),
  'install-cursor': () => import('./lib/cmd-install-cursor.mjs'),
  'install-workbuddy': () => import('./lib/cmd-install-workbuddy.mjs'),
  'install-cline':    () => import('./lib/cmd-install-cline.mjs'),
  'install-kiro':     () => import('./lib/cmd-install-kiro.mjs'),
  'install-windsurf': () => import('./lib/cmd-install-windsurf.mjs'),
  'install-qwen':     () => import('./lib/cmd-install-qwen.mjs'),
  'install-amazon-q': () => import('./lib/cmd-install-amazon-q.mjs'),
  'install-roocode':  () => import('./lib/cmd-install-roocode.mjs'),
  'install-continue': () => import('./lib/cmd-install-continue.mjs'),
  'install-pi':       () => import('./lib/cmd-install-pi.mjs'),
  'install-qoder':    () => import('./lib/cmd-install-qoder.mjs'),
  'install-zcode':     () => import('./lib/cmd-install-zcode.mjs'),
  'install-codebuddy': () => import('./lib/cmd-install-codebuddy.mjs'),
  'uninstall-codebuddy': () => import('./lib/cmd-uninstall-codebuddy.mjs'),
};

const HELP = `spec-superflow (ssf) — Spec-first workflow CLI

Usage: ssf <command> [options]

Commands:
  list                  List all changes and their status
  validate <dir>        Validate artifacts in a change directory
  doctor                Health check (versions, hooks, skills, docs)
  version <semver>      Sync version to all manifest files
  sync <change-dir>     Merge delta specs into main specs
  config [options]      Display or modify configuration
  config --resolve-model <profile>  Resolve a configured model profile without switching models
  state <sub> <dir>     Manage .spec-superflow.yaml state (init|check|transition|get|rebuild)
  debug attempt record <dir> --id <id> --summary <text> --evidence <path>
                        Record one evidence-backed failed fix attempt
  debug attempt show <dir> [--json]
                        Show failed fix attempts for the current execution context
  debug escalate <dir> --decision <continue|abandon> --reason <text> --confirm
                        Record guarded DP-5 after at least three failed attempts
  inject <dir>          Generate phase-guard artifacts; use --platforms <name|all> when platform is ambiguous
  audit <dir>           Generate decision-point-audit.md from .spec-superflow.yaml
  checkpoint save <change-dir> --task <id> --next <text>
                        Save a task-level recovery checkpoint
  checkpoint list <change-dir>
                        List checkpoints and stale status
  checkpoint show <change-dir> <id>
                        Show one recovery checkpoint
  save <change-dir> --task <id> --next <text>
                        Save a checkpoint through the compatibility shortcut
  handoff create <change-dir> --type <type> --objective <text> --expected-output <text> --acceptance <text>
                        Create an explicit prototype/research/experiment handoff
  handoff list <change-dir>
                        List active and completed handoffs
  handoff finish <change-dir> <id>
                        Validate a handoff result
  handoff resolve <change-dir> <id> --decision <accept|reject|defer>
                        Record the explicit handoff decision
  execution recommend <change-dir> [--wave <id>:<strategy>:<task,...>]
                        List execution modes and an evidence-based recommendation
  execution plan <change-dir> --mode <mode> --confirm --reason <text> --wave <id>:<strategy>:<task,...> [--acknowledge-recommendation]
                        Record a user-confirmed guarded execution plan
  execution show <change-dir> [--json]
                        Show and validate the current execution plan
  execution revise <change-dir> --mode sdd --confirm --reason <text> --wave <id>:<strategy>:<task,...> [--acknowledge-recommendation]
                        Upgrade inline/batch to SDD, or replan existing SDD waves, as a new revision
  execution review <change-dir> --wave <id> --base <sha> --head <sha> --report <path> --verdict pass|fail
                        Record one review receipt for a planned wave
  resume [change-dir] [--json]
                        Recover the only active change or an explicit change context
  switch <change-dir> [--json]
                        Recover an explicit change context without changing the shell
  runtime check-update  Run a portable update check for canonical skills
  runtime infer <dir>   Infer workflow mode without a plugin-root path
  workflow recommend <change-dir> [--task-count <n>] [--file-count <n>] [--config-doc-only yes|no|unknown] [--schema-api-change yes|no|unknown] [--new-module yes|no|unknown] [--behavioral-constraint-change yes|no] [--cross-module-change yes|no] [--uncertainty low|high|unknown] [--request-kind standard|incident] [--affected-path <path>] [--production-behavior yes|no|unknown] [--public-boundary yes|no|unknown] [--installer yes|no|unknown] [--state-machine yes|no|unknown] [--external-side-effect yes|no|unknown] [--data-permission-config-semantics yes|no|unknown] [--expected-behavior-clear yes|no|unknown] [--verification-reproducible yes|no|unknown] [--impact-paths-complete yes|no|unknown]
                        Persist observed intake facts and recommend full, hotfix, tweak, quick, or lightweight without selecting one
  workflow select <change-dir> --mode full|hotfix|tweak|quick|lightweight --confirm --reason <text> [--scope-confirmation <text>] [--acknowledge-recommendation] [--verification tdd|new-test|bounded]
                        Persist a user-confirmed path; a risk-acknowledged Quick requires a verification choice
  workflow accept <change-dir> --source direct-request --verification tdd|new-test|bounded
                        Directly accept a recommended quick or hotfix workflow with the user's chosen verification
  workflow show <change-dir> [--json]
                        Show the saved workflow recommendation or selection recovery state
  runtime guard ...     Run a portable phase-transition guard
  runtime config ...    Read effective configuration (writes are rejected)
  runtime asset read <path>
                        Read one allowlisted package asset for a skill
  install-cursor        Deploy skills/scripts/docs to .cursor/ (local Cursor setup)
  install-workbuddy     Deploy skills to WorkBuddy marketplace and enable them
  install-cline         Deploy to .cline/ + .clinerules/ (Cline)
  install-kiro          Deploy to .kiro/ + .kiro/steering/ (Kiro)
  install-windsurf      Deploy to .windsurf/ + .windsurf/rules/ (Windsurf)
  install-qwen          Deploy to .qwen/ + .qwen/rules/ (Qwen Code)
  install-amazon-q      Deploy to .amazonq/ + .amazonq/rules/ (Amazon Q Developer)
  install-roocode       Deploy to .roo/ + .roo/rules/ (Roo Code)
  install-continue      Deploy to .continue/ + .continue/rules/ (Continue)
  install-pi            Deploy to .pi/skills/ (Pi agent; no rules dir)
  install-qoder         Deploy to .qoder/ + .qoder/rules/ (Qoder)
  install-codebuddy     Deploy to ~/.codebuddy/skills/ + settings.json (CodeBuddy Code CLI)
  uninstall-codebuddy   Remove spec-superflow from ~/.codebuddy/ (CodeBuddy Code CLI)

Options:
  --help, -h            Show this help message
  --version, -v         Show CLI version

Examples:
  ssf list
  ssf validate changes/v0.4.0-platform-evolution/
  ssf doctor
  ssf version 0.4.0
  ssf sync changes/v0.3.0-workflow-enhancements/
  ssf config --get execution.inlineThreshold
  ssf config --resolve-model mechanical
  ssf config --set verification.language=zh
  ssf state init changes/my-change/
  ssf state check changes/my-change/
  ssf state transition changes/my-change/ approved-for-build
  ssf workflow recommend changes/fix-typo --task-count 1 --file-count 1 --config-doc-only no --schema-api-change no --new-module no --behavioral-constraint-change no --cross-module-change no --uncertainty low --request-kind incident
  ssf workflow accept changes/fix-typo --source direct-request --verification bounded
  ssf state get changes/my-change/ batches_completed
  ssf debug attempt record changes/my-change/ --id fix-1 --summary "First fix failed" --evidence changes/my-change/.superpowers/sdd/debug-evidence/fix-1.log
  ssf debug attempt show changes/my-change/ --json
  ssf debug escalate changes/my-change/ --decision continue --reason "Three fixes failed" --confirm
  ssf checkpoint save changes/my-change/ --task 1.1 --next "Run focused tests"
  ssf checkpoint list changes/my-change/
  ssf save changes/my-change/ --task 1.1 --next "Run focused tests"
  ssf handoff create changes/my-change/ --type research --objective "Compare approaches" --expected-output "Recommendation" --acceptance "Evidence recorded"
  ssf resume changes/my-change --json
  ssf switch changes/another-change
  ssf install-cursor
  ssf install-workbuddy
  ssf install-cline --local /path/to/spec-superflow
  ssf install-codebuddy
  ssf uninstall-codebuddy --dry-run
`;

export async function dispatchCli(args, {
  commands = COMMANDS,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const writeStdout = text => stdout.write(text);
  const writeStderr = text => stderr.write(text);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    writeStdout(`${HELP}\n`);
    return { exitCode: 0 };
  }

  if (args.includes('--version') || args.includes('-v')) {
    const pkg = JSON.parse(
      (await import('node:fs')).readFileSync(
        new URL('../package.json', import.meta.url), 'utf-8'
      )
    );
    writeStdout(`${pkg.version}\n`);
    return { exitCode: 0 };
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  if (!commands[command]) {
    writeStderr(`Unknown command: ${command}\n`);
    writeStderr('Run "ssf --help" for available commands.\n');
    return { exitCode: 2 };
  }

  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const mod = await commands[command]();
    const result = await mod.run(commandArgs, { stdout, stderr });
    const exitCode = result?.exitCode ?? process.exitCode ?? 0;
    process.exitCode = previousExitCode;
    return { exitCode };
  } catch (err) {
    process.exitCode = previousExitCode;
    writeStderr(`Error: ${err.message}\n`);
    return { exitCode: 1 };
  }
}

async function main() {
  const result = await dispatchCli(process.argv.slice(2));
  process.exitCode = result.exitCode;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  });
}
