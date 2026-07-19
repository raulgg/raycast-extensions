# CodexBar Changelog

## [Initial Version] - {PR_MERGE_DATE}

- Usage overview for every provider the CodexBar CLI supports (47 provider ids, with alias resolution and shared `~/.codexbar/config.json` ordering)
- Background refresh restarts the CodexBar serve daemon when it predates the installed CLI binary, so payload shapes stay consistent across app updates
- Usage payloads that nondeterministically omit supplemental sections (e.g. Claude's scoped extra rate windows) are repaired from a per-provider section memory, keeping meter sets stable across refresh paths
- When the CodexBar CLI is missing but the CodexBar app is installed, the extension offers to set up the app's bundled CLI itself after an explicit confirmation — a faithful mirror of the app's own Install CLI button (never overwrites existing files, never asks for a password)
- Without the app, the install help lays out both routes (CodexBar app + CLI, or CLI only) and adapts the instructions to whether Homebrew is installed
- Detail view with usage meters, pacing, credits, cost, named extra rate windows, recent credit activity, daily credit spend, and a General section (source, version, account, organization, subscription dates)
- Hide Personal Information preference covering account email, label, and organization
