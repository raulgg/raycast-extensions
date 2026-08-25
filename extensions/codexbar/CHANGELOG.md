# CodexBar Changelog

## [Initial Version] - {PR_MERGE_DATE}

- Extension icon matches the official CodexBar app icon
- Refresh Usage Cache runs every 10 minutes and requests a live serve copy (`refresh=true`)
- Usage Overview does not start serve or enable the background command. If serve is down it uses a one-shot CLI fetch
- CodexBar serve daemons started by background refresh use a 10-minute response cache TTL
- Usage overview for every provider the CodexBar CLI supports (69 provider ids matching CodexBar v0.53.0, with alias resolution and shared `~/.codexbar/config.json` ordering)
- Grok weekly credits window shows the same pace marker as the CodexBar app
- Cursor, Copilot, Kimi, Zai, Notion, and calendar-month providers (Alibaba, Amp, Command Code, Doubao, MiMo, OpenCode Go, StepFun) show the same plain usage pacer as the CodexBar app
- `npm run upstream:check` diffs each provider's `pace:` capability against `paceCapabilities.ts` so a new upstream pacer fails the check instead of drifting silently
- Background refresh restarts the CodexBar serve daemon when it predates the installed CLI binary, so payload shapes stay consistent across app updates
- Usage payloads that nondeterministically omit supplemental sections (e.g. Claude's scoped extra rate windows) are repaired from a per-provider section memory, keeping meter sets stable across refresh paths
- When the CodexBar CLI is missing but the CodexBar app is installed, the extension offers to set up the app's bundled CLI itself after an explicit confirmation — a faithful mirror of the app's own Install CLI button (never overwrites existing files, never asks for a password)
- Without the app, the install help lays out both routes (CodexBar app + CLI, or CLI only) and adapts the instructions to whether Homebrew is installed
- Detail view with usage meters, pacing, credits, cost, named extra rate windows, recent credit activity, daily credit spend, and a General section (source, version, account, organization, subscription dates)
- Hide Personal Information preference covering account email, label, and organization
- Optional strict, Provider-wide Keychain isolation for every CodexBar process the extension launches, including policy-scoped Provider caches and graceful background daemon reconciliation
