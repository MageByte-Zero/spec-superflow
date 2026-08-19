// scripts/lib/path-shim.mjs
// Cross-platform user PATH management and `ssf` command shim generation for
// the CodeBuddy installer.
//
// Goals:
//   - Reproduce the npm global-install experience (a `ssf` command available
//     in every shell) for `ssf install-codebuddy`.
//   - PATH handling is split into pure functions (testable without touching
//     the real environment) plus thin platform adapters (PowerShell on
//     Windows, shell rc files on POSIX).
//   - Idempotent: re-running the installer never duplicates PATH entries;
//     the uninstaller removes exactly the entries it added.
//
// Deploy layout produced by this module:
//   <codebuddyRoot>/spec-superflow/bin/
//     ├── ssf        (POSIX shell shim)
//     ├── ssf.cmd    (Windows CMD shim)
//     └── ssf.ps1    (Windows PowerShell shim)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { shellQuote } from './shell-quote.mjs';

// ─── PATH pure functions ──────────────────────────────────
//
// These take explicit `platform`/`home` arguments so tests can exercise both
// Windows and POSIX semantics on any host.

/** Split a PATH string into non-empty entries. Windows uses ';', POSIX ':'. */
export function splitPathEntries(pathString, platform = process.platform) {
  if (!pathString) return [];
  const sep = platform === 'win32' ? ';' : ':';
  return pathString.split(sep).filter(entry => entry.length > 0);
}

/** Join PATH entries back into a PATH string. */
export function joinPathEntries(entries, platform = process.platform) {
  const sep = platform === 'win32' ? ';' : ':';
  return entries.join(sep);
}

/**
 * Normalize one PATH entry: trim, expand a leading `~`, and strip trailing
 * path separators (keeping the filesystem root).
 */
export function normalizePathEntry(entry, home = homedir(), platform = process.platform) {
  let p = typeof entry === 'string' ? entry.trim() : '';
  if (!p) return p;
  if (p === '~') {
    p = home;
  } else if (p.startsWith('~/') || (platform === 'win32' && p.startsWith('~\\'))) {
    const sep = platform === 'win32' ? '\\' : '/';
    p = home.replace(/[\\/]+$/, '') + sep + p.slice(2);
  }
  const root = platform === 'win32' ? /^[a-zA-Z]:[\\/]$/ : /^[\\/]$/;
  while (p.length > 1 && (p.endsWith('/') || (platform === 'win32' && p.endsWith('\\')))) {
    if (root.test(p)) break;
    p = p.slice(0, -1);
  }
  return p;
}

