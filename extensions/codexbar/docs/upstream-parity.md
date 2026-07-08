# Keeping parity with upstream

This extension mirrors behaviour from the **CodexBar macOS app** (`steipete/CodexBar`). The app is
upstream; this extension re-implements a subset of its usage rendering on top of the same `codexbar`
CLI payloads. When a feature "should match the app", upstream Swift is the source of truth — not
memory, and not what the app looked like last month.

This guide is the maintainer reference for **every** place the extension has to track upstream. Read
it before touching provider metadata, pacing, icons, or the sync scripts. For the runtime
architecture (CLI discovery, serve, caches, config writes) see [`maintaining.md`](maintaining.md) and
the [ADRs](adr/); for the vocabulary the code and docs use, see [`CONTEXT.md`](../CONTEXT.md).

---

## The three layers, and which one owns what

| Layer | Repo / location | Owns |
| --- | --- | --- |
| **CodexBar CLI** | external `codexbar` binary | The raw `usage --provider <id>` JSON payload. Field names, window shapes, `windowMinutes`, identity, status. |
| **CodexBar app** | `steipete/CodexBar` (Swift) | How payloads are *interpreted and rendered* — pacing formulas, provider metadata (names/labels/URLs/colors), which providers get which treatment, icons. |
| **This extension** | here (TypeScript) | A re-implementation of the app's rendering for Raycast. Should follow the app's interpretation decisions. |

Parity work almost always means: a payload field already exists, and we need to copy the **app's
decision** about how to treat it. We rarely invent anything — we transcribe Swift into TypeScript.

## Upstream is the source of truth — and it moves

Upstream is the public repo `steipete/CodexBar`. It changes **fast**: a new provider descriptor
(`ClawRouter`) appeared between two clones taken on consecutive days. So two rules:

1. **Read the upstream Swift directly** and treat it as authoritative — not memory, and not how the
   app behaved previously.
2. **Cite what you verified against.** When you record a parity finding (in a plan, a code comment,
   or the tables below), name the upstream file and, where you can, the commit SHA. A parity claim
   with no ref rots silently; a claim with a ref can be re-checked.

### Which ref? The latest **release tag**, not `main`

The sync scripts default to the latest GitHub **release tag** — what actually shipped to users — not
`main`, which may contain unreleased churn. This is deliberate (`scripts/lib/upstream.mjs`). Override
when you need to:

| Env var | Effect |
| --- | --- |
| _(none)_ | Resolve and compare against the latest release tag. |
| `CODEXBAR_REF=main` | Compare against a branch / tag / SHA (use to preview what a future release will demand). |
| `CODEXBAR_DIR=~/code/CodexBar` | Compare against a local checkout — skips the network entirely. Best for iterating. |
| `GITHUB_TOKEN=…` | Raise the GitHub API rate limit. The unauthenticated limit is low; a bare `403` from `api.github.com` is almost always this. Set the token or use `CODEXBAR_DIR`. |

Resolution failures throw rather than falling back to a different ref — a checker that silently
compares against the wrong thing answers a question nobody asked.

---

## The parity surfaces at a glance

There are five distinct surfaces where we track upstream. Two are **guarded by scripts** (drift fails
CI-style), three are **hand-maintained** (drift is silent — you only catch it by re-reading Swift).

| # | Surface | Where it lives here | How drift is caught | Upstream source |
| - | --- | --- | --- | --- |
| 1 | Provider metadata — names, labels, dashboard/status URLs, brand colors | `registry.ts` `PROVIDER_DEFINITIONS` | `npm run upstream:check` | `Sources/CodexBarCore/Providers/**/…ProviderDescriptor.swift` |
| 2 | Dynamic usage-bar label overrides | `normalize.ts` `resolveSlotDisplayTitle` | `npm run upstream:check` | renderer files (see below) + descriptor `primaryLabel` |
| 3 | Provider icons | `assets/provider-icons/*.svg` | `npm run upstream:sync-icons -- --check` | `Sources/CodexBar/Resources/ProviderIcon-<slug>.svg` |
| 4 | Pacing — formula, gating, labels | `usagePacing.ts`, `registry.ts`, `normalize.ts` | ❌ hand-maintained | `UsagePace.swift`, `UsagePaceText.swift`, `MenuCardView*.swift` |
| 5 | Supplemental usage shapes | `normalize.ts` mappers | ❌ hand-maintained | descriptor / snapshot shapes |
| — | Provider id aliases | `registry.ts` `PROVIDER_ID_ALIASES` | ❌ hand-maintained | `ProviderCLIConfig` (`cliName` + aliases) |

