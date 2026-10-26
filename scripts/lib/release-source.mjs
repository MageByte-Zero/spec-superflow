import { mkdtemp } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export async function cloneRelease(tag, { clone = execFileSync, logger = console } = {}) {
  const stagingDir = await mkdtemp(join(tmpdir(), 'spec-superflow-'));
  const pluginRoot = join(stagingDir, 'repo');
  logger.log(`📥 Cloning ${tag} into ${pluginRoot} ...`);
  try {
    clone('git', ['clone', '--depth', '1', '--branch', tag,
      'https://github.com/MageByte-Zero/spec-superflow.git', pluginRoot], { stdio: 'inherit' });
    return { pluginRoot, stagingDir };
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}
