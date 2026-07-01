# inline-execution Spec

## ADDED Requirements

### Requirement: Inline Execution Mode

build-executor SHALL support an Inline execution mode for small changes (≤ 3 tasks, no cross-module dependencies) where implementation happens in the current session without subagent dispatch.

#### Scenario: Inline mode activation

- **WHEN** execution-contract.md specifies `Execution Mode: Inline`
- **AND** the task count is ≤ 3
- **AND** no task has cross-module dependencies
- **THEN** build-executor SHALL execute tasks sequentially in the current session
- **AND** SHALL NOT dispatch implementer or reviewer subagents

#### Scenario: TDD Iron Law preserved in Inline mode

- **WHEN** executing in Inline mode
- **THEN** every code-producing task SHALL follow the TDD Iron Law (failing test first)
- **AND** the governor SHALL block production code written without a preceding failing test

### Requirement: Inline Mode Checkpoint Review

Inline mode SHALL insert a checkpoint review after each completed task, where the governor verifies spec compliance before proceeding to the next task.

#### Scenario: Checkpoint review after task

- **WHEN** a task completes in Inline mode
- **THEN** build-executor SHALL verify the task output against its spec requirements
- **AND** SHALL verify the task output against its done-when criteria from the execution contract
- **AND** SHALL NOT proceed to the next task until all checks pass

### Requirement: Execution Mode Selection Criteria

build-executor SHALL automatically select the execution mode based on task count, module boundaries, and risk indicators, with user override capability.

#### Scenario: Automatic mode selection

- **WHEN** build-executor receives an approved execution contract
- **THEN** it SHALL count the total tasks and analyze cross-module dependencies and risk indicators
- **AND** if tasks ≤ 3 and no cross-module dependencies → select **Inline mode**
- **AND** if tasks > 3, all tasks are within the same module, no risk indicators are present, and total estimated effort ≤ 15 minutes → select **Batch Inline mode**
- **AND** otherwise → select **SDD mode**
- **AND** SHALL report the selected mode and reasoning to the user before starting

#### Scenario: User mode override

- **WHEN** the user explicitly requests a specific execution mode (`Inline`, `Batch Inline`, or `SDD`)
- **THEN** build-executor SHALL use the requested mode regardless of automatic selection
- **AND** SHALL record the override in the progress ledger
