import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { join, resolve, basename, relative, sep, isAbsolute, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

function contextPath(changeDir, name = basename(changeDir)) {
  const common = execFileSync('git', ['-C', changeDir, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', stdio: 'pipe' }).trim();
  return join(resolve(changeDir, common), 'ssf-finish', `${encodeURIComponent(name)}.json`);
}
export function readIsolationContext(changeDir) {
  try { return JSON.parse(fs.readFileSync(contextPath(changeDir), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT' || error.status) return null;
    throw error;
  }
}
export function writeIsolationContext(changeDir, record) {
  const file = contextPath(changeDir, record.change_name);
  fs.mkdirSync(resolve(file, '..'), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
}

// Ignored planning files do not travel through Git merge. Preserve and verify
// them before removing their only worktree, retaining the old target too.
export function archiveIsolationChange(changeDir, context) {
  const currentRoot = execFileSync('git', ['-C', changeDir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: 'pipe' }).trim();
  const rel = context.change_relative_path ?? relative(fs.realpathSync.native(currentRoot), fs.realpathSync.native(changeDir));
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('finish requires a change directory strictly inside its checkout');
  for (const root of [context.isolation_root, context.target_root]) {
    let current = root;
    for (const part of rel.split(/[\\/]/)) {
      if (part === '..' || part === '.') throw new Error('unsafe change path in isolation context');
      current = join(current, part);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('change archive path must not traverse symlinks');
    }
  }
  const source = join(context.isolation_root, rel);
  const target = join(context.target_root, rel);
  if (fs.lstatSync(source).isSymbolicLink() || !fs.statSync(source).isDirectory()) throw new Error('active change must be a physical directory');
  const common = execFileSync('git', ['-C', context.target_root, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', stdio: 'pipe' }).trim();
  const archive = join(resolve(context.target_root, common), 'ssf-finish', 'archives', randomUUID());
  fs.mkdirSync(archive, { recursive: true });
  const snapshot = join(archive, 'active-change');
  fs.cpSync(source, snapshot, { recursive: true, dereference: false, verbatimSymlinks: true });
  const expected = treeDigest(source);
  if (expected !== treeDigest(snapshot)) throw new Error('change archive verification failed; isolation retained');
  fs.mkdirSync(dirname(target), { recursive: true });
  const staged = `${target}.ssf-stage-${randomUUID()}`;
  fs.cpSync(snapshot, staged, { recursive: true, dereference: false, verbatimSymlinks: true });
  if (expected !== treeDigest(staged)) throw new Error('target change verification failed; isolation retained');
  const prior = join(archive, 'previous-target');
  let moved = false;
  try {
    if (fs.existsSync(target)) { fs.renameSync(target, prior); moved = true; }
    fs.renameSync(staged, target);
  } catch (error) {
    if (moved && !fs.existsSync(target)) fs.renameSync(prior, target);
    throw error;
  }
  return { archive, target, digest: expected };
}

function treeDigest(directory) {
  const hash = createHash('sha256');
  function visit(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(dir, entry.name), name = `${prefix}${entry.name}`;
      hash.update(JSON.stringify([name, entry.isDirectory() ? 'dir' : entry.isSymbolicLink() ? 'link' : 'file']));
      if (entry.isSymbolicLink()) hash.update(fs.readlinkSync(file));
      else if (entry.isDirectory()) visit(file, `${name}/`);
      else if (entry.isFile()) hash.update(fs.readFileSync(file));
      else throw new Error(`Unsupported change artifact: ${file}`);
    }
  }
  visit(directory);
  return hash.digest('hex');
}
