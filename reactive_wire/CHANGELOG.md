# Changelog

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
