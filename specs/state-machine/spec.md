# state-machine Spec

## MODIFIED Requirements

### Requirement: Eight-State Workflow

The workflow state machine SHALL consist of 8 states: `exploring`, `specifying`, `bridging`, `approved-for-build`, `executing`, `debugging`, `closing`, and `abandoned`.

#### Scenario: State enumeration

- **WHEN** workflow-start inspects the current change context
- **THEN** it SHALL classify the change into exactly one of the 8 defined states
- **AND** SHALL NOT classify into any state not in the enumeration

#### Scenario: Terminal states

- **WHEN** the state is `closing` or `abandoned`
- **THEN** the state machine SHALL NOT allow transitions to any other state
- **AND** SHALL inform the user that the change has reached its terminal state

### Requirement: Abandoned State Routing

workflow-start SHALL allow transitions to `abandoned` from any non-terminal state.

#### Scenario: Universal abandoned transition

- **WHEN** the user requests abandonment
- **AND** the current state is NOT `closing` or `abandoned`
- **THEN** workflow-start SHALL transition to `abandoned`
- **AND** SHALL trigger abandonment summary generation

#### Scenario: Debugging escalation to abandoned

- **WHEN** bug-investigator reports 3+ consecutive fix failures
- **AND** the debugger recommends questioning the architecture
- **THEN** workflow-start SHALL present the user with two options: (1) escalate to architectural review, (2) transition to `abandoned`
- **AND** SHALL NOT automatically abandon without user confirmation
