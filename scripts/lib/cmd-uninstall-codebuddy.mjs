// ssf uninstall-codebuddy — remove spec-superflow from CodeBuddy Code CLI.
//
// Removes ONLY spec-superflow's own artifacts from ~/.codebuddy/:
//   - The SessionStart hook entries referencing spec-superflow in
//     settings.json (preserves other hooks and all other fields like
//     permissions, enabledPlugins)
//   - ~/.codebuddy/spec-superflow/ (runtime deps)
//   - ~/.codebuddy/commands/ssf/ (recovery command adapters)
//   - ~/.codebuddy/rules/phase-guard.md (leaves other rules untouched)
//   - The 9 spec-superflow skill directories under ~/.codebuddy/skills/
//
// Other skills, rules, hooks, and settings entries are preserved. Supports
// --dry-run to preview, --config-dir to target a non-default data directory.

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const PLUGIN_NAME = 'spec-superflow';

// The 9 spec-superflow skills installed into ~/.codebuddy/skills/. Only these
// are removed; unrelated skills in the shared directory are preserved. Keep in
// sync with the skills/ directory in the spec-superflow source repo.
const SPEC_SUPERFLOW_SKILLS = [
  'workflow-start',
  'build-executor',
  'code-reviewer',
  'contract-builder',
  'need-explorer',
  'release-archivist',
  'spec-merger',
  'spec-writer',
  'bug-investigator',
];

function getCodebuddyRoot(configDir) {
  if (configDir) return resolve(configDir);
  return join(homedir(), '.codebuddy');
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return {};
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

/**
 * Return a new settings object with spec-superflow's SessionStart hook entries
 * removed. Does not mutate the input. Other event hooks and all top-level
 * fields (permissions, enabledPlugins, ...) are preserved. If the hooks object
 * becomes empty, it is dropped.
 */
function stripSsfHooks(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const settings = { ...input };
  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    return settings;
  }
  const hooks = { ...settings.hooks };
  if (!Array.isArray(hooks.SessionStart)) {
    if (Object.keys(hooks).length === 0) delete settings.hooks;
    else settings.hooks = hooks;
    return settings;
  }
  const preservedEntries = [];
  for (const entry of hooks.SessionStart) {
    if (!entry || !Array.isArray(entry.hooks)) continue;
    const nonSsf = entry.hooks.filter(
      h => !h || typeof h !== 'object' || !h.command || !h.command.includes(PLUGIN_NAME),
    );
    if (nonSsf.length) {
      preservedEntries.push({ ...entry, hooks: nonSsf });
    }
  }
  if (preservedEntries.length) {
    hooks.SessionStart = preservedEntries;
  } else {
    delete hooks.SessionStart;
  }
  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  } else {
    settings.hooks = hooks;
  }
  return settings;
}

function planUninstall({ configDir } = {}) {
  const codebuddyRoot = getCodebuddyRoot(configDir);
  const targetPluginDir = join(codebuddyRoot, PLUGIN_NAME);
  const targetSkills = join(codebuddyRoot, 'skills');
  const targetCommands = join(codebuddyRoot, 'commands', 'ssf');
  const targetPhaseGuard = join(codebuddyRoot, 'rules', 'phase-guard.md');
  const settingsPath = join(codebuddyRoot, 'settings.json');
  return {
    codebuddyRoot,
    targetPluginDir,
    targetSkills,
    targetCommands,
    targetPhaseGuard,
    settingsPath,
  };
}

export async function uninstallCodeBuddy({ configDir } = {}) {
  const plan = planUninstall({ configDir });
  const removed = [];

  // 1. Strip spec-superflow SessionStart entries from settings.json (preserve
  //    other hooks and all other fields).
  if (existsSync(plan.settingsPath)) {
    const originalText = readFileSync(plan.settingsPath, 'utf-8');
    const original = JSON.parse(originalText);
    const cleaned = stripSsfHooks(original);
    const newText = JSON.stringify(cleaned, null, 2) + '\n';
    if (newText !== originalText) {
      await writeFile(plan.settingsPath, newText, 'utf-8');
      removed.push(`${plan.settingsPath} (stripped spec-superflow SessionStart)`);
    }
  }

  // 2. Remove runtime dir.
  if (existsSync(plan.targetPluginDir)) {
    rmSync(plan.targetPluginDir, { recursive: true, force: true });
    removed.push(plan.targetPluginDir);
  }

  // 3. Remove only the managed recovery command files (resume/save/switch.md).
  //    The shared ~/.codebuddy/commands/ssf/ directory may hold user-created
  //    commands (e.g. custom.md); those must NOT be deleted. Only remove the
  //    directory when it is empty after dropping the managed files.
  const managedCommandFiles = ['resume.md', 'save.md', 'switch.md'];
  for (const file of managedCommandFiles) {
    const filePath = join(plan.targetCommands, file);
    if (existsSync(filePath)) {
      rmSync(filePath, { force: true });
      removed.push(filePath);
    }
  }
  if (existsSync(plan.targetCommands)) {
    const remaining = readdirSync(plan.targetCommands).filter(name => !name.startsWith('.'));
    if (remaining.length === 0) {
      rmSync(plan.targetCommands, { recursive: true, force: true });
      removed.push(plan.targetCommands);
    }
  }

  // 4. Remove phase-guard rule (other rules untouched).
  if (existsSync(plan.targetPhaseGuard)) {
    rmSync(plan.targetPhaseGuard, { force: true });
    removed.push(plan.targetPhaseGuard);
  }

  // 5. Remove the 9 spec-superflow skill directories (other skills untouched).
  if (existsSync(plan.targetSkills)) {
    for (const name of SPEC_SUPERFLOW_SKILLS) {
      const dir = join(plan.targetSkills, name);
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
        removed.push(dir);
      }
    }
  }

  return { plan, removed };
}

export async function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      'config-dir': { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
  });

  const plan = planUninstall({ configDir: values['config-dir'] });

  if (values['dry-run']) {
    console.log('CodeBuddy uninstall plan:');
    console.log(`  Config dir:  ${plan.codebuddyRoot}`);
    console.log(`  Settings:    ${plan.settingsPath} (strip spec-superflow SessionStart, keep rest)`);
    console.log(`  Runtime:     ${plan.targetPluginDir}`);
    console.log(`  Commands:    ${plan.targetCommands}`);
    console.log(`  Phase guard: ${plan.targetPhaseGuard}`);
    console.log(`  Skills (${SPEC_SUPERFLOW_SKILLS.length}): ${SPEC_SUPERFLOW_SKILLS.join(', ')}`);
    console.log(`  Other skills / rules / hooks / settings fields: preserved`);
    return;
  }

  console.log(`🗑️  Uninstalling spec-superflow from ${plan.codebuddyRoot} ...`);
  const { removed } = await uninstallCodeBuddy({ configDir: values['config-dir'] });

  if (removed.length === 0) {
    console.log(`\nℹ️  Nothing to remove — no spec-superflow artifacts found.`);
  } else {
    console.log(`\n✅ Removed ${removed.length} item(s):`);
    for (const path of removed) console.log(`   - ${path}`);
  }
  console.log(`\nNext: restart CodeBuddy Code CLI to clear the cached hook snapshot (see /hooks).`);
}

export { planUninstall, stripSsfHooks, SPEC_SUPERFLOW_SKILLS };
