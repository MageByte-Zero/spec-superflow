// tests/helpers/symlink-support.mjs
// Cross-platform symlink capability probe. Windows requires Developer Mode or
// admin privileges to create symlinks; hosts without either throw EPERM.
// Tests that construct symlink fixtures must skip when the host cannot create
// them — the behavior under test is still fully covered on POSIX CI and on
// Windows runners that support symlinks.
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Probe whether the host can create filesystem symlinks. The probe is
 * injectable so tests can exercise both outcomes deterministically without
 * depending on the host environment.
 *
 * @param {() => boolean} [probe]
 * @returns {boolean}
 */
export function canCreateSymlink(probe = defaultProbe) {
  return probe();
}

function defaultProbe() {
  const dir = mkdtempSync(join(tmpdir(), 'ssf-symlink-probe-'));
  try {
    const target = join(dir, 'target');
    const link = join(dir, 'link');
    writeFileSync(target, 'x');
    symlinkSync(target, link, 'file');
    return existsSync(link);
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
