import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = file => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const ciJob = (ci, name, nextName) => {
  const start = ci.indexOf(`  ${name}:`);
  const end = nextName ? ci.indexOf(`  ${nextName}:`, start) : ci.length;
  return ci.slice(start, end);
};

describe('Node 20 compatibility contract', () => {
  it('declares Node 20 in package metadata and lockfile', () => {
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    assert.equal(pkg.engines.node, '>=20');
    assert.equal(lock.packages[''].engines.node, '>=20');
    assert.equal(lock.packages['node_modules/typescript'].engines.node, '>=14.17');
  });

  it('isolates CI jobs so adjacent runtime settings cannot satisfy a job contract', () => {
    const fixture = `  build-and-test:
    strategy:
      matrix:
        node-version: [20, 22]
    steps:
      - uses: actions/setup-node
        with:
          node-version: 22
  platform-install-smoke:
    strategy:
      matrix:
        node-version: [20, 22]
    steps:
      - uses: actions/setup-node
        with:
          node-version: \${{ matrix.node-version }}`;

    assert.doesNotMatch(
      ciJob(fixture, 'build-and-test', 'platform-install-smoke'),
      /node-version: \$\{\{ matrix\.node-version \}\}/,
    );
  });

  it('runs build, test, doctor, CLI smoke, and installers on Node 20 and 22', () => {
    const ci = read('.github/workflows/ci.yml');
    const build = ciJob(ci, 'build-and-test', 'platform-install-smoke');
    const platform = ciJob(ci, 'platform-install-smoke', 'release');
    const release = ciJob(ci, 'release');

    for (const job of [build, platform]) {
      assert.match(job, /node-version: \[20, 22\]/);
      assert.match(job, /node-version: \$\{\{ matrix\.node-version \}\}/);
    }

    assert.match(build, /- run: npm run build/);
    assert.match(build, /- run: npm test/);
    assert.match(build, /run: node scripts\/check-version-consistency\.mjs/);
    assert.match(build, /node scripts\/spec-superflow\.mjs doctor/);
    assert.match(build, /node scripts\/spec-superflow\.mjs --version/);
    assert.match(build, /config --get execution\.inlineThreshold/);
    assert.match(release, /node-version: 22\n          registry-url:/);
  });

  it('keeps project guidance aligned with the Node 20 test command', () => {
    const guide = read('AGENTS.md');
    assert.match(guide, /Node 20\+ native test runner/);
    assert.match(guide, /tests\/e2e\.test\.mjs/);
    assert.doesNotMatch(guide, /experimental-strip-types/);
  });
});
