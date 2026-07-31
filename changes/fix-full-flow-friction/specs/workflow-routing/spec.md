## ADDED Requirements

### Requirement: Specifying entry and state freshness

The system SHALL allow a confirmed Full change to enter `specifying` before planning artifacts exist, and SHALL persist current artifact and contract hashes after every successful state transition.

#### Scenario: Start specification after intake

- **WHEN** DP-0 is confirmed for a Full change with no planning artifacts
- **THEN** the transition to `specifying` succeeds and a subsequent state check is consistent
