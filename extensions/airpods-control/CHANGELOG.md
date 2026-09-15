# AirPods Control Changelog

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
- Report the installed helper version and installation method, and offer updates only when a newer version is available.
- Scope Manage Helper actions to the current setup state so Homebrew help, install docs, and source-install copy appear only on the matching recovery.
- Keep Manage Helper actions in untitled next-step, docs, and utility groups instead of Setup, Alternative Methods, Help, and Preferences headings.
- Put Refresh first when the helper is already fine, hide GitHub and command preferences during recovery, and keep one installation-docs action.
- Show Homebrew's installation instructions in the missing-Homebrew setup view.
- Direct the missing developer tools setup to Apple's Command Line Tools installation instructions instead of the downloads catalog.
- Explain how to install the helper when Homebrew and developer tools are already ready.
