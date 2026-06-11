# Keeping parity with upstream

This extension mirrors behaviour from the **CodexBar macOS app** (`steipete/CodexBar`). The app
is upstream; this extension re-implements a subset of its usage rendering on top of the same
`codexbar` CLI payloads. When a feature "should match the app", upstream Swift is the source of
truth — not memory, not what the app looked like last month.

This guide covers what upstream owns versus what this extension owns, then walks through one worked
example — the session-pacing provider whitelist — that shows the pattern end to end.

## The three layers, and which one owns what

| Layer | Repo / location | Owns |
| --- | --- | --- |
| **CodexBar CLI** | external `codexbar` binary | The raw `usage --provider <id>` JSON payload. Field names, window shapes, `windowMinutes`. |
| **CodexBar app** | `steipete/CodexBar` (Swift) | How payloads are *interpreted and rendered* — pacing formulas, which providers get which treatment, labels, colours. |
| **This extension** | here (TypeScript) | A re-implementation of the app's rendering for Raycast. Should follow the app's interpretation decisions. |

Parity work almost always means: a payload field already exists, and we need to copy the **app's
decision** about how to treat it.

## Upstream is the source of truth

Upstream is the public repo `steipete/CodexBar`. When a feature "should match the app", read the
upstream Swift directly and treat it as authoritative — not memory, and not how the app behaved
previously. Upstream changes over time, so cite the upstream file (and, where you can, the commit)
you verified against, so a parity finding stays traceable to a point in the app's history.

## Where the rendering decisions live upstream

Useful entry points in `Sources/`:

- `CodexBarCore/UsagePace.swift` — the pace **formula** (`expected = elapsed/duration * 100`,
  stage thresholds, run-out projection). Shared by every window type; the *only* thing that varies
  per window is the default window duration.
- `CodexBar/UsagePaceText.swift` — pace **gating and labels**. This is where the
  per-provider whitelists live (e.g. `sessionPace(provider:...)`).
- `CodexBar/MenuCardView.swift` — where `primaryMetric` / `secondaryMetric` / `codexRateMetrics`
  decide whether each bar gets a pace marker.
- `CodexBar/MenuCardView+ModelHelpers.swift` — `sessionPaceDetail` / `weeklyPaceDetail`, including
  the "hide the marker when on track" rule (`pacePercent = nil` when stage is on-track).
- `CodexBar/UsageProgressBar.swift` — the marker (`paceTip`) rendering itself.
- `CodexBar/UsageStore+HistoricalPace.swift` — `supportsWeeklyPace(for:)` provider gate.

Grep terms that find most of it: `pace`, `Pace`, `marker`, `tip`, `expected`, `windowMinutes`,
`supports…Pace`, `sessionPace`, `weeklyPace`.

## Mapping a decision into this extension

The render pipeline here is window-agnostic: any usage section that carries a `usagePacing` object
gets a marker drawn automatically ([`markdown.ts`](../src/providers/markdown.ts), `renderMetricSection`).
So porting a pacing decision is almost always about **gating and inputs**, not rendering:

- **Which providers / slots** are eligible → `usagePacingSlots` on each registry entry
  ([`registry.ts`](../src/providers/registry.ts)).
- **Default window duration** per slot when the payload omits `windowMinutes` →
  `USAGE_PACING_DEFAULT_WINDOW_MINUTES` in [`normalize.ts`](../src/providers/normalize.ts).
- **The formula** → `calculateUsagePacing` in [`usagePacing.ts`](../src/providers/usagePacing.ts)
  (mirrors `UsagePace.swift`; one function for every window, default duration passed in).

Two deliberate, documented divergences we currently keep (don't "fix" them silently):

1. **Labels.** We say *on track / X% ahead / X% behind* and *Runs out in X*. Upstream says
   *on pace / X% in deficit / X% in reserve* and, for session windows, *Projected empty in X*.
   See the `Pacing` entry in [`CONTEXT.md`](../CONTEXT.md).
2. **On-track marker.** Upstream hides the marker when a window is on track; we always draw it.

If you decide to close either gap, do it intentionally and update CONTEXT.md and this list.

---

## Worked example: the session-pacing provider whitelist

This is the case that motivated the guide. *Verified against upstream `eda747ba` (2026-06-10).*

**The question.** The app shows a pace marker on the **session (Primary)** bar for some providers,
not only the **weekly (Secondary)** bar. Which providers, and how do we match it?

**The upstream rule.** Session pace is gated by an explicit provider whitelist in
`UsagePaceText.swift`:

```swift
static func sessionPace(provider: UsageProvider, window: RateWindow, now: Date) -> UsagePace? {
    guard provider == .codex || provider == .claude || provider == .ollama else { return nil }
    ...
    return UsagePace.weekly(window: window, now: now, defaultWindowMinutes: 300)
}
```

Three things to take from this:

- **It is a hand-maintained whitelist, not derivable.** Only `codex`, `claude`, and `ollama` get a
  session-bar marker, even though many providers expose a session/5h window. There is no property of
  the payload that tells you a provider qualifies — you must read the whitelist. Do **not** infer
  eligibility from "has a 5h primary window".
- **The window duration differs by slot.** Session uses `defaultWindowMinutes: 300` (5h); weekly
  uses `10080` (7d). Same formula, different denominator. If you reuse the weekly default for a
  session window, every reset more than 5h out is silently rejected and no marker appears.
- **It only matters when the payload omits `windowMinutes`.** Real payloads often carry an explicit
  `windowMinutes`; the default is the fallback. Mock data usually omits it, so the default is what
  makes (or breaks) the marker in development.

**How it maps here.** `usagePacingSlots` per provider plus the per-slot default duration:

| Provider | `usagePacingSlots` | Session marker | Weekly marker |
| --- | --- | --- | --- |
| codex | `["primary", "secondary"]` | ✅ | ✅ |
| claude | `["primary", "secondary"]` | ✅ | ✅ |
| ollama | `["primary", "secondary"]` | ✅ | ✅ |
| opencode | `["secondary"]` | ❌ | ✅ |
| all others | — | ❌ | ❌ |

```ts
// normalize.ts — session windows reset on a 5h cadence, weekly on 7d.
const USAGE_PACING_DEFAULT_WINDOW_MINUTES = {
  primary: 300,
  secondary: 10_080,
  tertiary: 10_080,
};
```

**Keeping this entry honest.** When upstream changes and you re-verify:

1. Re-read the `guard provider == …` line in `sessionPace`. If the whitelist changed, update the
   `usagePacingSlots` table above and in `registry.ts`, and the test in
   [`registry.test.ts`](../src/providers/registry.test.ts) that pins the expected slots.
2. Update the mock for any newly-eligible provider so its primary window is a valid session window
   (reset within ~5h, enough elapsed for `idealUsedPercentByNow ≥ 3%`), otherwise the marker won't
   render with mock data — see [`mocks/codexbar.ts`](../src/mocks/codexbar.ts).

**Out of scope (different mechanisms, not the plain pace marker).** Upstream also draws something on
the primary bar for `abacus` (billing-cycle pace), `cursor` (billing-cycle pace), and `synthetic`
(rolling-regen detail). These are *not* the session-pace whitelist and use separate code paths;
treat them as their own parity tasks if they come up.
