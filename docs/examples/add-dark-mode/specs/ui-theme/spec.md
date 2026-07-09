# Capability Spec

## ADDED Requirements

### Requirement: User can use dark mode

The system SHALL provide a dark theme variant for the primary user interface.

#### Scenario: Initial load follows system preference

- **WHEN** a first-time visitor opens the application and has no saved theme preference
- **THEN** the interface uses the operating system color-scheme preference

#### Scenario: User manually switches theme

- **WHEN** the user activates the theme toggle
- **THEN** the interface switches between light and dark mode immediately

### Requirement: User preference persists

The system SHALL persist an explicit user theme choice across reloads.

#### Scenario: Saved choice overrides system preference

- **WHEN** a returning user has a saved theme choice
- **THEN** the application loads using the saved choice instead of the current system preference

### Requirement: Theme maintains readable contrast

The system SHALL preserve readable text and UI contrast in both light and dark mode.

#### Scenario: Primary content remains readable

- **WHEN** the user views text, surfaces, and interactive controls in dark mode
- **THEN** foreground and background combinations remain readable and distinguishable
