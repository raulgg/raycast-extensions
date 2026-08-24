# Background refresh owns CodexBar serve startup

The CodexBar CLI has two runtime shapes: one-shot `usage` commands and long-lived `serve` mode. One-shot `usage --source auto` preserves upstream behavior but can feel slow and, for some Providers, can return a poorer payload than the app path. `serve` gives the extension a warm local HTTP path and lets Raycast open the Usage Overview from cached data.

The foreground Usage Overview must not secretly start a long-lived process. Opening a view should feel like a read, not a daemon manager. Raycast lets users enable or disable a background command in command settings, which is the right ownership boundary. A `view` command cannot take `interval`, so Usage Overview and Refresh Usage Cache stay separate.

Decision: only `refresh-usage-cache` may start the CodexBar serve daemon. It runs every 10 minutes and when the user runs it by hand. When it starts serve, it passes a 10-minute response cache TTL. Usage Overview never starts serve and never launches Refresh Usage Cache. If the cache command is off or has never run, serve is usually down and Overview uses a one-shot CLI command. Raycast still turns on the 10-minute schedule when the user runs Refresh Usage Cache or enables it in preferences.

The cache command does not kill serve when scheduling is disabled. Raycast has no reliable disable hook, and a running serve process might belong to the user, the CodexBar app, or another tool. An extension-started serve process can remain until the user stops it or restarts the machine.

How copies bypass serve TTL is in ADR-0005.

Consequences:

- Daemon startup is tied to Refresh Usage Cache, not to opening the list.
- Leaving the cache command off is an opt-out of serve. Overview still works via one-shot fetches.
- The visible command can use warm data, but it does not create background work.
- Existing serve processes keep the interval they were started with. Restart Raycast, stop the process, or reboot to apply a new serve interval after an extension update.
- Serve shutdown is out of scope until Raycast exposes a lifecycle hook or the extension adds an explicit stop command.
