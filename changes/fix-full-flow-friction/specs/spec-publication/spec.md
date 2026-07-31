## ADDED Requirements

### Requirement: Delta baseline preflight

The system SHALL report an invalid MODIFIED, REMOVED, or RENAMED delta during standard change validation when its canonical baseline cannot accept that operation.

#### Scenario: Missing modified requirement

- **WHEN** a change modifies a requirement absent from its canonical baseline
- **THEN** `ssf validate` fails before implementation or release synchronization
