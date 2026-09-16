# AirPods Control Changelog

## [Initial Version] - {PR_MERGE_DATE}

- Set Noise Cancellation, Transparency, Adaptive, or Off listening modes via the [airpods-control](https://github.com/raulgg/airpods-control) CLI
- Cycle through a configurable set of supported listening modes
- Toggle Conversation Awareness and show its confirmed state
- Keep listening-mode and Conversation Awareness subtitles synchronized with the state confirmed by macOS readback
- Refresh AirPods status manually or in the background about once a minute
- Keep Raycast open for success toasts, with a HUD confirmation when the window is closed, and show matching listening-mode and Conversation Awareness symbols
- Offer CLI installation through an alert when prerequisites are ready, or open the Manage AirPods Control CLI view for Homebrew, developer tools, and source-install instructions.
- Share installation and recovery across commands, keep progress visible through completion, and require users to run the original command again after setup.
- Verify Homebrew ownership before updating the active CLI, prevent concurrent installations, and preserve complete Homebrew error instructions.
- Report the installed CLI version and installation method, and offer updates only when a newer version is available.
- Scope Manage CLI actions to the current setup state so Homebrew help and install docs appear only on the matching recovery. Offer the source-install copy only for a manual helper that needs an update.
- Keep Manage CLI actions in untitled next-step, docs, and utility groups instead of Setup, Alternative Methods, Help, and Preferences headings.
- Put Refresh first when the CLI is already fine, keep Open AirPods Control on GitHub with installation docs during recovery and after Refresh when the CLI is already fine, hide command preferences during recovery, and keep one installation-docs action.
- Open Homebrew's official site from the missing-Homebrew setup view instead of copying an install command.
- Open Apple's official Command Line Tools page from the missing developer tools setup view instead of copying an install command.
- Keep every Manage CLI Open-in-browser action in the docs group, and open the CLI repository at its heading.
- Explain how to install the CLI when Homebrew and developer tools are already ready.
- Explain how to link an installed Homebrew CLI that Raycast cannot find, and how to set CLI Path if linking is not the issue.
- Confirm the CLI inside the Homebrew keg and read Homebrew's own link status before recommending a fix, so an unlinked formula, an already-linked formula, and an incomplete install each get the command that applies.
