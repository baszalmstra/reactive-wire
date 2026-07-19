# Changelog

## 0.4.0 - 2026-07-19

- Add Home Assistant location/timezone-aware Time of day and Twilight range sources.
- Add a generic Between node for numbers, datetimes, and durations with configurable inclusive/exclusive bounds.
- Show authoritative live sink state and bounded value history from the server.
- Improve datetime presentation and add an accessible twilight angle visualization.

## 0.3.1 - 2026-07-18

- Add optional, capability-aware transition durations to light sinks.
- Fix duplicate node selection outlines while preserving keyboard accessibility.

## 0.3.0 - 2026-07-18

- Harden graph deployment, evaluation, and effect delivery with stronger validation, atomic incremental execution, and safer retries.
- Improve Home Assistant resilience with connection readiness, ordered entity updates, and bounded polling.
- Strengthen collaborative multi-flow editing, durable synchronization, and editor performance.
- Improve keyboard accessibility, dialogs, visual contrast, touch targets, motion handling, and release verification.

## 0.2.1 - 2026-07-06

- Improve type-aware value history previews, including richer categorical, datetime, and duration summaries.
- Add active boolean port styling for clearer live graph feedback.
- Fix reconciling sinks so unchanged target states do not spam Home Assistant service calls, and surface failed sink calls as runtime errors.
- Modernize TypeScript coverage for scripts, configs, and e2e helpers.

## 0.2.0 - 2026-07-06

- Tailor light sink inputs and previews to the selected light's capabilities.
- Add duration literals and sink trigger times for time-aware flows.
- Display duration values as compact compound units.
- Make boolean edge states easier to distinguish.

## 0.1.0

- Initial Home Assistant add-on packaging for Reactive Wire.
- Publish the add-on as a Pixi-based prebuilt GHCR image for `amd64` and `aarch64`.
