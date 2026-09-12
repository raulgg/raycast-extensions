# Submission notes

## Why this implementation differs

The existing [AirPods Noise Control](https://www.raycast.com/chrahe/airpods-noise-control) extension uses AppleScript to operate Control Center and requires UI configuration. This extension uses a source-built CLI, reads macOS state, and offers individual controls, selected-mode cycling, and background status subtitles. It requires an additional installation and relies on private macOS interfaces. Reviewers should assess whether this difference warrants a separate extension.

## CLI provenance

Verified September 11–12, 2026:

- The [Homebrew formula](https://github.com/raulgg/homebrew-tap/blob/main/Formula/airpods-control.rb) selects [v0.4.0 source](https://github.com/raulgg/airpods-control/tree/v0.4.0), builds with Swift and clang, and installs the native architecture.
- Archive: `https://github.com/raulgg/airpods-control/archive/refs/tags/v0.4.0.tar.gz`.
- Source archive SHA-256: `53c7f9ed1846e2dab806301521bee8c3742149e2b4c45c9abf9b2550edd817ad`. Downloaded the tagged archive and independently recomputed this hash; it matches the formula.
- The local Homebrew installation reports `0.4.0` from `--version`. That verifies the installed version, not device compatibility.
- The [build instructions](https://github.com/raulgg/airpods-control/blob/v0.4.0/README.md#install) and [trust model](https://github.com/raulgg/airpods-control/blob/v0.4.0/SECURITY.md) describe the companion `avbypass.dylib` and private APIs. No executable is bundled with this extension.

The in-extension Homebrew action installs the formula's current version. Review the formula again immediately before submission, since it can change independently of this extension. Hardware write testing and reviewer acceptance of this dependency remain manual checklist items.

## Submission search

A GitHub CLI search of open PRs in `raycast/extensions` for `airpods in:title` returned no matches on September 11, 2026. This does not rule out differently titled or later submissions. The existing Store extension still needs to be addressed in the submission rationale above.
