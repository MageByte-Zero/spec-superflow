import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = file => readFileSync(join(process.cwd(), file), 'utf8');

describe('marketplace release documentation', () => {
  it('uses the real Codex selectors and upgrade flow', () => {
    for (const text of [read('README.md'), read('INSTALL.md')]) {
      assert.match(text, /spec-superflow@awesome-codex-plugins/);
      assert.match(text, /spec-superflow@spec-superflow/);
      assert.match(text, /codex plugin marketplace upgrade awesome-codex-plugins/);
      assert.doesNotMatch(text, /codex plugin update/);
      assert.match(text, /codex plugin list/);
    }
  });

  it('records v1.0 release guidance and the external delivery gate', () => {
    const readme = read('README.md');
    const checklist = read('docs/release-checklist.md');
    assert.match(readme, /v1\.0\.0/);
    assert.match(readme, /Quick、direct Hotfix、Tweak 或 Full/);
    assert.match(checklist, /AI Agent Marketplace Delivery/);
    assert.match(checklist, /verify-marketplace-release/);
    assert.match(checklist, /同步 PR/);
    assert.match(checklist, /干净 Codex/);
    assert.match(checklist, /gh repo sync MageByte-Zero\/awesome-codex-plugins/);
    assert.match(checklist, /gh pr diff <pr-number> --repo hashgraph-online\/awesome-codex-plugins --name-only/);
  });
});
