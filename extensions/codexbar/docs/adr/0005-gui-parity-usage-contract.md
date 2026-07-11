# Negotiate the upstream GUI-parity usage contract

The legacy CLI emits provider-owned raw usage shapes and applies CLI-specific `auto` source planning. That can differ from the CodexBar GUI: Claude is one concrete example, but Codex, Grok, MiniMax, Antigravity, and future providers can also vary by host, interaction, enrichment, or presentation logic. Reconstructing those decisions in this extension creates drift and makes optional meters appear inconsistent.

Decision: prefer an upstream capability-negotiated contract. Supporting CLIs accept the `app` fetch profile plus `background` or `user` interaction and emit versioned canonical presentation meters. The extension forwards the Provider's shared config source, consumes canonical meters without provider-specific reconstruction, and uses the old raw normalizer only for older CLIs. Serve requests carry the same profile and interaction; explicit refresh requests use its force-refresh capability.

Successful responses are authoritative, including a smaller meter list. A missing promotional or account-scoped meter must disappear when upstream no longer renders it. Fetch failures are different: they retain the last successful snapshot, suppress the first cached-data failure, and surface repeated failures without clearing the meters.

Consequences:

- The upstream GUI owns source order, fallback, enrichment, meter order, and labels.
- Opening Usage Overview is cache-first and does not force provider work while data is fresh.
- No Raycast source settings are added; `~/.codexbar/config.json` remains the source of truth.
- Older CLIs remain supported through legacy source arguments and raw normalization.
