import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

describe('marketplace release gate', () => {
  it('blocks tagged releases until the marketplace manifest matches the tag version', () => {
    const releaseJob = workflow.indexOf('\n  release:\n');
    const gate = workflow.indexOf('name: Verify marketplace release gate');
    const githubRelease = workflow.indexOf('name: Create GitHub Release');
    const npmPublish = workflow.indexOf('name: Publish to npm');

    assert.ok(releaseJob >= 0, 'workflow must define a release job');
    assert.ok(gate >= 0, 'release workflow must verify marketplace delivery');
    assert.ok(gate > releaseJob, 'marketplace verification must remain in the release job');
    assert.doesNotMatch(workflow.slice(0, releaseJob), /name: Verify marketplace release gate/);
    assert.match(workflow.slice(releaseJob), /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/);
    assert.ok(gate < githubRelease, 'marketplace verification must run before GitHub Release creation');
    assert.ok(gate < npmPublish, 'marketplace verification must run before npm publish');
    assert.match(workflow, /EXPECTED_VERSION: \$\{\{ github\.ref_name \}\}/);
    assert.match(workflow, /verify-marketplace-release\.mjs[\s\S]*--expected-version "\$\{EXPECTED_VERSION#v\}"/);
    assert.match(workflow, /hashgraph-online\/awesome-codex-plugins\/main\/plugins\/MageByte-Zero\/spec-superflow\/\.codex-plugin\/plugin\.json/);
  });
});
