import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ASSETS } from './cmd-runtime.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function run(args, io = { stdout: process.stdout, stderr: process.stderr }) {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  if (positionals.length !== 1) {
    io.stderr.write('Usage: ssf package-catpaw <new-output-directory>\n');
    return { exitCode: 2 };
  }
  const target = resolve(positionals[0]);
  mkdirSync(dirname(target), { recursive: true });
  // Exclusive creation prevents overwriting an existing skill or user directory.
  mkdirSync(target);
  try {
    for (const asset of ['scripts', 'skills', 'templates', 'dist', 'package.json']) {
      cpSync(join(ROOT, asset), join(target, asset), {
        recursive: true,
        filter: source => source !== join(ROOT, 'scripts', 'sdd-workspace'),
      });
    }
    // Carry runtime references without exporting unrelated local documentation.
    for (const asset of ASSETS) {
      if (!asset.startsWith('docs/')) continue;
      mkdirSync(dirname(join(target, asset)), { recursive: true });
      cpSync(join(ROOT, asset), join(target, asset));
    }
    cpSync(join(ROOT, 'templates', 'catpaw-skill.md'), join(target, 'SKILL.md'));
  } catch (error) {
    rmSync(target, { recursive: true, force: true });
    throw error;
  }
  io.stdout.write(`CatPaw（妙手）技能包已生成：${target}\n在妙手「技能」中导入此文件夹；升级时重新生成并导入整个包。\n`);
  return { exitCode: 0 };
}
