// tests/lib/config-loader.test.mjs
// Tests for scripts/lib/config-loader.mjs
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

// We need to import from the scripts directory. Since config-loader uses
// relative imports only (no path manipulation), we can test its pure logic
// by importing and controlling cwd.

// Store original cwd
const originalCwd = process.cwd;
let tempDir;

describe('config-loader: getDefaults()', () => {
  let configLoader;

  before(async () => {
    // Dynamic import to get fresh module
    const modulePath = join(process.cwd(), 'scripts/lib/config-loader.mjs');
    configLoader = await import(pathToFileURL(modulePath).href);
  });

  it('returns DEFAULTS object with expected shape', () => {
    const defaults = configLoader.getDefaults();
    assert.ok(defaults.artifacts);
    assert.deepStrictEqual(defaults.artifacts.order, ['proposal', 'specs', 'design', 'tasks']);
    assert.deepStrictEqual(defaults.artifacts.skip, []);
    assert.ok(defaults.execution);
    assert.equal(defaults.execution.inlineThreshold, 3);
    assert.equal(defaults.execution.abandonmentReasonMinLength, 50);
    assert.equal(defaults.execution.defaultLanguage, 'auto');
    assert.ok(defaults.verification);
    assert.equal(defaults.verification.language, 'auto');
  });

  it('returns a deep copy, not a reference', () => {
    const d1 = configLoader.getDefaults();
    const d2 = configLoader.getDefaults();
    d1.artifacts.order.push('execution-contract');
    assert.notDeepStrictEqual(d1.artifacts.order, d2.artifacts.order);
  });
});

describe('config-loader: resolveModelProfile()', () => {
  let configLoader;

  before(async () => {
    const modulePath = join(process.cwd(), 'scripts/lib/config-loader.mjs');
    configLoader = await import(pathToFileURL(modulePath).href);
  });

  it('exposes the supported model profiles in order', () => {
    assert.deepStrictEqual(configLoader.MODEL_PROFILES, [
      'mechanical', 'standard', 'strong', 'review',
    ]);
  });

  it('resolves all four configured profiles without changing their model identifiers', () => {
    const config = {
      models: {
        mechanical: 'vendor-small', standard: 'vendor-standard',
        strong: 'vendor-strong', review: 'vendor-review',
      },
    };
    assert.deepStrictEqual(configLoader.resolveModelProfile(config, 'mechanical'), {
      profile: 'mechanical', model: 'vendor-small', configured: true,
    });
    assert.deepStrictEqual(configLoader.resolveModelProfile(config, 'standard'), {
      profile: 'standard', model: 'vendor-standard', configured: true,
    });
    assert.deepStrictEqual(configLoader.resolveModelProfile(config, 'strong'), {
      profile: 'strong', model: 'vendor-strong', configured: true,
    });
    assert.deepStrictEqual(configLoader.resolveModelProfile(config, 'review'), {
      profile: 'review', model: 'vendor-review', configured: true,
    });
  });

  it('returns an explicit unmapped result for a known profile', () => {
    assert.deepStrictEqual(configLoader.resolveModelProfile({}, 'strong'), {
      profile: 'strong', model: null, configured: false,
    });
  });

  it('does not let partial model mappings affect missing known profiles', () => {
    assert.deepStrictEqual(
      configLoader.resolveModelProfile({ models: { review: 'vendor-review' } }, 'standard'),
      { profile: 'standard', model: null, configured: false },
    );
  });

  it('rejects unknown and malformed mappings deterministically', () => {
    assert.throws(() => configLoader.resolveModelProfile({}, 'fast'),
      /Unknown model profile 'fast'.*mechanical.*standard.*strong.*review/);
    assert.throws(() => configLoader.resolveModelProfile({ models: { review: '   ' } }, 'review'),
      /models\.review must be a non-empty string/);
    assert.throws(() => configLoader.resolveModelProfile({ models: { review: 42 } }, 'review'),
      /models\.review must be a non-empty string/);
  });
});

describe('config-loader: loadConfig()', () => {
  let configLoader;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-config-test-'));
    const modulePath = join(process.cwd(), 'scripts/lib/config-loader.mjs');
    configLoader = await import(pathToFileURL(modulePath).href);
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns defaults when no config file exists', () => {
    const config = configLoader.loadConfig(tempDir);
    assert.deepStrictEqual(config.artifacts.order, ['proposal', 'specs', 'design', 'tasks']);
    assert.equal(config.execution.inlineThreshold, 3);
  });

  it('merges user config with defaults', () => {
    const userConfig = {
      artifacts: {
        order: ['proposal', 'design', 'tasks'],
        skip: ['specs'],
      },
      execution: {
        inlineThreshold: 5,
      },
    };
    writeFileSync(join(tempDir, 'spec-superflow.config.json'), JSON.stringify(userConfig));

    const config = configLoader.loadConfig(tempDir);

    // User values override
    assert.deepStrictEqual(config.artifacts.order, ['proposal', 'design', 'tasks']);
    assert.deepStrictEqual(config.artifacts.skip, ['specs']);
    assert.equal(config.execution.inlineThreshold, 5);

    // Unspecified defaults preserved
    assert.equal(config.execution.abandonmentReasonMinLength, 50);
    assert.equal(config.verification.language, 'auto');
  });

  it('handles partial user config without crashing', () => {
    // Clean up previous config
    rmSync(join(tempDir, 'spec-superflow.config.json'), { force: true });

    const userConfig = {
      execution: {
        inlineThreshold: 10,
      },
    };
    writeFileSync(join(tempDir, 'spec-superflow.config.json'), JSON.stringify(userConfig));

    const config = configLoader.loadConfig(tempDir);

    assert.equal(config.execution.inlineThreshold, 10);
    // artifacts should still have defaults
    assert.deepStrictEqual(config.artifacts.order, ['proposal', 'specs', 'design', 'tasks']);
  });

  it('handles invalid JSON gracefully, returning defaults', () => {
    writeFileSync(join(tempDir, 'spec-superflow.config.json'), 'not valid json {{{');

    const config = configLoader.loadConfig(tempDir);

    // Should fall back to defaults on parse error
    assert.deepStrictEqual(config.artifacts.order, ['proposal', 'specs', 'design', 'tasks']);
    assert.equal(config.execution.inlineThreshold, 3);
  });
});
