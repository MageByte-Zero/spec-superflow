import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = join(ROOT, 'scripts', 'spec-superflow.mjs');
const run = (args, cwd) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });

test('CatPaw import folder retains the matching CLI and all nine skills after relocation', t => {
  const temp = mkdtempSync(join(tmpdir(), 'ssf-catpaw-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const output = join(temp, 'spec-superflow');
  const packaged = run([CLI, 'package-catpaw', output], temp);
  assert.equal(packaged.status, 0, packaged.stderr);
  assert.match(readFileSync(join(output, 'SKILL.md'), 'utf8'), /^---\r?\nname: spec-superflow\r?\n/);
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  assert.equal(JSON.parse(readFileSync(join(output, 'package.json'), 'utf8')).version, version);
  assert.equal(readdirSync(join(output, 'skills')).length, 9);
  assert.equal(existsSync(join(output, 'scripts', 'sdd-workspace')), false);
  assert.equal(existsSync(join(output, 'docs', 'reviews')), false);
  for (const skill of readdirSync(join(output, 'skills'))) {
    assert.equal(readFileSync(join(output, 'skills', skill, 'SKILL.md'), 'utf8'),
      readFileSync(join(ROOT, 'skills', skill, 'SKILL.md'), 'utf8'));
  }

  const imported = join(temp, 'imported skill');
  renameSync(output, imported);
  const runtime = join(imported, 'scripts', 'spec-superflow.mjs');
  assert.equal(run([runtime, '--version'], tmpdir()).stdout.trim(), version);
  const asset = run([runtime, 'runtime', 'asset', 'read', 'docs/legacy-workflow.md'], tmpdir());
  assert.equal(asset.status, 0, asset.stderr);
  assert.equal(asset.stdout, readFileSync(join(ROOT, 'docs', 'legacy-workflow.md'), 'utf8'));
  const change = join(temp, 'changes', 'demo');
  mkdirSync(change, { recursive: true });
  execFileSync('git', ['init', '--quiet', temp]);
  execFileSync('git', ['-C', temp, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    'commit', '--quiet', '--allow-empty', '-m', 'fixture']);
  const started = run([runtime, 'workflow', 'start', change, '--path', 'direct', '--scope', 'Verify the imported runtime', '--json'], temp);
  assert.equal(started.status, 0, started.stderr);
  assert.equal(existsSync(join(change, '.spec-superflow.yaml')), true);
});

test('CatPaw packaging refuses to overwrite an existing directory', t => {
  const temp = mkdtempSync(join(tmpdir(), 'ssf-catpaw-existing-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const output = join(temp, 'spec-superflow');
  mkdirSync(output);
  writeFileSync(join(output, 'keep.txt'), 'keep');
  const result = run([CLI, 'package-catpaw', output], temp);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exist|已存在/i);
  assert.deepEqual(readdirSync(output), ['keep.txt']);
});

test('CatPaw packaging requires an explicit output directory', () => {
  const result = run([CLI, 'package-catpaw'], tmpdir());
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: ssf package-catpaw/);
});