Everything else the extension renders is derived, not tracked — e.g. the dark-mode progress fill is
`brandColor` mixed 20% toward white (`buildProgressPalette`), so it follows the brand color
automatically and is **not** a parity surface. Don't hand-edit derived values.

---

## Surface 1 — Provider metadata (`upstream:check`)

`registry.ts` `PROVIDER_DEFINITIONS` holds one entry per provider id: `name`, `brandColor`,
`usageSectionLabels` (Primary/Secondary/Tertiary display titles — see CONTEXT.md "Display title"),
`dashboardUrl`, `subscriptionDashboardUrl`, `statusPageUrl`, and `icon`.

`npm run upstream:check` parses each upstream `…ProviderDescriptor.swift`, parses `registry.ts` with
regexes, and diffs them. It exits non-zero on:

- a provider present upstream but **missing** from the registry (a new provider shipped);
- a provider in the registry with **no upstream descriptor** (renamed/removed upstream);
- any field mismatch (`name`, the three labels, the URLs, `brandColor`);
- a **stale** `ALLOWED_DIVERGENCES` entry (see below);
- an unaccounted dynamic override (surface 2).

Both sides are parsed by regex over stable formatting. If a parser can no longer find what it expects
it **throws loudly** rather than quietly verifying less — so a format change on either side is a
failure to fix, not a silent gap. If you reformat `PROVIDER_DEFINITIONS`, keep the shape the parser
expects (two-space-indented `id: {` … `},` blocks; one `usageSectionLabels: { … }` line).

### `ALLOWED_DIVERGENCES` — recording an intentional difference

Some upstream URLs are **computed** (`ZaiAPIRegion.global.dashboardURL.absoluteString`), not string
literals. The parser can't resolve a Swift expression, so it surfaces it as `expr:<code>`. When ours
is a deliberately-resolved constant, record the pair in `ALLOWED_DIVERGENCES` (in
`scripts/check-upstream.mjs`) with `ours`, `upstream`, and a `reason`:

```js
zai: {
  dashboardUrl: {
    ours: "https://z.ai/manage-apikey/coding-plan/personal/my-plan",
    upstream: "expr:ZaiAPIRegion.global.dashboardURL.absoluteString",
    reason: "upstream computes the URL per region; ours is the resolved .global constant",
  },
},
```

The allowance suppresses **only that exact pair**. If either side moves — including into agreement —
the entry is reported *stale* and must be re-reviewed and updated or deleted. It cannot rot into a
blanket exemption. When upstream changes a computed URL, you re-resolve the constant by hand and
update `ours`; the stale-entry failure is what tells you to.

## Surface 2 — Dynamic usage-bar label overrides

Static labels live in `usageSectionLabels`. On top of them, upstream's renderers relabel some bars
**dynamically** from payload contents. We port these into `resolveSlotDisplayTitle` (`normalize.ts`):

- **factory** — switches to 5-hour / Weekly / Monthly whenever a tertiary window is present.
- **grok** — relabels its primary bar by billing-window length (`windowMinutes`, else the distance to
  `resetsAt`).
- **doubao** — relabels a windowless "requests"-style primary as "Requests".

`upstream:check` scans the renderer files for override call sites and cross-checks them against two
lists in `check-upstream.mjs`:

- `IMPLEMENTED_DYNAMIC_OVERRIDES` — ported in `resolveSlotDisplayTitle` (`factory`, `grok`, `doubao`).
- `UNPORTABLE_DYNAMIC_OVERRIDES` — cannot be ported because the CLI JSON lacks the field they key on
  (e.g. `cursor`'s legacy "Requests" relabel keys on `cursorRequests`, which upstream marks live-only
  and never serializes into `codexbar usage --json`).

If upstream adds a dynamic override for a new provider, the check fails until you either port it (and
add the id to `IMPLEMENTED_DYNAMIC_OVERRIDES`) or justify it as unportable. If upstream *removes* one,
the check flags the now-orphaned list entry.

The renderer files scanned are pinned in `RENDERER_PATHS`:

```
Sources/CodexBar/MenuDescriptor.swift
Sources/CodexBar/MenuCardView+ModelHelpers.swift
Sources/CodexBar/UsageStore+WidgetSnapshot.swift
Sources/CodexBarCLI/CLIRenderer.swift
```

A renamed/deleted file fails loudly on read. A **brand-new** renderer file is the one blind spot: it
is invisible until someone adds it here. If upstream introduces a new surface that renders usage-bar
titles, add its path to `RENDERER_PATHS`. The scan is also a heuristic (regex, not a Swift parser);
its known limitations are commented in `parseDynamicOverrideProviders`.

## Surface 3 — Provider icons (`upstream:sync-icons`)

