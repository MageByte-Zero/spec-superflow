#!/usr/bin/env node
// scripts/install-codebuddy.mjs — standalone entry for `ssf install-codebuddy`.
//
// Deploys spec-superflow to ~/.codebuddy/ for
// CodeBuddy Code CLI. Run with no args to install the latest GitHub release,
// or --local <path> to deploy from a local clone.
//
// Usage:
//   node scripts/install-codebuddy.mjs                  # latest GitHub release
//   node scripts/install-codebuddy.mjs --local /path    # local clone
//   node scripts/install-codebuddy.mjs --tag v0.12.1    # specific tag
//   node scripts/install-codebuddy.mjs --dry-run        # preview only
//   node scripts/install-codebuddy.mjs --config-dir D:/.codebuddy
import { run } from './lib/cmd-install-codebuddy.mjs';

run(process.argv.slice(2)).catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
