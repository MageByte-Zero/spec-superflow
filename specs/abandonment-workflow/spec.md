# abandonment-workflow Spec

## ADDED Requirements

### Requirement: Abandoned Terminal State

The workflow state machine SHALL include `abandoned` as a terminal state parallel to `closing`, reachable from any other state.

#### Scenario: Transition to abandoned

- **WHEN** the user explicitly requests to abandon a change
- **OR** bug-investigator escalates after 3+ failed fix attempts
- **OR** scope change during specifying makes the change no longer worthwhile
- **THEN** workflow-start SHALL transition the state to `abandoned`
- **AND** SHALL NOT allow any further state transitions from `abandoned`

#### Scenario: Abandoned blocks further execution

- **WHEN** the current state is `abandoned`
- **THEN** workflow-start SHALL block all skill invocations except reading the abandonment summary
- **AND** SHALL inform the user that the change is abandoned and suggest starting a new change

### Requirement: Abandonment Summary Generation

Entering the abandoned state SHALL trigger generation of an `abandonment-summary.md` file documenting the reason, lessons learned, and recommendations.

#### Scenario: Summary structure

- **WHEN** the state transitions to `abandoned`
- **THEN** the system SHALL generate `abandonment-summary.md` containing:
  - `## Change`: the change name and original goal
  - `## Reason`: why the change was abandoned
  - `## What Was Tried`: actions taken before abandonment
  - `## Lessons Learned`: insights gained that may help future attempts
  - `## Recommendations`: suggested next steps or alternative approaches

#### Scenario: Summary completeness

- **WHEN** abandonment-summary.md is generated
- **THEN** the Reason section SHALL contain at least 50 characters of explanation
- **AND** the Lessons Learned section SHALL contain at least one concrete insight

### Requirement: Partial Code Preservation

The abandonment workflow SHALL allow the user to optionally preserve useful code changes made before abandonment.

#### Scenario: Preserve partial work

- **WHEN** the user chooses to preserve partial work during abandonment
- **THEN** the system SHALL list all uncommitted changes in the working tree
- **AND** SHALL allow the user to select which changes to commit with an `[abandoned]` prefix in the commit message
- **AND** SHALL record preserved commits in the abandonment summary

#### Scenario: No preservation

- **WHEN** the user chooses not to preserve partial work
- **THEN** the system SHALL advise the user to use `git stash` or `git checkout` to discard changes
- **AND** SHALL NOT automatically discard any work

### Requirement: No Delta Spec Merge on Abandonment

An abandoned change SHALL NOT merge its delta specs into the main spec base.

#### Scenario: Spec sync blocked

- **WHEN** a change is in the `abandoned` state
- **THEN** spec-merger SHALL refuse to process any delta specs from this change
- **AND** SHALL report that abandoned changes cannot be synced
