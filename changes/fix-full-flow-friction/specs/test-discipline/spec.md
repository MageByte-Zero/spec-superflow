## ADDED Requirements

### Requirement: Controlled default test concurrency

The default `npm test` command SHALL run the existing E2E and library test file set with Node file-level concurrency fixed at two, rather than inheriting an unbounded host-dependent default.

#### Scenario: Run the default regression command

- **WHEN** a maintainer or CI runs `npm test`
- **THEN** the command executes `tests/e2e.test.mjs` and `tests/lib/*.test.mjs` with `--test-concurrency=2`