/** Compare two PATH entries. Windows compares case-insensitively. */
export function pathEntriesEqual(a, b, platform = process.platform) {
  if (platform === 'win32') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/** Whether a PATH string already contains an entry equivalent to `target`. */
export function pathContainsEntry(pathString, target, { platform = process.platform, home = homedir() } = {}) {
  const norm = normalizePathEntry(target, home, platform);
  return splitPathEntries(pathString, platform).some(entry =>
    pathEntriesEqual(normalizePathEntry(entry, home, platform), norm, platform),
  );
}

/**
 * Add `target` to a PATH string if absent. Returns `{ path, added }`; never
 * mutates the input, never duplicates.
 */
export function addPathEntry(pathString, target, { platform = process.platform, home = homedir() } = {}) {
  if (pathContainsEntry(pathString, target, { platform, home })) {
    return { path: pathString, added: false };
  }
  const norm = normalizePathEntry(target, home, platform);
  const sep = platform === 'win32' ? ';' : ':';
  const next = pathString && pathString.length > 0 ? `${pathString}${sep}${norm}` : norm;
  return { path: next, added: true };
}

/** Remove every entry equivalent to `target` from a PATH string. */
export function removePathEntry(pathString, target, { platform = process.platform, home = homedir() } = {}) {
  const norm = normalizePathEntry(target, home, platform);
  const entries = splitPathEntries(pathString, platform);
  const kept = entries.filter(entry =>
    !pathEntriesEqual(normalizePathEntry(entry, home, platform), norm, platform),
  );
  return { path: joinPathEntries(kept, platform), removed: kept.length < entries.length };
}

// ─── shim generation ──────────────────────────────────────

/**
 * Build the three `ssf` shim contents, each forwarding arguments to
 * `node <pluginRoot>/scripts/spec-superflow.mjs`.
 *
 * @param {string} pluginRootAbs absolute plugin runtime root
 * @returns {{ ssf: string, ssfCmd: string, ssfPs1: string }}
 */
export function shimContents(pluginRootAbs) {
  const scriptPath = join(pluginRootAbs, 'scripts', 'spec-superflow.mjs');
  // POSIX: single-quoted path (shellQuote escapes embedded quotes).
  const posix = `exec node ${shellQuote(scriptPath)} "$@"`;
  // Windows: double-quoted path survives cmd.exe and PowerShell.
  const cmdPath = `"${scriptPath}"`;
  return {
    ssf: `#!/bin/sh\n# spec-superflow ssf launcher (generated by ssf install-codebuddy)\n${posix}\n`,
    ssfCmd: `@ECHO off\r\nREM spec-superflow ssf launcher (generated by ssf install-codebuddy)\r\nnode ${cmdPath} %*\r\n`,
    ssfPs1: `# spec-superflow ssf launcher (generated by ssf install-codebuddy)\nnode ${cmdPath} $args\n`,
  };
}

/**
 * Write the three shims into `<pluginRootAbs>/bin/`. Returns the bin dir.
 */
export async function writeShims(pluginRootAbs) {
  const binDir = join(pluginRootAbs, 'bin');
  mkdirSync(binDir, { recursive: true });
  const contents = shimContents(pluginRootAbs);
  await writeFile(join(binDir, 'ssf'), contents.ssf, { encoding: 'utf-8', mode: 0o755 });
  await writeFile(join(binDir, 'ssf.cmd'), contents.ssfCmd, 'utf-8');
  await writeFile(join(binDir, 'ssf.ps1'), contents.ssfPs1, 'utf-8');
  return binDir;
}

// ─── shell profile detection (POSIX) ──────────────────────

/**
 * Resolve the rc file for the user's default shell.
 * Returns null on Windows (PATH lives in the user registry environment).
 */
export function detectShellConfigPath(home, shell, platform = process.platform) {
  if (platform === 'win32') return null;
  const name = (shell || '').split('/').pop() || '';
  if (name.includes('zsh')) return join(home, '.zshrc');
  if (name.includes('bash')) return join(home, '.bashrc');
  if (name.includes('fish')) return join(home, '.config', 'fish', 'config.fish');
  // POSIX sh, unknown shells, or an unset $SHELL (GUI-launched terminals).
  return join(home, '.profile');
}

/** Regex-escape a literal string for use inside a RegExp. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether `shell` resolves to fish (the only shell using `set -gx` syntax). */
function isFishShell(shell) {
  const name = (shell || '').split('/').pop() || '';
  return name.includes('fish');
}

/** Escape a path for embedding inside a fish double-quoted string. */
function escapeFishDoubleQuoted(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
}

/**
 * The exact PATH-management line this module manages for a bin dir.
 * Fish uses `set -gx PATH "<binDir>" $PATH`; bash/zsh use `export PATH="<binDir>:$PATH"`.
 *
 * @param {string} binDir normalized bin directory
 * @param {string} [shell] default shell, used to pick the line syntax
 * @returns {string}
 */
export function posixExportLine(binDir, shell = process.env.SHELL) {
  if (isFishShell(shell)) {
    return `set -gx PATH "${escapeFishDoubleQuoted(binDir)}" $PATH`;
  }
  return `export PATH="${binDir}:$PATH"`;
}

/**
 * Build a matcher for the exact managed line (tolerating quote variants),
 * anchored to the whole line so unrelated lines are never touched.
 */
function managedLineMatcher(norm, shell) {
  if (isFishShell(shell)) {
    return new RegExp(`^set\\s+-gx\\s+PATH\\s+["']?${escapeRegExp(escapeFishDoubleQuoted(norm))}["']?\\s+\\$PATH\\s*$`);
  }
  return new RegExp(`^\\s*export\\s+PATH\\s*=\\s*["']${escapeRegExp(norm)}:\\$PATH["']\\s*$`);
}

/**
 * Append the managed PATH line (bash/zsh `export`, fish `set -gx`) to an rc
 * file. Idempotent: returns false (and writes nothing) when the exact line
 * already exists in any quoting variant. Creates the file when missing.
 */
export function addPosixExportLine(rcPath, binDir, { home = homedir(), shell = process.env.SHELL } = {}) {
  const norm = normalizePathEntry(binDir, home, 'linux');
  const existing = existsSync(rcPath) ? readFileSync(rcPath, 'utf-8') : '';
  const matcher = managedLineMatcher(norm, shell);
  if (existing.split('\n').some(line => matcher.test(line))) return false;
  const line = `${posixExportLine(norm, shell)}\n`;
  const next = existing.endsWith('\n') || existing === '' ? existing + line : existing + '\n' + line;
  mkdirSync(dirname(rcPath), { recursive: true });
  writeFileSync(rcPath, next, 'utf-8');
  return true;
}

/**
 * Remove the managed PATH line(s) for a bin dir from an rc file. Only the
 * exact managed line (any quoting variant) is removed; every other line is
 * preserved. Returns true when something was removed.
 */
export function removePosixExportLine(rcPath, binDir, { home = homedir(), shell = process.env.SHELL } = {}) {
  if (!existsSync(rcPath)) return false;
  const norm = normalizePathEntry(binDir, home, 'linux');
  const lines = readFileSync(rcPath, 'utf-8').split('\n');
  const matcher = managedLineMatcher(norm, shell);
  const kept = lines.filter(line => !matcher.test(line));
  if (kept.length === lines.length) return false;
  writeFileSync(rcPath, kept.join('\n'), 'utf-8');
  return true;
}

// ─── user PATH adapters (Windows) ─────────────────────────

/** Default PowerShell executor used on Windows. Injectable for tests. */
export function powershellExec(script) {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf-8' },
  ).trim();
}

