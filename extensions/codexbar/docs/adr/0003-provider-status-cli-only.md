# Provider status comes only from the CodexBar CLI

Provider incident status (operational / partial / major / critical / maintenance) is sourced exclusively from the CodexBar CLI's `usage --status` flag, carried into a dedicated status cache by the Raycast background refresh. The extension never fetches provider statuspages itself.

The CLI already owns statuspage fetching: `usage --status` reads each provider's `api/v2/status.json` and attaches a `status` object to the usage payload. Re-implementing that in the extension would duplicate upstream's `StatusFetcher` — the per-provider statuspage URL table, the JSON shape, and its quirks — and the two copies would inevitably drift. Keeping the CLI as the single source preserves the parity contract described in `docs/upstream-parity.md`.

Status cannot ride the fast foreground path. The CodexBar serve daemon does not support status (`CLIServeCommand` never calls `fetchStatus`), and adding `--status` to a foreground one-shot would add multi-second statuspage latency to a cold open. So status is fetched only by the `refresh-usage-cache` background command.

Decision: the background refresh writes each provider's parsed status to a dedicated cache namespace (`provider-status:<id>`) with its own `fetchedAt`, separate from the provider-detail (usage) cache. Detail keeps its serve-preferred path. When serve supplies the detail, status is refreshed only if that provider has no fresh cached status (missing or past the 30-minute TTL) — a bounded infrequent one-shot `usage --status`, not a status hit on every 10-minute refresh. When the status cache is still fresh, the serve path returns detail only and does not re-hit the CLI for status. When serve is unavailable, a single `usage --status` returns both detail and status so the fallback issues no duplicate CLI call. Serve-sourced detail remains the primary detail write even when a status one-shot also runs; a failed status call must not drop serve detail. The two caches are never merged: serve-sourced usage writes carry no status and must not clobber a cached status (nor the reverse). The foreground reads the status cache alongside usage and shows a badge only while the cached status is within a 30-minute TTL. `none`/`unknown` render nothing anywhere.

Consequences:

- Badges require the background refresh to be enabled. When it is disabled the status cache stays empty and no badges appear — graceful absence, no error, and no lazy foreground statuspage fetch.
- Status freshness is bounded by the 30-minute TTL (and the background refresh interval that can rewarm it); a stopped refresh lets badges expire rather than showing stale incidents.
- When serve supplies the detail, a status one-shot runs only on status-cache miss/TTL expiry, so badges stay warm without paying Claude-style usage-endpoint cost on every refresh cycle.
- A failed status one-shot after a successful serve detail fetch leaves prior status (if any) untouched and still writes the serve detail.
- If upstream adds status to serve mode, serve-sourced background refreshes can warm the status cache without a separate usage call.
