import fs from 'node:fs';
import path from 'node:path';

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function specsDir(changeDir) {
  return path.join(changeDir, 'specs');
}

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, results);
    } else if (entry.isFile()) {
      results.push(full);
    }
  }

  return results;
}

export function findCanonicalSpecFiles(changeDir) {
  const root = specsDir(changeDir);
  if (!fs.existsSync(root)) return [];

  return walk(root)
    .filter(file => {
      if (path.basename(file) !== 'spec.md') return false;
      const rel = path.relative(root, file).split(path.sep);
      return rel.length === 2;
    })
    .sort();
}

export function findInvalidSpecFiles(changeDir) {
  const root = specsDir(changeDir);
  if (!fs.existsSync(root)) return [];

  const invalid = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const rel = `specs/${entry.name}`;
    if (entry.name === 'README.md') continue;
    if (entry.name === 'spec.md') {
      invalid.push({ path: rel, expected: 'specs/<capability>/spec.md' });
      continue;
    }

    const capability = entry.name.replace(/\.md$/, '');
    invalid.push({ path: rel, expected: `specs/${capability}/spec.md` });
  }

  return invalid.sort((a, b) => a.path.localeCompare(b.path));
}

export function findNestedSpecDiagnostics(changeDir) {
  const root = specsDir(changeDir);
  if (!fs.existsSync(root)) return [];

  return walk(root)
    .filter(file => {
      if (path.basename(file) !== 'spec.md') return false;
      const rel = path.relative(root, file).split(path.sep);
      return rel.length > 2;
    })
    .map(file => ({
      code: 'unsupported-nested-spec-path',
      path: toPosix(path.join('specs', path.relative(root, file))),
      expected: 'specs/<capability>/spec.md',
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function formatSpecPathFailure(item) {
  return `Invalid spec path: ${item.path}. Expected: ${item.expected}`;
}

export function formatNestedSpecDiagnostic(diagnostic) {
  return `Unsupported nested spec path: ${diagnostic.path}. Expected: ${diagnostic.expected}`;
}

export function validateSpecPathLayout(changeDir, options = {}) {
  const requireSpecs = options.requireSpecs === true;
  const specFiles = findCanonicalSpecFiles(changeDir);
  const diagnostics = findNestedSpecDiagnostics(changeDir);
  const failures = [
    ...findInvalidSpecFiles(changeDir).map(formatSpecPathFailure),
    ...diagnostics.map(formatNestedSpecDiagnostic),
  ];

  if (requireSpecs && specFiles.length === 0) {
    failures.push('No canonical spec files found. Expected at least one specs/<capability>/spec.md');
  }

  return {
    pass: failures.length === 0,
    specFiles,
    failures,
    diagnostics,
  };
}

export function relativeSpecPath(changeDir, file) {
  return toPosix(path.relative(changeDir, file));
}