Every `providerIcon("<slug>")` in the registry maps to
`assets/provider-icons/<slug>.svg`, harvested from upstream's
`Sources/CodexBar/Resources/ProviderIcon-<slug>.svg`.

- `npm run upstream:sync-icons` — fetch, optimize (SVGO), normalize the root to `width/height="100"`
  while keeping `viewBox`, and write any changed icons.
- `npm run upstream:sync-icons -- --check` — same, but exit non-zero if anything is out of date
  (writes nothing). Use this as the drift guard.

It also warns about **stale local icons** (an SVG with no registry entry pointing at it) and about
registry entries whose `icon` isn't a `providerIcon(...)` (those use a bare Raycast `Icon` and have no
SVG to sync — fine, but listed so you notice). Icons are tinted `Color.PrimaryText` at render time, so
upstream's own fills don't matter; the geometry does.

## Surface 4 — Pacing (hand-maintained)

The pace marker/formula is **not** script-guarded. It's transcribed Swift, and the only way to catch
drift is to re-read the upstream files. The full worked example is below; the short version:

- **The formula** → `calculateUsagePacing` in [`usagePacing.ts`](../src/providers/usagePacing.ts),
  mirroring `UsagePace.swift` (`expected = elapsed/duration * 100`, stage thresholds, run-out
  projection). One function for every window; only the default window duration varies.
- **Default window duration** (used when the payload omits `windowMinutes`) →
  `USAGE_PACING_DEFAULT_WINDOW_MINUTES` in [`normalize.ts`](../src/providers/normalize.ts):
  `primary: 300` (5h session), `secondary`/`tertiary: 10_080` (7d weekly).
- **Which providers / slots** are eligible → `usagePacingSlots` on each registry entry.
- **Labels** → `formatUsagePacingLabels` in `usagePacing.ts`.

### Two deliberate divergences we keep (don't "fix" silently)

1. **Labels.** We say *on track / X% ahead / X% behind* and *Runs out in X*. Upstream says *on pace /
   X% in deficit / X% in reserve* and, for session windows, *Projected empty in X*. See the `Pacing`
   entry in [`CONTEXT.md`](../CONTEXT.md). (There is an in-flight plan to adopt upstream wording;
   until it lands, this is the intended state, not a bug.)
2. **On-track marker.** Upstream hides the marker when a window is on track; we always draw it.

If you close either gap, do it intentionally and update CONTEXT.md and this list.

### Out of scope — not the plain pace marker

Upstream also draws something on the primary bar for `abacus` (billing-cycle pace), `cursor`
(billing-cycle pace), and `synthetic` (rolling-regen detail). These are **separate code paths**, not
the session-pace whitelist. Treat each as its own parity task if it comes up.

## Surface 5 — Supplemental usage shapes (hand-maintained)

Beyond Primary/Secondary/Tertiary, upstream models a long list of provider-specific meters. We map a
few, per a field-name → mapper table (`SUPPLEMENTAL_USAGE_MAPPERS` in `normalize.ts`) plus special
cases:

- **Mapped:** Codex's "Code review" allowance (`codeReviewRemainingPercent`), named **extra rate
  windows** (`extraRateWindows`, e.g. "Codex Spark"), and OpenRouter key usage (`openRouterUsage`).
- **Deferred / unmapped:** `cursorRequests`, `zaiUsage`, `minimaxUsage`, `kiroUsage`, `mistralUsage`,
  `deepseekUsage`, `deepgramUsage`, `openAIAPIUsage`, `claudeAdminAPIUsage`, `antigravityPlanInfo`.
  These are deferred until we can sample their live JSON — **an unmapped shape renders nothing**
  (silent, by design), so mapping one requires a real payload to key against, not a guess. See the
  `Supplemental usage` entry in [`CONTEXT.md`](../CONTEXT.md).

## Provider id aliases (hand-maintained)

The CLI accepts alternate spellings for a provider id (its `cliName` plus upstream aliases from
`ProviderCLIConfig`, e.g. `alibaba-coding-plan` → `alibaba`, `groqcloud` → `groq`). `PROVIDER_ID_ALIASES`
in `registry.ts` resolves each to the **canonical** id — the upstream enum case name, which is what
`config.json` and the payloads use — so a config listing either spelling renders one row. When
upstream adds an alias, add it here, or a user's config that uses the new spelling falls through to
the title-cased fallback row.

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

> **Note.** An in-flight plan replaces this per-provider whitelist with upstream's newer *generic*
> gating rule (`UsageStore+HistoricalPace.swift`). Until it lands, the whitelist above is current.
> When it lands, rewrite this section against the generic rule and delete the whitelist framing.
</content>
</invoke>
