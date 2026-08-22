// tests/lib/path-shim.test.mjs
// Tests for scripts/lib/path-shim.mjs — cross-platform PATH management and
// ssf command shim generation for the CodeBuddy installer.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

// Windows-safe dynamic import: bare Windows paths (D:\...) are not valid ESM
// import specifiers, so convert to a file:// URL. No-op on POSIX.
async function loadModule(relPath) {
  return import(pathToFileURL(join(process.cwd(), relPath)).href);
}

let tempDir;

describe('path-shim PATH pure functions', () => {
  let pathShim;
  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-pathshim-'));
    pathShim = await loadModule('scripts/lib/path-shim.mjs');
  });
  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  describe('splitPathEntries', () => {
    it('splits POSIX PATH on colon', () => {
      assert.deepEqual(
        pathShim.splitPathEntries('/usr/bin:/bin:/opt/tools', 'linux'),
        ['/usr/bin', '/bin', '/opt/tools'],
      );
    });

    it('splits Windows PATH on semicolon', () => {
      assert.deepEqual(
        pathShim.splitPathEntries('C:\\Windows;C:\\bin;C:\\tools', 'win32'),
        ['C:\\Windows', 'C:\\bin', 'C:\\tools'],
      );
    });

    it('returns empty array for empty or falsy input', () => {
      assert.deepEqual(pathShim.splitPathEntries('', 'linux'), []);
      assert.deepEqual(pathShim.splitPathEntries(null, 'linux'), []);
    });

    it('drops empty entries between separators', () => {
      assert.deepEqual(pathShim.splitPathEntries('/a::/b:', 'linux'), ['/a', '/b']);
    });
  });

  describe('normalizePathEntry', () => {
    it('expands ~ to home dir', () => {
      assert.equal(
        pathShim.normalizePathEntry('~/bin', '/home/tester', 'linux'),
        '/home/tester/bin',
      );
    });

    it('strips trailing separator but keeps root', () => {
      assert.equal(pathShim.normalizePathEntry('/opt/tools/', '/home/tester', 'linux'), '/opt/tools');
      assert.equal(pathShim.normalizePathEntry('/', '/home/tester', 'linux'), '/');
    });

    it('strips trailing backslash on Windows', () => {
      assert.equal(pathShim.normalizePathEntry('C:\\tools\\', 'C:\\Users\\tester', 'win32'), 'C:\\tools');
    });

    it('keeps plain paths unchanged', () => {
      assert.equal(pathShim.normalizePathEntry('/usr/local/bin', '/home/tester', 'linux'), '/usr/local/bin');
    });
  });

  describe('pathEntriesEqual', () => {
    it('is case-insensitive on Windows', () => {
      assert.equal(pathShim.pathEntriesEqual('c:\\tools', 'C:\\Tools', 'win32'), true);
    });

    it('is case-sensitive on POSIX', () => {
      assert.equal(pathShim.pathEntriesEqual('/opt/Tools', '/opt/tools', 'linux'), false);
    });
  });

  describe('addPathEntry (idempotent)', () => {
    it('adds an entry when missing', () => {
      const r = pathShim.addPathEntry('/usr/bin:/bin', '/opt/tools', { platform: 'linux', home: '/home/tester' });
      assert.equal(r.added, true);
      assert.equal(r.path, '/usr/bin:/bin:/opt/tools');
    });

    it('does not duplicate an existing entry', () => {
      const r = pathShim.addPathEntry('/usr/bin:/opt/tools:/bin', '/opt/tools', { platform: 'linux', home: '/home/tester' });
      assert.equal(r.added, false);
      assert.equal(r.path, '/usr/bin:/opt/tools:/bin');
    });

    it('is case-insensitive on Windows', () => {
      const r = pathShim.addPathEntry('C:\\Windows;C:\\tools', 'c:\\Tools', { platform: 'win32', home: 'C:\\Users\\tester' });
      assert.equal(r.added, false);
    });

    it('handles empty existing PATH', () => {
      const r = pathShim.addPathEntry('', '/opt/tools', { platform: 'linux', home: '/home/tester' });
      assert.equal(r.added, true);
      assert.equal(r.path, '/opt/tools');
    });
  });

  describe('removePathEntry', () => {
    it('removes a matching entry and keeps others', () => {
      const r = pathShim.removePathEntry('/usr/bin:/opt/tools:/bin', '/opt/tools', { platform: 'linux', home: '/home/tester' });
      assert.equal(r.removed, true);
      assert.equal(r.path, '/usr/bin:/bin');
    });

    it('reports removed=false when entry is absent', () => {
      const r = pathShim.removePathEntry('/usr/bin:/bin', '/opt/tools', { platform: 'linux', home: '/home/tester' });
      assert.equal(r.removed, false);
      assert.equal(r.path, '/usr/bin:/bin');
    });

    it('removes all duplicates of the target', () => {
      const r = pathShim.removePathEntry('/opt/tools:/usr/bin:/opt/tools', '/opt/tools', { platform: 'linux', home: '/home/tester' });
      assert.equal(r.removed, true);
      assert.equal(r.path, '/usr/bin');
    });
  });

  describe('shimContents', () => {
    // On Windows the host join() emits backslashes even for a POSIX-looking
    // input, so assert with a platform-neutral separator class [\\/].
    const SCRIPT_RE = /spec-superflow[\\/]+scripts[\\/]+spec-superflow\.mjs/;

    it('generates POSIX shim with shebang and exec node forwarding', () => {
      const { ssf } = pathShim.shimContents('/home/tester/.codebuddy/spec-superflow');
      assert.ok(ssf.startsWith('#!/bin/sh'));
      assert.match(ssf, new RegExp(`exec node .+${SCRIPT_RE.source}`));
      assert.match(ssf, /\$@/);
    });

    it('generates Windows cmd shim with @ECHO off and %* forwarding', () => {
      const { ssfCmd } = pathShim.shimContents('C:\\Users\\tester\\.codebuddy\\spec-superflow');
      assert.ok(ssfCmd.startsWith('@ECHO off'));
      assert.match(ssfCmd, new RegExp(`node .+${SCRIPT_RE.source}`));
      assert.match(ssfCmd, /%\*/);
    });

    it('generates PowerShell shim with $args forwarding', () => {
      const { ssfPs1 } = pathShim.shimContents('C:\\Users\\tester\\.codebuddy\\spec-superflow');
      assert.match(ssfPs1, new RegExp(`node .+${SCRIPT_RE.source}`));
      assert.match(ssfPs1, /\$args/);
    });

    it('quotes paths containing spaces', () => {
      const { ssf } = pathShim.shimContents('/home/John Doe/.codebuddy/spec-superflow');
      assert.match(ssf, /['"][^'"]*John Doe[^'"]*['"]/);
      const { ssfCmd } = pathShim.shimContents('C:\\Users\\John Doe\\.codebuddy\\spec-superflow');
      assert.match(ssfCmd, /"[^"]*John Doe[^"]*"/);
    });
  });

  describe('detectShellConfigPath', () => {
    it('maps zsh to .zshrc', () => {
      assert.equal(
        pathShim.detectShellConfigPath('/home/tester', '/bin/zsh', 'linux'),
        join('/home/tester', '.zshrc'),
      );
    });

    it('maps bash to .bashrc', () => {
      assert.equal(
        pathShim.detectShellConfigPath('/home/tester', '/bin/bash', 'linux'),
        join('/home/tester', '.bashrc'),
      );
    });

    it('maps fish to config.fish', () => {
      assert.equal(
        pathShim.detectShellConfigPath('/home/tester', '/usr/bin/fish', 'linux'),
        join('/home/tester', '.config', 'fish', 'config.fish'),
      );
    });

    it('falls back to .profile when shell is unknown or empty', () => {
      assert.equal(
        pathShim.detectShellConfigPath('/home/tester', '', 'linux'),
        join('/home/tester', '.profile'),
      );
      assert.equal(
        pathShim.detectShellConfigPath('/home/tester', '/usr/bin/tcsh', 'linux'),
        join('/home/tester', '.profile'),
      );
    });

    it('returns null on Windows (registry-based PATH)', () => {
      assert.equal(pathShim.detectShellConfigPath('C:\\Users\\tester', 'C:\\Program Files\\Git\\bin\\bash.exe', 'win32'), null);
    });
  });

  describe('posix rc file line management', () => {
    it('adds an export line and stays idempotent', () => {
      const rc = join(tempDir, '.bashrc');
      writeFileSync(rc, '# existing\n');
      const r1 = pathShim.addPosixExportLine(rc, '/home/tester/.codebuddy/spec-superflow/bin', { home: '/home/tester', shell: '/bin/bash' });
      assert.equal(r1, true);
      const content1 = readFileSync(rc, 'utf-8');
      assert.match(content1, /export PATH="\/home\/tester\/\.codebuddy\/spec-superflow\/bin:\$PATH"/);
      assert.ok(content1.includes('# existing'));

      const r2 = pathShim.addPosixExportLine(rc, '/home/tester/.codebuddy/spec-superflow/bin', { home: '/home/tester', shell: '/bin/bash' });
      assert.equal(r2, false, 'second add must be a no-op');
      const content2 = readFileSync(rc, 'utf-8');
      assert.equal(content1, content2, 'file must not change on re-add');
    });

    it('creates the rc file when missing', () => {
      const rc = join(tempDir, '.zshrc');
      const added = pathShim.addPosixExportLine(rc, '/home/tester/bin', { home: '/home/tester', shell: '/bin/bash' });
      assert.equal(added, true);
      assert.ok(existsSync(rc));
    });

    it('removes only the matching export line', () => {
      const rc = join(tempDir, '.bashrc');
      writeFileSync(
        rc,
        '# keep me\nexport PATH="/home/tester/.codebuddy/spec-superflow/bin:$PATH"\nexport PATH="/usr/bin:$PATH"\n',
      );
      const removed = pathShim.removePosixExportLine(rc, '/home/tester/.codebuddy/spec-superflow/bin', { home: '/home/tester', shell: '/bin/bash' });
      assert.equal(removed, true);
      const content = readFileSync(rc, 'utf-8');
      assert.ok(content.includes('# keep me'));
      assert.ok(content.includes('export PATH="/usr/bin:$PATH"'));
      assert.doesNotMatch(content, /spec-superflow\/bin/);
    });

    it('reports removed=false when no matching line exists', () => {
      const rc = join(tempDir, '.bashrc');
      writeFileSync(rc, 'export PATH="/usr/bin:$PATH"\n');
      const removed = pathShim.removePosixExportLine(rc, '/home/tester/.codebuddy/spec-superflow/bin', { home: '/home/tester', shell: '/bin/bash' });
      assert.equal(removed, false);
      assert.equal(readFileSync(rc, 'utf-8'), 'export PATH="/usr/bin:$PATH"\n');
    });

    it('writes fish set -gx syntax and removes only that line', () => {
      const rc = join(tempDir, '.config', 'fish', 'config.fish');
      const binDir = join(tempDir, '.codebuddy', 'spec-superflow', 'bin');
      const shell = '/usr/bin/fish';

      const added = pathShim.addPosixExportLine(rc, binDir, { home: tempDir, shell });
      assert.equal(added, true);
      const content1 = readFileSync(rc, 'utf-8');
      assert.match(content1, /set -gx PATH ".+bin" \$PATH/);
      assert.doesNotMatch(content1, /export PATH/);

      const again = pathShim.addPosixExportLine(rc, binDir, { home: tempDir, shell });
      assert.equal(again, false, 'fish add must be idempotent');
      assert.equal(readFileSync(rc, 'utf-8'), content1, 'fish file must not change on re-add');

      const removed = pathShim.removePosixExportLine(rc, binDir, { home: tempDir, shell });
      assert.equal(removed, true);
      assert.doesNotMatch(readFileSync(rc, 'utf-8'), /spec-superflow/);
    });

    it('escapes fish-quoted binDir containing spaces or quotes', () => {
      assert.equal(
        pathShim.posixExportLine('/home/John Doe/bin', '/usr/bin/fish'),
        'set -gx PATH "/home/John Doe/bin" $PATH',
      );
      assert.equal(
        pathShim.posixExportLine('/home/Jo"hn/bin', '/usr/bin/fish'),
        'set -gx PATH "/home/Jo\\"hn/bin" $PATH',
      );
      // bash/zsh keep the export syntax regardless of path content
      assert.equal(
        pathShim.posixExportLine('/home/tester/bin', '/bin/bash'),
        'export PATH="/home/tester/bin:$PATH"',
      );
    });

    it('expands ~ using the caller-provided platform', () => {
      const rc = join(tempDir, '.bashrc');
      const added = pathShim.addPosixExportLine(rc, '~/bin', { home: '/home/tester', shell: '/bin/bash', platform: 'darwin' });
      assert.equal(added, true);
      assert.match(readFileSync(rc, 'utf-8'), /export PATH="\/home\/tester\/bin:\$PATH"/);
      const removed = pathShim.removePosixExportLine(rc, '~/bin', { home: '/home/tester', shell: '/bin/bash', platform: 'darwin' });
      assert.equal(removed, true);
      assert.equal(readFileSync(rc, 'utf-8'), '');
    });

    it('escapes bash/zsh double-quoted binDir metacharacters', () => {
      assert.equal(
        pathShim.posixExportLine('/home/Jo"hn/bin', '/bin/bash'),
        'export PATH="/home/Jo\\"hn/bin:$PATH"',
      );
      assert.equal(
        pathShim.posixExportLine('/home/$USER/bin', '/bin/bash'),
        'export PATH="/home/\\$USER/bin:$PATH"',
      );
      assert.equal(
        pathShim.posixExportLine('/home/Jo\\hn/bin', '/bin/bash'),
        'export PATH="/home/Jo\\\\hn/bin:$PATH"',
      );
    });

    it('removes a bash/zsh managed line written with escaped metacharacters', () => {
      const rc = join(tempDir, '.bashrc');
      const binDir = '/home/Jo"hn/bin';
      const added = pathShim.addPosixExportLine(rc, binDir, { home: '/home/tester', shell: '/bin/bash' });
      assert.equal(added, true);
      const removed = pathShim.removePosixExportLine(rc, binDir, { home: '/home/tester', shell: '/bin/bash' });
      assert.equal(removed, true);
      assert.equal(readFileSync(rc, 'utf-8'), '');
    });

    it('removes a user-written postfix export line ($PATH:<norm>)', () => {
      const rc = join(tempDir, '.bashrc');
      const binDir = '/home/tester/.codebuddy/spec-superflow/bin';
      writeFileSync(rc, 'export PATH="$PATH:/home/tester/.codebuddy/spec-superflow/bin"\n');
      const removed = pathShim.removePosixExportLine(rc, binDir, { home: '/home/tester', shell: '/bin/bash' });
      assert.equal(removed, true);
      assert.equal(readFileSync(rc, 'utf-8'), '');
    });

    it('does not remove a mixed-form export line containing other entries', () => {
      const rc = join(tempDir, '.bashrc');
      const line = 'export PATH="/usr/local/bin:$PATH:/home/tester/.codebuddy/spec-superflow/bin"\n';
      writeFileSync(rc, line);
      const removed = pathShim.removePosixExportLine(rc, '/home/tester/.codebuddy/spec-superflow/bin', { home: '/home/tester', shell: '/bin/bash' });
      assert.equal(removed, false);
      assert.equal(readFileSync(rc, 'utf-8'), line);
    });
  });

  describe('applyPathEntry', () => {
    it('adds a POSIX export line and removes it again', async () => {
      const home = tempDir;
      const result = await pathShim.applyPathEntry({
        binDir: join(home, '.codebuddy', 'spec-superflow', 'bin'),
        action: 'add',
        home,
        shell: '/bin/bash',
        platform: 'linux',
      });
      assert.equal(result.applied, true);
      const rc = join(home, '.bashrc');
      assert.ok(existsSync(rc));
      // On Windows the temp home path uses backslashes; assert platform-neutral.
      assert.match(readFileSync(rc, 'utf-8'), /export PATH=".+bin:\$PATH"/);

      const removed = await pathShim.applyPathEntry({
        binDir: join(home, '.codebuddy', 'spec-superflow', 'bin'),
        action: 'remove',
        home,
        shell: '/bin/bash',
        platform: 'linux',
      });
      assert.equal(removed.applied, true);
      assert.doesNotMatch(readFileSync(rc, 'utf-8'), /spec-superflow/);
    });

    it('dryRun reports intent without writing', async () => {
      const home = tempDir;
      const result = await pathShim.applyPathEntry({
        binDir: join(home, '.codebuddy', 'spec-superflow', 'bin'),
        action: 'add',
        home,
        shell: '/bin/zsh',
        platform: 'linux',
        dryRun: true,
      });
      assert.equal(result.applied, false, 'dryRun must not write');
      assert.ok(!existsSync(join(home, '.zshrc')), 'dryRun must not create the rc file');
    });

    it('dryRun reports "would add" instead of "added"', async () => {
      const home = tempDir;
      const result = await pathShim.applyPathEntry({
        binDir: join(home, '.codebuddy', 'spec-superflow', 'bin'),
        action: 'add',
        home,
        shell: '/bin/bash',
        platform: 'linux',
        dryRun: true,
      });
      assert.equal(result.applied, false);
      assert.match(result.detail, /would add/);
      assert.doesNotMatch(result.detail, /\badded\b/);
    });

    it('reports "unchanged" on a no-op re-add', async () => {
      const home = tempDir;
      const binDir = join(home, '.codebuddy', 'spec-superflow', 'bin');
      await pathShim.applyPathEntry({ binDir, action: 'add', home, shell: '/bin/bash', platform: 'linux' });
      const result = await pathShim.applyPathEntry({ binDir, action: 'add', home, shell: '/bin/bash', platform: 'linux' });
      assert.equal(result.applied, false);
      assert.match(result.detail, /unchanged/);
      assert.doesNotMatch(result.detail, /\badded\b/);
    });

    it('returns applied=false and "would add" on Windows dryRun', async () => {
      const result = await pathShim.applyPathEntry({
        binDir: 'C:\\Users\\tester\\bin',
        action: 'add',
        home: 'C:\\Users\\tester',
        platform: 'win32',
        dryRun: true,
        readWindowsUserPath: async () => 'C:\\Windows',
        writeWindowsUserPath: async () => {},
      });
      assert.equal(result.applied, false);
      assert.match(result.detail, /would add/);
    });

    it('adds a fish set -gx line and removes it again', async () => {
      const home = tempDir;
      const result = await pathShim.applyPathEntry({
        binDir: join(home, '.codebuddy', 'spec-superflow', 'bin'),
        action: 'add',
        home,
        shell: '/usr/bin/fish',
        platform: 'linux',
      });
      assert.equal(result.applied, true);
      const rc = join(home, '.config', 'fish', 'config.fish');
      assert.ok(existsSync(rc));
      assert.match(readFileSync(rc, 'utf-8'), /set -gx PATH ".+bin" \$PATH/);

      const removed = await pathShim.applyPathEntry({
        binDir: join(home, '.codebuddy', 'spec-superflow', 'bin'),
        action: 'remove',
        home,
        shell: '/usr/bin/fish',
        platform: 'linux',
      });
      assert.equal(removed.applied, true);
      assert.doesNotMatch(readFileSync(rc, 'utf-8'), /spec-superflow/);
    });

    it('updates the Windows user PATH via injected executor', async () => {
      let writtenValue = null;
      const readWin = async () => 'C:\\Windows;C:\\tools';
      const writeWin = async (value) => { writtenValue = value; };

      const result = await pathShim.applyPathEntry({
        binDir: 'C:\\Users\\tester\\.codebuddy\\spec-superflow\\bin',
        action: 'add',
        home: 'C:\\Users\\tester',
        platform: 'win32',
        readWindowsUserPath: readWin,
        writeWindowsUserPath: writeWin,
      });
      assert.equal(result.applied, true);
      assert.equal(writtenValue, 'C:\\Windows;C:\\tools;C:\\Users\\tester\\.codebuddy\\spec-superflow\\bin');

      // Idempotent: adding again writes nothing.
      writtenValue = null;
      const again = await pathShim.applyPathEntry({
        binDir: 'C:\\Users\\tester\\.codebuddy\\spec-superflow\\bin',
        action: 'add',
        home: 'C:\\Users\\tester',
        platform: 'win32',
        readWindowsUserPath: async () => writtenValue || 'C:\\Windows;C:\\tools;C:\\Users\\tester\\.codebuddy\\spec-superflow\\bin',
        writeWindowsUserPath: writeWin,
      });
      assert.equal(again.applied, false);
      assert.equal(writtenValue, null, 'no write on idempotent add');

      // Remove keeps other entries.
      writtenValue = null;
      const removed = await pathShim.applyPathEntry({
        binDir: 'C:\\Users\\tester\\.codebuddy\\spec-superflow\\bin',
        action: 'remove',
        home: 'C:\\Users\\tester',
        platform: 'win32',
        readWindowsUserPath: async () => 'C:\\Windows;C:\\tools;C:\\Users\\tester\\.codebuddy\\spec-superflow\\bin',
        writeWindowsUserPath: writeWin,
      });
      assert.equal(removed.applied, true);
      assert.equal(writtenValue, 'C:\\Windows;C:\\tools');
    });
  });

  describe('writeWindowsUserPath (PowerShell escaping)', () => {
    it('emits a single-quoted literal so backslashes stay single', async () => {
      let captured;
      const executor = (script) => { captured = script; return ''; };
      await pathShim.writeWindowsUserPath('C:\\Users\\test\\bin', executor);
      assert.equal(
        captured,
        "[Environment]::SetEnvironmentVariable('Path', 'C:\\Users\\test\\bin', 'User')",
      );
    });

    it('escapes embedded single quotes by doubling them', async () => {
      let captured;
      const executor = (script) => { captured = script; return ''; };
      await pathShim.writeWindowsUserPath("C:\\Users\\O'Brien\\bin", executor);
      assert.equal(
        captured,
        "[Environment]::SetEnvironmentVariable('Path', 'C:\\Users\\O''Brien\\bin', 'User')",
      );
    });
  });
});
