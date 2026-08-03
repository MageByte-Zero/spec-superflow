import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createGitSeedFixture } from './git-seed-fixture.mjs';

function runGit(directory, args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
}

function snapshot(directory) {
  return {
    head: runGit(directory, ['rev-parse', 'HEAD']),
    commits: Number(runGit(directory, ['rev-list', '--count', 'HEAD'])),
    config: runGit(directory, ['config', '--local', '--get', 'fixture.label']),
    status: runGit(directory, ['status', '--short', '--ignored']),
    linkTarget: readlinkSync(join(directory, 'tracked-link')),
  };
}

describe('Git seed/copy fixture', () => {
  let fixture;
  let firstCopy;
  let adjacentCopy;

  before(() => {
    fixture = createGitSeedFixture({
      setup(directory) {
        writeFileSync(join(directory, '.gitignore'), '*.ignored\n');
        writeFileSync(join(directory, 'tracked.txt'), 'seeded content\n');
        writeFileSync(join(directory, 'alternate.txt'), 'alternate content\n');
        symlinkSync('tracked.txt', join(directory, 'tracked-link'));
      },
      initialCommitMessage: 'initial fixture',
      secondCommit: {
        path: 'second-commit.txt',
        content: 'second commit\n',
        message: 'second fixture commit',
      },
      config: { name: 'Fixture Test', email: 'fixtures@example.invalid', values: { 'fixture.label': 'seed' } },
    });
    firstCopy = fixture.createCopy();
    adjacentCopy = fixture.createCopy();
  });

  after(() => {
    fixture?.dispose();
  });

  it('gives every copy an independent worktree, .git metadata, and seeded two-commit history', () => {
    const seed = snapshot(fixture.seed);
    const first = snapshot(firstCopy);
    const adjacent = snapshot(adjacentCopy);

    assert.equal(seed.commits, 2);
    assert.deepEqual(first, seed);
    assert.deepEqual(adjacent, seed);
    assert.notEqual(firstCopy, adjacentCopy);
    assert.notEqual(firstCopy, fixture.seed);
    assert.notEqual(adjacentCopy, fixture.seed);
    const seedGitDirectory = lstatSync(join(fixture.seed, '.git'));
    const firstGitDirectory = lstatSync(join(firstCopy, '.git'));
    const adjacentGitDirectory = lstatSync(join(adjacentCopy, '.git'));
    assert.equal(seedGitDirectory.isSymbolicLink(), false);
    assert.equal(firstGitDirectory.isSymbolicLink(), false);
    assert.equal(adjacentGitDirectory.isSymbolicLink(), false);
    assert.notEqual(firstGitDirectory.ino, adjacentGitDirectory.ino);
    assert.notEqual(firstGitDirectory.ino, seedGitDirectory.ino);
  });

  it('keeps the seed and adjacent copy unchanged when one copy mutates Git and filesystem state', () => {
    const expectedSeed = snapshot(fixture.seed);
    const expectedAdjacent = snapshot(adjacentCopy);

    runGit(firstCopy, ['config', '--local', 'fixture.label', 'changed']);
    writeFileSync(join(firstCopy, 'untracked.txt'), 'only first copy\n');
    writeFileSync(join(firstCopy, 'only-first.ignored'), 'only first copy\n');
    unlinkSync(join(firstCopy, 'tracked-link'));
    symlinkSync('alternate.txt', join(firstCopy, 'tracked-link'));
    writeFileSync(join(firstCopy, 'tracked.txt'), 'changed only in first copy\n');

    assert.equal(runGit(firstCopy, ['config', '--local', '--get', 'fixture.label']), 'changed');
    assert.match(runGit(firstCopy, ['status', '--short', '--ignored']), /\?\? untracked\.txt/);
    assert.match(runGit(firstCopy, ['status', '--short', '--ignored']), /!! only-first\.ignored/);
    assert.equal(readlinkSync(join(firstCopy, 'tracked-link')), 'alternate.txt');

    assert.deepEqual(snapshot(fixture.seed), expectedSeed);
    assert.deepEqual(snapshot(adjacentCopy), expectedAdjacent);
    assert.equal(existsSync(join(fixture.seed, 'untracked.txt')), false);
    assert.equal(existsSync(join(adjacentCopy, 'untracked.txt')), false);
    assert.equal(existsSync(join(fixture.seed, 'only-first.ignored')), false);
    assert.equal(existsSync(join(adjacentCopy, 'only-first.ignored')), false);
    assert.equal(readFileSync(join(fixture.seed, 'tracked.txt'), 'utf8'), 'seeded content\n');
    assert.equal(readFileSync(join(adjacentCopy, 'tracked.txt'), 'utf8'), 'seeded content\n');
  });
});
