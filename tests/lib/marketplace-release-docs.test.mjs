import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = file => readFileSync(join(process.cwd(), file), 'utf8');

describe('marketplace release documentation', () => {
  const currentVersion = JSON.parse(read('package.json')).version;

  it('uses the real Codex selectors and upgrade flow', () => {
    const install = read('INSTALL.md');
    assert.match(install, /spec-superflow@awesome-codex-plugins/);
    assert.match(install, /spec-superflow@spec-superflow/);
    assert.match(install, /codex plugin marketplace upgrade awesome-codex-plugins/);
    assert.doesNotMatch(install, /codex plugin update/);
    assert.match(install, /codex plugin list/);
    assert.match(read('README.md'), /spec-superflow@spec-superflow/);
  });

  it('uses the current release tag for direct Codex marketplace installation', () => {
    for (const text of [read('README.md'), read('INSTALL.md')]) {
      assert.match(text, new RegExp(`codex plugin marketplace add MageByte-Zero/spec-superflow --ref v${currentVersion.replaceAll('.', '\\.')}`));
    }
  });

  it('documents that Codex loads skills without SessionStart hooks', () => {
    const manifest = JSON.parse(read('.codex-plugin/plugin.json'));
    const matrix = read('docs/platform-matrix.md');
    assert.deepEqual(manifest.hooks, {});
    assert.match(matrix, /OpenAI Codex CLI[^\n]*\| — \|/);
    assert.match(matrix, /OpenAI Codex App[^\n]*\| — \|/);
    assert.match(read('README.md'), /Codex[^\n]*不[^\n]*SessionStart[^\n]*workflow-start/i);
    assert.match(read('docs/README_en.md'), /Codex[^\n]*does not[^\n]*SessionStart[^\n]*workflow-start/i);
  });

  it('records current release guidance and the external delivery gate', () => {
    const readme = read('README.md');
    const checklist = read('docs/release-checklist.md');
    assert.match(readme, new RegExp(`v${currentVersion.replaceAll('.', '\\.')}`));
    assert.match(readme, /`direct` 或 `planned`/);
    assert.match(checklist, /AI Agent Marketplace Delivery/);
    assert.match(checklist, /verify-marketplace-release/);
    assert.match(checklist, /同步 PR/);
    assert.match(checklist, /干净 Codex/);
    assert.match(checklist, /gh repo sync MageByte-Zero\/awesome-codex-plugins/);
    assert.match(checklist, /gh pr diff <pr-number> --repo hashgraph-online\/awesome-codex-plugins --name-only/);
  });
});
