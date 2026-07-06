# Provider status comes only from the CodexBar CLI

Provider incident status (operational / partial / major / critical / maintenance) is sourced exclusively from the CodexBar CLI's `usage --status` flag, carried into a dedicated status cache by the Raycast background refresh. The extension never fetches provider statuspages itself.

The CLI already owns statuspage fetching: `usage --status` reads each provider's `api/v2/status.json` and attaches a `status` object to the usage payload. Re-implementing that in the extension would duplicate upstream's `StatusFetcher` — the per-provider statuspage URL table, the JSON shape, and its quirks — and the two copies would inevitably drift. Keeping the CLI as the single source preserves the parity contract described in `docs/upstream-parity.md`.

Status cannot ride the fast foreground path. The CodexBar serve daemon does not support status (`CLIServeCommand` never calls `fetchStatus`), and adding `--status` to a foreground one-shot would add multi-second statuspage latency to a cold open. So status is fetched only by the `refresh-usage-cache` background command, which is already latency-tolerant and already owns serve startup (ADR-0002).

Decision: the background refresh fetches status with a one-shot `usage --status` and writes each provider's parsed status to a dedicated cache namespace (`provider-status:<id>`) with its own `fetchedAt`, separate from the provider-detail (usage) cache. Detail keeps its serve-preferred path; when serve supplies the detail, status comes from an extra best-effort `usage --status` one-shot, and when serve is unavailable a single `usage --status` returns both so the fallback issues no duplicate CLI call. The two caches are never merged: serve-sourced usage writes carry no status, and must not clobber a cached status (nor the reverse). The foreground reads the status cache alongside usage and shows a badge only while the cached status is within a 30-minute TTL. `none`/`unknown` render nothing anywhere.

Consequences:

- Badges require the background refresh to be enabled. When it is disabled the status cache stays empty and no badges appear — graceful absence, no error, and no lazy foreground statuspage fetch.
- Status freshness is bounded by the background refresh interval and the 30-minute TTL; a stopped refresh lets badges expire rather than showing stale incidents.
- When serve supplies the detail, status still costs one extra `usage --status` process per provider, because serve mode cannot produce status. This is the accepted price of not fetching statuspages directly.
- If upstream adds status to serve mode, the extra one-shot collapses into the single serve path and this split can be removed (follow-up: upstream PR to add optional status support to `CLIServeCommand`).
