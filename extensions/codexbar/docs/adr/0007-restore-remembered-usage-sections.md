# Restore remembered usage sections when payloads omit them

Restarting a stale serve daemon (ADR-0006) removed version skew as a source of payload divergence, but the meter set still flickered: the "Fable only" scoped weekly window appeared on some refreshes and vanished on others. Live probing on CLI 0.43.0 showed the gap is not transport-bound — five consecutive one-shot fetches of the same Claude account returned the window twice and omitted it three times, and serve was just as inconsistent. The upstream usage API is nondeterministic about supplemental windows; every transport just relays its last fetch. The extension cannot fix that at the source.

Decision: repair incomplete payloads instead of rejecting them. Per-provider shape memory (`src/lib/providerShapeMemory.ts`) stores full section data (title, meters, position) for every supplemental-usage section it sees, stamped with the genuine sighting time. Every normalized detail — serve or one-shot, foreground or background — goes through `applyProviderUsageSectionMemory`, which records present sections and restores any remembered section the payload dropped, at its remembered position. Restores do not refresh a section's timestamp; only genuinely present sections do. Remembered sections expire 24 hours after their last genuine sighting (`SECTION_MEMORY_TTL_MS`), so a window that truly disappears upstream ages out within a day instead of staying pinned forever.

Two deliberate limits keep the memory from lying. Only supplemental-usage meters are remembered: info sections carry mutable inventory (Codex reset credits, OpenRouter balances) whose disappearance is a real state change that must not be resurrected. And the memory is scoped to the detail's account email and resolved source: after switching accounts or auth sources, remembered sections from the previous identity are discarded rather than rendered under the new one.

Rejected alternative: treat an incomplete payload as an error and refetch through another transport. Since transport does not predict payload quality, the refetch is a coin flip that adds latency, and a weak fetch overwriting the remembered shape lets incomplete payloads back in.

Consequences:

- The rendered meter set stays stable across refresh paths; a flaky upstream response can no longer drop a section that was present moments earlier.
- A restored section shows data from its last genuine sighting, so numbers can lag a few refresh cycles. With background refreshes every few minutes and the window appearing in a large fraction of fetches, staleness stays small in practice.
- The serve fast path (ADR-0002) applies uniformly; no payload-shape check ever forces a provider onto one-shot.
