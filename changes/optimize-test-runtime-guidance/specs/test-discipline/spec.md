## ADDED Requirements

### Requirement: Reusable isolated integration fixture

The test suite SHALL create one Git seed repository per heavy suite, copy it into a fresh temporary directory for each case, and provide reusable helpers for CLI/Git integration tests without sharing mutable case state.

#### Scenario: Run adjacent integration cases

- **WHEN** two integration test cases prepare CLI/Git fixtures in the same suite
- **THEN** each case receives an independent temporary copy with the same seeded two-commit history, worktree, and writable `.git` metadata
- **AND** mutations in one copy cannot affect the other case or the seed

#### Scenario: Detect seed contamination before migration continues

- **WHEN** a copied fixture changes commits, HEAD, untracked or ignored files, Git config, symbolic links, or Git status
- **THEN** the seed and an adjacent copy retain their original HEAD, clean status, files, config, and `.git` metadata
- **AND** the suite keeps its pre-migration setup until the contamination assertion and migrated behavior tests pass

### Requirement: In-process command coverage with CLI smoke preservation

The test suite SHALL exercise repeated command and guard behavior through importable internal boundaries, while retaining focused child-process smoke tests for the public CLI entrypoint and exit behavior.

#### Scenario: Test a repeated execution command behavior

- **WHEN** a suite validates repeated execution or guard cases
- **THEN** it invokes the exported behavior without spawning a new Node process for every assertion
- **AND** focused tests still prove that the public CLI command dispatches and returns the expected exit behavior

#### Scenario: Preserve mapped wrapper coverage

- **WHEN** a command or guard core becomes importable for tests
- **THEN** it remains an internal module boundary that is not exported through `src/index`, package exports, or documented public APIs
- **AND** child-process smoke tests cover one success, one validation failure, stdout/stderr routing, exit code, and cwd-relative path behavior for both migrated wrappers: `scripts/spec-superflow.mjs` and `scripts/guard/guard.mjs`

### Requirement: Measured full-regression runtime target

The default `npm test` command SHALL retain the existing E2E and library test set. After a successful `npm run build`, the project SHALL time only the `npm test` process from start to exit on an unloaded macOS 15.7.7 machine with 12 available CPUs, Node 24.4.1, and Apple Git 2.50.1, and record environment, total/passed/failed/skipped counts, elapsed seconds, and the 180-second reference result in the change verification report.

#### Scenario: Verify optimized regression suite

- **WHEN** the maintainer runs a successful build followed by the full default test command after the optimization
- **THEN** the verification report records the reference environment, all test outcomes, and the test-only elapsed time
- **AND** no existing test file is omitted from the command

#### Scenario: Miss the reference runtime target

- **WHEN** the reference run exceeds 180 seconds while all tests pass
- **THEN** the change records suite-duration evidence and returns from `executing` to `bridging` to rebuild the contract
- **AND** it returns to `specifying` and repeats DP-2 only when the objective or scope changes
- **AND** it does not remove assertions or close conditionally

### Requirement: Measured removal of repeated Node startup

The four measured slow suites—`tests/lib/guard-specs-merged.test.mjs`, `tests/lib/execution-plan.test.mjs`, `tests/lib/cmd-execution.test.mjs`, and `tests/lib/guard.test.mjs`—SHALL remove repeated Node startup through their mapped in-process boundaries while retaining focused public-wrapper smoke coverage.

#### Scenario: Migrate a measured slow suite

- **WHEN** the publication-receipt suite runs
- **THEN** its repeated flow uses `dispatchCli`, `runGuard`, and publication helpers in process while `scripts/spec-superflow.mjs sync`/`execution` and `scripts/guard/guard.mjs` retain wrapper smoke coverage
- **AND** the execution-plan suite uses `execution-plan.mjs` with an isolated seed/copy fixture, the execution suite uses `cmd-execution.run`/`dispatchCli`, and the guard suite uses `runGuard` plus command modules or `dispatchCli`

#### Scenario: Preserve public command wrapper semantics

- **WHEN** a mapped internal boundary replaces repeated Node startup
- **THEN** focused wrapper tests still cover success, validation failure, stdout/stderr routing, exit code, and cwd behavior for `scripts/spec-superflow.mjs sync`/`execution` and `scripts/guard/guard.mjs`
- **AND** the execution-plan data-contract suite does not add synthetic CLI coverage because it verifies an internal module contract

#### Scenario: Verify a suite migration

- **WHEN** a slow suite migration is proposed
- **THEN** its assertion and failure-path coverage is compared with the prior suite
- **AND** its elapsed time is recorded before using it in the full-regression result

### Requirement: One end-to-end owner per independent risk

The test suite SHALL retain every independent behavior and failure risk, but each risk MUST have one named end-to-end test owner. Other tests of the same risk SHALL use an in-process module contract instead of repeating Git, plan, receipt, and CLI setup.

#### Scenario: Record the ownership decision

- **WHEN** a full-chain assertion is removed or converted to a module contract
- **THEN** `changes/<name>/verification-risk-ownership.md` records the independent risk, original full-chain location, unique end-to-end test file and test name, fast-contract location, and removal rationale
- **AND** the record shows no second full-chain owner for that risk

#### Scenario: Consolidate repeated evidence-integrity coverage

- **WHEN** report evidence is deleted, empty, a directory, a symbolic link, or has a control-character path
- **THEN** `execution-plan` retains fast coverage for every type
- **AND** guard integration retains deletion and symbolic-link representatives without repeating the other full chains

#### Scenario: Consolidate repair-threshold coverage

- **WHEN** review repair records are tested
- **THEN** the suite retains end-to-end proof that the first failure is retryable and the fifth unresolved failure opens the circuit breaker
- **AND** intermediate counts use direct control-record coverage instead of repeatedly rebuilding a Git-backed execution plan

#### Scenario: Prevent unsafe assertion deletion

- **WHEN** a full-chain assertion is removed or converted to a module contract
- **THEN** its ownership record identifies an independent risk, end-to-end owner, and replacement contract
- **AND** it does not remove the only wrapper success/failure, state-transition, Git-ancestry, publication-freshness, or repair-threshold evidence

### Requirement: Reuse immutable review-range evidence within one process

The execution-plan verification path SHALL avoid repeating external Git resolution for the same immutable commit SHA pair during one process invocation, while preserving fresh validation for symbolic revisions and every distinct range.

#### Scenario: Re-check an unchanged immutable receipt range

- **WHEN** a plan, guard, or review path validates the same resolved immutable base and head commits more than once in one process
- **THEN** it reuses the already-proven repository identity and ancestry result
- **AND** it preserves the same valid or invalid result without launching redundant Git child processes

#### Scenario: Validate mutable or new range input

- **WHEN** a caller provides a symbolic revision, a different commit pair, or a different repository
- **THEN** the verification path resolves and validates that input again
- **AND** it never treats a cached result as evidence for a changed reference or repository
