// scripts/guard/checks/artifacts-exist.mjs — check that required planning artifacts are present and non-empty
import fs from 'node:fs';
import path from 'node:path';
import { artifactPolicy } from '../../lib/workflow-policy.mjs';
import { validateSpecPathLayout } from '../../lib/spec-paths.mjs';

/**
 * Check that required planning artifacts exist and are non-empty,
 * and that the specs/ directory has at least one spec file.
 * Honors artifacts.skip from spec-superflow.config.json.
 */
export function checkArtifactsExist(changeDir) {
  const failures = [];
  const policy = artifactPolicy(changeDir);
  const skipList = policy.skip;
  failures.push(...policy.failures);

  const required = ['proposal.md', 'design.md', 'tasks.md'].filter(
    f => !skipList.includes(f.replace('.md', ''))
  );

  for (const file of required) {
    const filePath = path.join(changeDir, file);
    if (!fs.existsSync(filePath)) {
      failures.push(`${file}: missing`);
    } else if (fs.readFileSync(filePath, 'utf-8').trim().length === 0) {
      failures.push(`${file}: empty`);
    }
  }

  if (!skipList.includes('specs')) {
    const specLayout = validateSpecPathLayout(changeDir, { requireSpecs: true });
    failures.push(...specLayout.failures);
  }

  return { pass: failures.length === 0, failures };
}
