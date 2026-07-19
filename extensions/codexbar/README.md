# CodexBar

Check your coding-agent usage quotas — Codex, Claude, Gemini, Cursor, and 40+ other providers —
directly from Raycast. CodexBar wraps the external `codexbar` CLI and renders a usage overview with
remaining-usage meters, pacing, and provider status for every provider you have configured.

## Requirements

The extension needs the [CodexBar CLI](https://github.com/steipete/CodexBar) (`codexbar`) from
steipete's CodexBar project. Two routes:

- **CodexBar app + CLI** (recommended): install the CodexBar app with
  `brew install --cask steipete/tap/codexbar`, or download it from
  [codexbar.app](https://codexbar.app/). If the app is installed but its CLI isn't set up yet, the
  extension offers to finish the setup for you: after an explicit confirmation, it symlinks the
  app's bundled CLI into `/usr/local/bin` and `/opt/homebrew/bin` — the same thing the app's own
  **Install CLI** button does. It never overwrites existing files, never creates directories, and
  never asks for a password.
- **CodexBar CLI only**: `brew install --formula steipete/tap/codexbar` (the formula ships macOS
  builds — no app needed), or download a CodexBarCLI archive from
  [GitHub Releases](https://github.com/steipete/CodexBar/releases) and put `codexbar` on your
  `PATH`.

The extension looks for `codexbar` on your `PATH`, falling back to `/opt/homebrew/bin/codexbar` and
`/usr/local/bin/codexbar`. If the CLI is missing, the extension shows install help matched to your
setup (CodexBar app present or not, Homebrew present or not).

Providers are read from your CodexBar config (`~/.codexbar/config.json`) — the extension shows
exactly the providers you enabled there, in your configured order. You can enable and reorder them
with the extension's Manage Providers action, too.

## Commands

- **Usage Overview** — one row per configured provider with usage meters; open a provider for reset
  windows, pacing, run-out projections, and supplemental meters.
- **Refresh Usage Cache** — optional background refresh (every 5 minutes) that keeps usage data warm
  so the overview opens instantly. When enabled, it may start the CodexBar CLI's serve daemon
  (`codexbar serve`, bound to `127.0.0.1:17653` only), which keeps refreshing usage in the
  background and can keep running after Raycast closes. Disable the command to stop starting it, or
  quit the daemon with `pkill -f "codexbar serve"`.

## Privacy

All usage data comes from the local `codexbar` CLI. The extension makes no network requests of its
own — the only HTTP traffic is to the CLI's localhost serve daemon.

## Preferences

- **Hide Personal Information** — hides account emails, labels, and organizations in the detail
  view.

## Contributing

Contributor and maintainer docs live in [`docs/`](docs/) — start with
[`docs/maintaining.md`](docs/maintaining.md). Contributing with an AI agent? It should read
[`AGENTS.md`](AGENTS.md) first.
