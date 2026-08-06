import { parseArgs } from 'node:util';
import { recordDebugAttempt, recordDebugEscalation, showDebugAttempts } from './debug-attempts.mjs';

const OPTIONS = {
  id: { type: 'string' },
  summary: { type: 'string' },
  evidence: { type: 'string' },
  decision: { type: 'string' },
  reason: { type: 'string' },
  confirm: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
};

class UsageError extends Error {}

export function run(args, io = { stdout: process.stdout, stderr: process.stderr }) {
  let parsed;
  try {
    parsed = parseArgs({ args, options: OPTIONS, allowPositionals: true });
  } catch (error) {
    return fail(error.message, 2, io);
  }

  const { positionals, values } = parsed;
  if (values.help || positionals.length === 0) {
    printHelp(io);
    return { exitCode: 0 };
  }

  try {
    if (positionals[0] === 'attempt') {
      if (!['record', 'show'].includes(positionals[1]) || positionals.length !== 3) {
        throw new UsageError('Usage: ssf debug attempt <record|show> <change-dir> [options]');
      }
      const changeDir = positionals[2];
      if (positionals[1] === 'record') {
        const result = recordDebugAttempt(changeDir, {
          id: values.id,
          summary: values.summary,
          evidence: values.evidence,
        });
        return print({ ok: true, ...result }, values.json, io);
      }
      return print({ ok: true, ...showDebugAttempts(changeDir) }, values.json, io);
    }

    if (positionals[0] === 'escalate') {
      if (positionals.length !== 2) {
        throw new UsageError('Usage: ssf debug escalate <change-dir> --decision <continue|abandon> --reason <text> --confirm');
      }
      const result = recordDebugEscalation(positionals[1], {
        decision: values.decision,
        reason: values.reason,
        confirm: values.confirm,
      });
      return print({ ok: true, ...result }, values.json, io);
    }

    throw new UsageError(`Unknown debug subcommand: ${positionals[0]}`);
  } catch (error) {
    return fail(error.message, error instanceof UsageError ? 2 : 1, io);
  }
}

function print(value, json, io) {
  if (json) io.stdout.write(`${JSON.stringify(value)}\n`);
  else if (value.attempt) io.stdout.write(`Debug attempt ${value.attempt.id} recorded (${value.attempt_count}/3).\n`);
  else if (value.escalation) io.stdout.write(`DP-5 recorded: ${value.escalation.result}\n`);
  else io.stdout.write(`Debug attempts recorded: ${value.attempt_count}\n`);
  return { exitCode: 0 };
}

function fail(message, exitCode, io) {
  io.stderr.write(`${message}\n`);
  return { exitCode };
}

function printHelp(io) {
  io.stdout.write(`Usage:
  ssf debug attempt record <dir> --id <id> --summary <text> --evidence <path> [--json]
  ssf debug attempt show <dir> [--json]
  ssf debug escalate <dir> --decision <continue|abandon> --reason <text> --confirm [--json]\n`);
}
