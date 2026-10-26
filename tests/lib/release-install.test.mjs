import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let scratch;
let source;
let preload;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'ssf-release-install-'));
  source = join(scratch, 'source');
  mkdirSync(source);
  for (const asset of ['scripts', 'skills', 'commands', 'docs', 'templates', 'dist', 'hooks', 'package.json']) {
    cpSync(join(ROOT, asset), join(source, asset), { recursive: true });
  }
  const git = args => execFileSync('git', ['-C', source, ...args], { stdio: 'pipe' });
  git(['init', '--quiet']);
  git(['add', '--all']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'release fixture']);
  git(['tag', 'v-test']);

  // Replace only the network boundary; exercise the real installer and Git clone.
  preload = join(scratch, 'offline-clone.mjs');
  writeFileSync(preload, `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, resolve } from 'node:path';
const mkdtemp = fsp.mkdtemp;
fsp.mkdtemp = (prefix, ...args) => {
  assert.equal(resolve(dirname(prefix)), resolve(process.env.SSF_TEST_TEMP), 'installer must use the OS temp directory');
  return mkdtemp(prefix, ...args);
};
const exec = cp.execFileSync;
cp.execFileSync = (command, args, options) => {
  if (command !== 'git' || args[0] !== 'clone') return exec(command, args, options);
  const target = args.at(-1);
  assert.equal(fs.existsSync(target), false, 'clone destination must not exist');
  if (process.env.SSF_TEST_CLONE_FAIL === '1') throw new Error('synthetic clone failure');
  const localArgs = [...args];
  localArgs[localArgs.length - 2] = process.env.SSF_TEST_SOURCE;
  return exec(command, localArgs, { ...options, stdio: 'pipe' });
};
syncBuiltinESMExports();
`);
});

after(() => rmSync(scratch, { recursive: true, force: true }));

for (const platform of ['qoder', 'cursor', 'zcode', 'workbuddy', 'codebuddy']) {
  for (const fail of [false, true]) {
    test(`${platform} release install ${fail ? 'cleans up a failed clone' : 'uses OS temp staging and the bundled runtime'}`, () => {
      const target = mkdtempSync(join(scratch, `${platform}-`));
      const temp = join(target, 'system temp');
      mkdirSync(temp);
      const args = [join(ROOT, 'scripts', 'spec-superflow.mjs'), `install-${platform}`, '--tag', 'v-test'];
      if (platform === 'workbuddy') args.push('--home', target);
      if (platform === 'codebuddy') args.push('--config-dir', join(target, '.codebuddy'), '--no-path');
      const result = spawnSync(process.execPath, args, {
        cwd: target,
        encoding: 'utf8',
        timeout: 30000,
        env: {
          ...process.env,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(preload).href}`,
          TMPDIR: temp, TEMP: temp, TMP: temp,
          SSF_TEST_TEMP: temp, SSF_TEST_SOURCE: pathToFileURL(source).href,
          SSF_TEST_CLONE_FAIL: fail ? '1' : '0',
        },
      });
      if (fail) {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /synthetic clone failure/);
      } else {
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const plugin = platform === 'workbuddy'
          ? join(target, '.workbuddy', 'plugins', 'marketplaces', 'cb_teams_marketplace', 'plugins', 'spec-superflow')
          : join(target, `.${platform}`, 'spec-superflow');
        const skills = platform === 'workbuddy' ? join(plugin, 'skills') : join(target, `.${platform}`, 'skills');
        const skill = readFileSync(join(skills, 'workflow-start', 'SKILL.md'), 'utf8');
        assert.ok(skill.includes(plugin), 'skill must invoke the runtime deployed with it');
        const runtime = join(plugin, 'scripts', 'spec-superflow.mjs');
        assert.ok(existsSync(runtime));
        const version = execFileSync(process.execPath, [runtime, '--version'], { encoding: 'utf8' });
        assert.equal(version.trim(), JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version);
        const asset = execFileSync(process.execPath, [runtime, 'runtime', 'asset', 'read', 'docs/legacy-workflow.md'], { encoding: 'utf8' });
        assert.equal(asset.trimEnd(), readFileSync(join(source, 'docs', 'legacy-workflow.md'), 'utf8').trimEnd());
      }
      assert.deepEqual(readdirSync(temp), [], 'release staging must be removed after success or failure');
    });
  }
}