/** Read the user-level PATH (HKCU\Environment). */
export async function readWindowsUserPath(executor = powershellExec) {
  return executor("[Environment]::GetEnvironmentVariable('Path','User')");
}

/** Write the user-level PATH (HKCU\Environment). */
export async function writeWindowsUserPath(value, executor = powershellExec) {
  const quoted = JSON.stringify(value);
  executor(`[Environment]::SetEnvironmentVariable('Path', ${quoted}, 'User')`);
}

// ─── unified apply / remove ───────────────────────────────

/**
 * Apply (add or remove) a PATH entry at the user level for the current
 * platform. Options are injectable so tests can exercise every branch.
 *
 * @param {Object} opts
 * @param {string} opts.binDir        directory to register (e.g. .../bin)
 * @param {'add'|'remove'} [opts.action]
 * @param {string} [opts.home]
 * @param {string} [opts.shell]       default shell (POSIX detection)
 * @param {string} [opts.platform]
 * @param {boolean} [opts.dryRun]     report intent without writing
 * @param {Function} [opts.readWindowsUserPath]
 * @param {Function} [opts.writeWindowsUserPath]
 * @returns {Promise<{applied: boolean, detail: string}>}
 */
export async function applyPathEntry({
  binDir,
  action = 'add',
  home = homedir(),
  shell = process.env.SHELL,
  platform = process.platform,
  dryRun = false,
  readWindowsUserPath: readWin = readWindowsUserPath,
  writeWindowsUserPath: writeWin = writeWindowsUserPath,
} = {}) {
  const norm = normalizePathEntry(binDir, home, platform);

  if (platform === 'win32') {
    const current = await readWin();
    const result = action === 'add'
      ? addPathEntry(current, norm, { platform: 'win32', home })
      : removePathEntry(current, norm, { platform: 'win32', home });
    if (!dryRun && (result.added || result.removed)) {
      await writeWin(result.path);
    }
    return {
      applied: Boolean(result.added || result.removed),
      detail: `user PATH (Windows): ${result.added ? 'added' : result.removed ? 'removed' : 'unchanged'} ${norm}`,
    };
  }

  const rcPath = detectShellConfigPath(home, shell, platform);
  if (!rcPath) {
    return { applied: false, detail: `no PATH target for platform ${platform}` };
  }
  const applied = action === 'add'
    ? (!dryRun && addPosixExportLine(rcPath, norm, { home, shell }))
    : (!dryRun && removePosixExportLine(rcPath, norm, { home, shell }));
  return {
    applied,
    detail: `${action === 'add' ? 'added' : 'removed'} PATH entry for ${norm} in ${rcPath}`,
  };
}
