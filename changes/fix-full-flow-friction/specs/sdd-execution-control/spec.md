## ADDED Requirements

### Requirement: First review evidence initialization

The system SHALL create the physical review evidence overlay before validating or recording a first wave review report.

#### Scenario: First review receipt

- **WHEN** a planned wave records its first review
- **THEN** a report stored in the review overlay can be recorded without a manual directory creation step
