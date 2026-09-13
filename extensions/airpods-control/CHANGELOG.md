# AirPods Control Changelog

## Unreleased

- Validate CLI JSON envelopes and required command state while preserving explicit `null` unsupported results and actionable error readback.
- Report bounded helper stderr with exit status and signal diagnostics, distinguishing timeouts, signals, max-buffer failures, and ordinary process failures.
- Keep Homebrew installation locks through supervised process-tree cleanup, including timeout escalation and abrupt Raycast termination.
- Order subtitle refresh writes by per-channel freshness so stale work cannot overwrite newer state.
- Model helper setup as explicit checking, ready, running, failed, and completed states, including duplicate-action and late-completion protection.
- Exercise transport with real temporary executables and cover malformed/schema, argument forwarding, nonzero/stderr, and signal paths without invoking AirPods hardware.
- Include all runtime TypeScript/TSX in coverage and dispatch coverage for the fixed listening-mode entrypoints.

## [Initial Version] - {PR_MERGE_DATE}

- Set Noise Cancellation, Transparency, Adaptive, or Off listening modes via the [airpods-control](https://github.com/raulgg/airpods-control) CLI
- Cycle through a configurable set of supported listening modes
- Toggle Conversation Awareness and show its confirmed state
- Keep listening-mode and Conversation Awareness subtitles synchronized with the state confirmed by macOS readback
- Refresh AirPods status manually or in the background about once a minute
- Keep Raycast open for success toasts, with a HUD confirmation when the window is closed, and show matching listening-mode and Conversation Awareness symbols
- Offer CLI installation through an alert when prerequisites are ready, or open the Manage AirPods Control Helper view for Homebrew, developer tools, and source-install instructions.
- Share installation and recovery across commands, keep progress visible through completion, and require users to run the original command again after setup.
- Verify Homebrew ownership before updating the active CLI, prevent concurrent installations, and preserve complete Homebrew error instructions.
