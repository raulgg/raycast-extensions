# Background refresh owns CodexBar serve startup

The CodexBar CLI has two runtime shapes: one-shot `usage` commands and long-lived `serve` mode. One-shot `usage --source auto` preserves upstream behavior but can feel slow and, for some Providers, can return a poorer payload than the app path. `serve` gives the extension a warm local HTTP path and lets Raycast open the Usage Overview from cached data.

The foreground Usage Overview must not secretly start a long-lived process. Opening a view command should feel like a read and refresh operation, not a daemon manager. Raycast background commands are a better ownership boundary because users can enable or disable them through Raycast's native command settings.

Decision: the `refresh-usage-cache` `no-view` command runs on Raycast's scheduled interval. It checks whether the CodexBar serve daemon is healthy on the extension's localhost port; if not, it starts `codexbar serve` with a conservative 10-minute response cache TTL, then refreshes configured Provider details into the shared provider-detail cache. Usage Overview renders that cache immediately, then force-revalidates every configured Provider with bounded concurrency whenever the command opens. A user-triggered Refresh uses the same negotiated serve `refresh=true` capability so it bypasses response TTL while retaining warm helper processes; older daemons fall back to a fresh one-shot CLI command. The foreground never starts serve.

The background command does not try to kill serve when scheduling is disabled. Raycast does not expose a reliable disable hook, and a running serve process might have been started by the user, the CodexBar app, or another tool. We accept that an extension-started serve process can remain alive until the user stops it or restarts the machine.

Consequences:

- Daemon startup is provider-agnostic and tied to Raycast's background refresh, not to Codex-specific data quirks.
- The visible command stays predictable: it can use warm data, but it does not create background work.
- Every successful GUI-profile response is authoritative and replaces the prior meter set; failures retain last-good data.
- Existing serve processes keep the interval they were started with. Restart Raycast, stop the process, or reboot to apply a new serve interval after an extension update.
- Serve shutdown is intentionally out of scope until Raycast exposes a reliable lifecycle hook or the extension adds an explicit user-facing stop command.
