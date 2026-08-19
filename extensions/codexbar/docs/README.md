# CodexBar docs

Maintainer and contributor documentation for the CodexBar Raycast extension.

- **[maintaining.md](maintaining.md)** — start here. Repo layout, dev/test/lint commands, runtime
  quirks, and the recurring upstream-sync chore.
- **[upstream-parity.md](upstream-parity.md)** — the parity reference. Every surface where the
  extension tracks the CodexBar macOS app, the two drift-guard scripts, and the quirks. Read before
  touching provider metadata, pacing, or icons.
- **[../CONTEXT.md](../CONTEXT.md)** — domain glossary. The vocabulary the code and docs use.
- **[adr/](adr/)** — architecture decision records, one per accepted trade-off:
  - [0001](adr/0001-shared-codexbar-config.md) — reorder the app's own `~/.codexbar/config.json`.
  - [0002](adr/0002-background-refresh-owns-serve-startup.md) — only the background refresh starts serve.
  - [0003](adr/0003-provider-status-cli-only.md) — incident status comes only from the CLI.
  - [0004](adr/0004-mixed-config-write-ownership.md) — config is written two ways (CLI + direct file).
  - [0005](adr/0005-gui-parity-usage-contract.md) — Provider usage follows the CodexBar app's fetch contract.
  - [0006](adr/0006-background-refresh-restarts-stale-serve.md) — background refresh replaces stale CodexBar serve daemons.
  - [0007](adr/0007-restore-remembered-usage-sections.md) — temporarily restore supplemental meters omitted by flaky payloads.
  - [0008](adr/0008-extension-installs-codexbar-cli.md) — CLI setup is an explicit, verified extension workflow.
  - [0009](adr/0009-disable-keychain-access-strictly.md) — disabling Keychain access is a strict, Provider-wide runtime policy.
</content>
