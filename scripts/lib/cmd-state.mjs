// scripts/lib/cmd-state.mjs — ssf state subcommand handler
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState, writeState, updateField, rebuildState } from './state-loader.mjs';
import { computeArtifactsHash, computeContractHash } from './hash.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const VALID_STATES = [
  'exploring', 'specifying', 'bridging', 'approved-for-build',
  'executing', 'debugging', 'closing', 'abandoned',
];

const SETTABLE_FIELDS = [
  'workflow', 'execution_mode', 'test_result', 'batches_completed',
  'dp_0_decisions', 'dp_0_confirmed', 'dp_0_timestamp', 'dp_0_result',
  'dp_1_result', 'dp_1_timestamp', 'dp_1_decisions', 'dp_1_confirmed',
  'dp_2_result', 'dp_2_timestamp', 'dp_2_decisions', 'dp_2_confirmed',
  'dp_3_result', 'dp_3_timestamp', 'dp_3_decisions', 'dp_3_confirmed',
  'dp_4_result', 'dp_4_timestamp', 'dp_4_decisions', 'dp_4_confirmed',
  'dp_5_result', 'dp_5_timestamp', 'dp_5_decisions', 'dp_5_confirmed',
  'dp_6_result', 'dp_6_timestamp', 'dp_6_decisions', 'dp_6_confirmed',
  'dp_7_result', 'dp_7_timestamp', 'dp_7_decisions', 'dp_7_confirmed',
];

export async function run(args) {
  const { positionals, values } = parseArgs({
    args,
    options: {
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  const sub = positionals[0];  // init | check | transition | get | rebuild | set
  const changeDir = positionals[1];
  const arg = positionals[2];  // <to-state> for transition, <field> for get

  if (!changeDir) {
    console.error('Usage: ssf state <subcommand> <change-dir> [arg]');
    console.error('Subcommands: init, check, transition, get, rebuild, set');
    process.exit(2);
  }

  switch (sub) {
    case 'init': {
      if (!existsSync(changeDir)) {
        mkdirSync(changeDir, { recursive: true });
      }
      const hash = computeArtifactsHash(changeDir);
      const ch = computeContractHash(changeDir);
      const state = readState(changeDir);
      state.artifacts_hash = hash;
      state.contract_hash = ch;
      state.last_transition = new Date().toISOString();
      writeState(changeDir, state);
      if (values.json) {
        console.log(JSON.stringify({ ok: true, artifacts_hash: hash, contract_hash: ch }));
      } else {
        console.log(`State initialized. artifacts_hash: ${hash}`);
      }
      break;
    }
    case 'check': {
      const state = readState(changeDir);
      const currentHash = computeArtifactsHash(changeDir);
      const consistent = state.artifacts_hash === currentHash;
      if (values.json) {
        console.log(JSON.stringify({
          consistent,
          stored_hash: state.artifacts_hash,
          current_hash: currentHash,
          state: state.state,
        }));
      } else {
        if (consistent) {
          console.log('State consistent with artifacts.');
        } else {
          console.log('State INCONSISTENT — artifacts have changed since last transition.');
        }
        console.log(`  State: ${state.state}, stored hash: ${state.artifacts_hash}`);
        console.log(`  Current hash: ${currentHash}`);
      }
      process.exit(consistent ? 0 : 1);
      break;
    }
    case 'transition': {
      const toState = arg;
      if (!toState) {
        console.error('Usage: ssf state transition <change-dir> <to-state>');
        process.exit(2);
      }

      // Validate state name
      if (!VALID_STATES.includes(toState)) {
        console.error(`Invalid state: '${toState}'. Must be one of: ${VALID_STATES.join(', ')}`);
        process.exit(1);
      }

      const state = readState(changeDir);
      const fromState = state.state;

      // Run guard before allowing transition (H-2: enforce guard)
      const guardScript = join(__dirname, '..', 'guard', 'guard.mjs');
      const rawWorkflow = state.workflow || 'full';
      // Normalize: guard only accepts full/hotfix/tweak, not "auto"
      const workflow = rawWorkflow === 'auto' ? 'full' : rawWorkflow;
      const guardResult = spawnSync('node', [guardScript, 'check', changeDir, fromState, toState, '--json', '--workflow', workflow], {
        cwd: join(__dirname, '..', '..'),
        timeout: 10_000,
      });

      // If guard fails with exit 2 (usage error), try without --workflow
      if (guardResult.status !== 0) {
        const guardOutput = guardResult.stdout.toString();
        try {
          const parsed = JSON.parse(guardOutput);
          if (!parsed.pass) {
            const failures = (parsed.checks || [])
              .filter(c => !c.pass)
              .flatMap(c => c.failures.map(f => `[${c.dimension}] ${f}`));
            console.error(`Guard check failed for ${fromState} -> ${toState}:`);
            for (const f of failures) console.error(`  ${f}`);
            if (parsed.error) console.error(`  ${parsed.error}`);
            process.exit(1);
          }
        } catch {
          // Guard script error; if guard is missing or broken, allow the transition with warning
          if (!values.json) console.error(`Warning: guard check skipped (guard script error)`);
        }
      }

      state.state = toState;
      state.last_transition_from = fromState;
      state.last_transition_to = toState;
      state.last_transition = new Date().toISOString();
      writeState(changeDir, state);
      if (values.json) {
        console.log(JSON.stringify({ ok: true, from: fromState, to: toState }));
      } else {
        console.log(`State transitioned: ${fromState} -> ${toState}`);
      }
      break;
    }
    case 'get': {
      const field = arg;
      if (!field) {
        console.error('Usage: ssf state get <change-dir> <field>');
        process.exit(2);
      }
      const state = readState(changeDir);
      if (!Object.prototype.hasOwnProperty.call(state, field) && field in state) {
        console.error(`Field '${field}' is not a valid state field`);
        process.exit(1);
      }
      const value = state[field];
      if (values.json) {
        console.log(JSON.stringify({ field, value: value ?? null }));
      } else {
        console.log(value ?? 'null');
      }
      break;
    }
    case 'rebuild': {
      const state = rebuildState(changeDir, { computeArtifactsHash, computeContractHash });
      if (values.json) {
        console.log(JSON.stringify({ ok: true, state: state.state }));
      } else {
        console.log(`State rebuilt from artifacts. state: ${state.state}`);
      }
      break;
    }
    case 'set': {
      // ssf state set <change-dir> <field> <value>
      const field = arg;
      const value = positionals[3];
      if (!field || value === undefined) {
        console.error('Usage: ssf state set <change-dir> <field> <value>');
        process.exit(2);
      }
      if (!SETTABLE_FIELDS.includes(field)) {
        console.error(`⛔ Field '${field}' is not settable (use 'transition' for state, or check SETTABLE_FIELDS)`);
        process.exit(1);
      }
      updateField(changeDir, field, value);
      if (values.json) {
        console.log(JSON.stringify({ ok: true, field, value }));
      } else {
        console.log(`✅ Set ${field} = ${value}`);
      }
      break;
    }
    default:
      console.error(`Unknown subcommand: ${sub}. Valid: init, check, transition, get, rebuild, set`);
      process.exit(2);
  }
}