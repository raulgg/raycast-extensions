# Extension reorders the CodexBar app's own config file

The set of enabled Providers and their order are owned by the CodexBar app in `~/.codexbar/config.json`. Rather than maintain separate extension state, the Usage Overview reads that file directly and writes reordering back to it, so the extension and the app always agree on which Providers are enabled and in what order.

The cost is shared write-ownership of a file another app controls: an upstream schema change could break reading or reordering, and concurrent writes by both apps are unguarded. We accept this to avoid a second source of truth that would inevitably drift from the app.
