# task-planning Spec

## MODIFIED Requirements

### Requirement: Enhanced Task Granularity

spec-writer SHALL generate tasks.md where each task step is a 2-5 minute atomic operation with explicit TDD phases (write failing test → confirm fail → implement → confirm green → commit).

#### Scenario: Task step granularity enforcement

- **WHEN** spec-writer generates a tasks.md artifact
- **THEN** every task step SHALL be completable in 2-5 minutes of focused work
- **AND** no task step SHALL contain vague instructions like "implement the module" or "add appropriate tests"

#### Scenario: TDD phase expansion

- **WHEN** a task involves code implementation
- **THEN** the task SHALL expand into explicit TDD phases: (1) write the failing test with exact test code, (2) run the test and confirm it fails for the expected reason, (3) implement the minimal code, (4) run the test and confirm it passes, (5) commit

### Requirement: Precise File Path Declaration

Each task SHALL declare exact file paths for every file it creates or modifies, using the format `Create: path/to/file.ts` or `Modify: path/to/file.ts:line-range`.

#### Scenario: File path presence check

- **WHEN** a task creates or modifies source code
- **THEN** the task MUST list each affected file with its absolute or project-relative path
- **AND** modifications MUST include the line range or section being changed

### Requirement: Interface Contract Declaration

Each task SHALL declare an Interfaces block specifying what it consumes from earlier tasks and what later tasks rely on, including exact function names, parameter types, and return types.

#### Scenario: Interfaces block presence

- **WHEN** a task produces output consumed by later tasks
- **THEN** the task MUST include an `Interfaces` section with `Consumes` (inputs from earlier tasks) and `Produces` (outputs for later tasks)
- **AND** each interface entry MUST specify the function name, parameter types, and return type

### Requirement: Zero Placeholder Enforcement

tasks.md SHALL NOT contain any placeholder language including "TBD", "TODO", "implement later", "figure out", "add appropriate", or similar vague markers.

#### Scenario: Placeholder scan

- **WHEN** spec-writer completes tasks.md generation
- **THEN** the artifact SHALL be scanned for placeholder patterns
- **AND** any detected placeholder SHALL be resolved before handoff to contract-builder

### Requirement: File Structure Section

tasks.md SHALL include a File Structure section listing all files to be created or modified, with each file's responsibility stated in one sentence.

#### Scenario: File structure presence

- **WHEN** spec-writer generates tasks.md
- **THEN** the artifact MUST begin with a `## File Structure` section
- **AND** every file referenced in any task MUST appear in the File Structure section with its responsibility
