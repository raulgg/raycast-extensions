# Keeping parity with upstream

This extension mirrors behaviour from the CodexBar macOS app (`steipete/CodexBar`). The app is
upstream. This extension re-implements a subset of its usage rendering on top of the same `codexbar`
CLI payloads. When a feature "should match the app", upstream Swift is the source of truth. Not
memory, and not what the app looked like last month.

This guide is the maintainer reference for every place the extension has to track upstream. Read
it before touching provider metadata, pacing, icons, or the sync scripts. For the runtime
architecture (CLI discovery, serve, caches, config writes) see [`maintaining.md`](maintaining.md) and
the [ADRs](adr/). For the vocabulary the code and docs use, see [`CONTEXT.md`](../CONTEXT.md).

---

## The three layers, and which one owns what

| Layer | Repo / location | Owns |
| --- | --- | --- |
| **CodexBar CLI** | external `codexbar` binary | The raw `usage --provider <id>` JSON payload. Field names, window shapes, `windowMinutes`, identity, status. |
| **CodexBar app** | `steipete/CodexBar` (Swift) | How payloads are interpreted and rendered. Pacing formulas, provider metadata (names, labels, URLs, colors), which providers get which treatment, icons. |
| **This extension** | here (TypeScript) | A re-implementation of the app's rendering for Raycast. Should follow the app's interpretation decisions. |

Parity work almost always means a payload field already exists, and we need to copy the app's
decision about how to treat it. We rarely invent anything. We transcribe Swift into TypeScript.

## Upstream is the source of truth, and it moves

Upstream is the public repo `steipete/CodexBar`. It changes fast. A new provider descriptor
(`ClawRouter`) appeared between two clones taken on consecutive days. Two rules:

1. **Read the upstream Swift directly** and treat it as authoritative. Not memory, and not how the
   app behaved previously.
2. **Cite what you verified against.** When you record a parity finding (in a plan, a code comment,
   or the tables below), name the upstream file and, where you can, the commit SHA. A parity claim
   with no ref rots. A claim with a ref can be re-checked.

### Which ref? The SHA in `codexbar-upstream.lock`

The sync scripts default to the pinned commit in [`codexbar-upstream.lock`](../codexbar-upstream.lock)
(tag plus SHA of a shipped GitHub release). They do not float on `releases/latest`. Run
`npm run upstream:bump` to check the current latest release and, if both guards pass, move the pin.
Override when you need to:

| Env var | Effect |
| --- | --- |
| _(none)_ | Compare against the lockfile SHA. Missing or malformed lockfile throws. |
| `CODEXBAR_REF=main` | Compare against a branch, tag, or SHA (preview a future release). |
| `CODEXBAR_DIR=~/code/CodexBar` | Compare against a local checkout. Skips the network. Ignores the lockfile and `CODEXBAR_REF`. |
| `GITHUB_TOKEN=…` | Raise the GitHub API rate limit. The unauthenticated limit is low. A bare `403` from `api.github.com` is almost always this. Set the token or use `CODEXBAR_DIR`. |

Resolution failures throw rather than falling back to a different ref. A checker that silently
compares against the wrong thing is worse than a hard failure.

---

## The parity surfaces at a glance

There are six distinct surfaces where we track upstream. Three are guarded by scripts (drift
fails the check). Three are hand-maintained (drift is silent until you re-read Swift).

| # | What | Where it lives here | How drift is caught | Upstream source |
| - | --- | --- | --- | --- |
| 1 | Provider metadata (names, labels, dashboard/status URLs, brand colors) | `catalog.ts` `PROVIDER_CATALOG` | `npm run upstream:check` | `Sources/CodexBarCore/Providers/**/…ProviderDescriptor.swift` |
| 2 | Dynamic usage-bar label overrides | `paceCapabilities.ts` `DYNAMIC_SLOT_TITLES` | `npm run upstream:check` (id lists only, see Surface 2) | renderer files (see below) plus descriptor `primaryLabel` |
| 3 | Provider icons | `assets/provider-icons/*.svg` | `npm run upstream:sync-icons -- --check` | `Sources/CodexBar/Resources/ProviderIcon-<slug>.svg` |
| 4 | Pacing, gating | `paceCapabilities.ts` | `npm run upstream:check` | descriptor `pace:` plus MenuCardView extra/secondary scans |
| 4b | Pacing, formula and labels | `usagePacing.ts` | ❌ hand-maintained | `UsagePace.swift`, `UsagePaceText.swift` |
| 5 | Supplemental usage shapes | `normalize.ts` mappers | ❌ hand-maintained | descriptor / snapshot shapes |
| 6 | CLI install routine (the app's Install CLI button) | `cliInstall.ts` `installCodexBarCli` | ❌ hand-maintained | `Sources/CodexBar/PreferencesAdvancedPane.swift` |
| | Provider id aliases | `catalog.ts` `PROVIDER_ID_ALIASES` | ❌ hand-maintained | `ProviderCLIConfig` (`cliName` plus aliases) |

Everything else the extension renders is derived, not tracked. The dark-mode progress fill is
`brandColor` mixed 20% toward white (`buildProgressPalette`), so it follows the brand color
automatically. Don't hand-edit derived values.

---

## Surface 1. Provider metadata (`upstream:check`)

`catalog.ts` `PROVIDER_CATALOG` holds one entry per provider id: `name`, `brandColor`,
`usageSectionLabels` (Primary/Secondary/Tertiary display titles, see CONTEXT.md "Display title"),
`dashboardUrl`, `subscriptionDashboardUrl`, `statusPageUrl`, `iconSlug`, and optional `iconFallback`.
`registry.ts` is the Raycast adapter over that catalog (icons, palettes, lookups).

`npm run upstream:check` imports the catalog and diffs it against each upstream
`…ProviderDescriptor.swift`. It exits non-zero on:

- a provider present upstream but missing from the catalog (a new provider shipped)
- a provider in the catalog with no upstream descriptor (renamed or removed upstream)
- any field mismatch (`name`, the three labels, the URLs, `brandColor`)
- a stale `ALLOWED_DIVERGENCES` entry (see below)
- an unaccounted dynamic override (surface 2)

The catalog is imported as data, so reformatting it cannot hide a field. Upstream descriptors are
still parsed by regex over stable formatting. Descriptor fields are read from the
`ProviderMetadata(` literal (not an earlier `displayName:` in a validator) and branding colors
from `ProviderColor(red:green:blue:)` or `ProviderColor(hex: 0xRRGGBB)`. If a parser can no longer
find what it expects, it throws. A format change on the Swift side is a failure to fix, not a
silent gap.

### `ALLOWED_DIVERGENCES`. Recording an intentional difference

Some upstream URLs are computed (`ZaiAPIRegion.global.dashboardURL.absoluteString`), not string
literals. The parser can't resolve a Swift expression, so it records it as `expr:<code>`. When ours
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

The allowance suppresses only that exact pair. If either side moves, including into agreement,
the entry is reported stale and must be re-reviewed and updated or deleted. It cannot sit around
as a blanket exemption. When upstream changes a computed URL, you re-resolve the constant by hand
and update `ours`. The stale-entry failure is what tells you to.

## Surface 2. Dynamic usage-bar label overrides

Static labels live in `usageSectionLabels`. On top of them, upstream's renderers relabel some bars
from payload contents. We port these into `DYNAMIC_SLOT_TITLES` (`paceCapabilities.ts`).
`normalize.ts` applies that map, then falls back to the catalog's static label:

- **codex.** Titles follow window length (`CodexConsumerProjection.rateTitle`). 5-hour becomes
  Session, 7-day becomes Weekly, 30-day becomes Monthly.
- **factory.** Switches to 5-hour / Weekly / Monthly whenever a tertiary window is present.
- **grok.** Relabels its primary bar by billing-window length (`windowMinutes`, else the distance to
  `resetsAt`). Untyped windows with only `resetsAt` fall back to "Weekly" (`displayLabel`, #2929).
- **doubao.** Relabels a windowless "requests"-style primary as "Requests".
- **crof.** Relabels a lone primary as "Credits", or "Requests" when a secondary window is present.
- **amp.** Dual-window accounts become "Other usage" / "Orb usage". A lone primary keeps "Amp Free".
- **alibabatokenplan.** A 5-hour primary becomes "5-hour", a 7-day secondary becomes "7-day".
- **sub2api.** A present secondary window relabels primary as "Daily quota". MenuCardView shortens
  secondary/tertiary. We keep the descriptor's Weekly quota / Monthly quota.

`upstream:check` scans the renderer files for override call sites and cross-checks them against
`DYNAMIC_SLOT_TITLES` and `UNPORTABLE_DYNAMIC_TITLES` in `paceCapabilities.ts` (imported, the same
map `normalize.ts` uses). `cursor` is unportable. MenuCardView keys on
`snapshot.detailRow(label: "Request quota")`, which the CLI JSON does not expose.

A green check means every scanned id is a key of that map or the unportable list. Presentation
meters (`schemaVersion === 1`) still use the CLI's `meter.label` and never call
`resolveDynamicSlotTitle`. If upstream adds a dynamic override, the check fails until you add a
map entry or mark it unportable.

The renderer files scanned are pinned in `RENDERER_PATHS`:

```
Sources/CodexBar/MenuDescriptor.swift
Sources/CodexBar/MenuCardView+ModelHelpers.swift
Sources/CodexBar/UsageStore+WidgetSnapshot.swift
Sources/CodexBarCLI/CLIRenderer.swift
Sources/CodexBarCLI/DashboardSnapshotBuilder.swift
```

A renamed or deleted file fails on read. A brand-new renderer file is the one blind spot. It is
invisible until someone adds it here. If upstream introduces a new file that renders usage-bar
titles, add its path to `RENDERER_PATHS`. The scan is a heuristic (regex, not a Swift parser).
Its known limitations are commented in `parseDynamicOverrideProviders`.

## Surface 3. Provider icons (`upstream:sync-icons`)

Every catalog `iconSlug` maps to `assets/provider-icons/<slug>.svg`, harvested from upstream's
`Sources/CodexBar/Resources/ProviderIcon-<slug>.svg`.

- `npm run upstream:sync-icons` fetches, optimizes with SVGO, normalizes the root to
  `width/height="100"` while keeping `viewBox`, and writes any changed icons.
- `npm run upstream:sync-icons -- --check` does the same but writes nothing and exits non-zero if an
  icon is out of date or a local SVG has no catalog `iconSlug` pointing at it.

Icons are tinted `Color.PrimaryText` at render time, so upstream's own fills don't matter. The
geometry does. SVGO runs `preset-default` plus `removeScripts` before compare/write. Slugs that
contain `..`, a leading `/`, or a path separator fail the script.

## Surface 4. Pacing (`upstream:check`)

*Verified against upstream `v0.55.0` (`061593ca`).*

Eligibility lives in [`paceCapabilities.ts`](../src/providers/paceCapabilities.ts), a table that
mirrors each descriptor's `pace: ProviderPaceCapability(...)`. `computeSlotUsagePacing` in
`normalize.ts` evaluates that table the way the app menu card does, not the CLI's `resolvedKind`.
Those two disagree for some providers. The GUI wins.

- **The formula.** `calculateUsagePacing` in [`usagePacing.ts`](../src/providers/usagePacing.ts),
  mirroring `UsagePace.swift`. Session default 300 minutes, weekly default 10_080. Calendar-month
  sentinels (43_200) are expanded to the real month via `inferredMonthlyWindowMinutes`. Not
  compared by `upstream:check`.
- **Gating.** `sessionPaceWindowRule` on primary (and Kimi's secondary), else `resetWindowPace`.
  Secondary (not tertiary) then uses the generic weekly rule (`windowMinutes` required except Codex
  via `secondaryAllowsDefaultWindow`). Named extra rate windows use `resolveExtraWindowPace`
  (Codex, Claude, Antigravity. 300-minute extras as session except Claude, 10080 as weekly).
- **Labels.** `formatUsagePacingLabels` in `usagePacing.ts`. Not compared by `upstream:check`.

`upstream:check` imports `PACE_CAPABILITIES` and diffs the GUI fields (`resetWindowPace`,
`inferredMonthlyDuration`, `sessionPaceWindowRule`) against each descriptor `pace:` argument.
`secondaryAllowsDefaultWindow` is TypeScript-only, not a Swift `pace:` field. A unit test in
`paceCapabilities.test.ts` pins it to Codex.
CLI `resolvedKind` lanes are parsed so an unknown field still throws, but they are not compared.
`.custom { ... }` closures are Swift fingerprints in `CUSTOM_PACE_RULES`. `Self.foo` wrappers are
inlined. An unknown custom, a changed body, or a new `pace:` on a previously-unsupported provider
fails the check.
Presentation-only paths (`usesAbacusPace`, `usesSyntheticRollingRegen`), Codex
`showsHeadroomHint` (`UNPORTABLE_HEADROOM_HINT`), secondary `sessionPaceDetail` in
`secondaryMetric`, and `extraRateWindowPaceDetail` provider names are scanned the same way
dynamic labels are.

Do not session-pace OpenCode Go's 5-hour primary. `sessionPaceWindowRule` is `.unsupported` in
the GUI even though the CLI `resolvedKind` lane would allow it.

### One deliberate divergence we keep

**Tick geometry.** Upstream's pace tip is a Canvas three-stripe punch (`UsageProgressBar.swift`).
We keep a simple 3×12 rounded rect. We punch a transparent gutter through the bar around that tick
so the color stays readable on similar brand fills. Color and hide-when-on-pace match the app
(`v0.55.0`, `061593ca`). Deficit is SwiftUI `Color.red`, reserve is `Color.green`.

### Out of scope. Not the plain pace marker

Abacus billing-cycle copy and Synthetic rolling-regen detail are listed in
`UNPORTABLE_PRESENTATION_PACE`. Codex `showsHeadroomHint` (1.5×) is listed in
`UNPORTABLE_HEADROOM_HINT`. Workday-aware pacing and historical run-out probability are not
implemented.

## Codex-only raw projection. Weekly caps session

On the raw usage path (no `presentation.schemaVersion === 1` meters), Codex applies the app's
`CodexConsumerProjection.weeklyCapsSession` rule in `normalize.ts`. When weekly remaining is 0 and
still binding, Primary is forced to 0% remaining and its reset is retargeted via `bindingReset`.
Presentation meters stay authoritative (ADR-0005). The cap is not re-applied on that path.

## Surface 5. Supplemental usage shapes (hand-maintained)

Beyond Primary/Secondary/Tertiary, upstream models a long list of provider-specific meters. We map a
few, per a field-name to mapper table (`SUPPLEMENTAL_USAGE_MAPPERS` in `normalize.ts`) plus special
cases:

- **Mapped.** Codex's "Code review" allowance (`codeReviewRemainingPercent`), named extra rate
  windows (`extraRateWindows`, e.g. "Codex Spark"), and OpenRouter key usage (`openRouterUsage`).
  Antigravity extras whose ids start with `antigravity-quota-summary-` are what the detail card
  draws. Primary and Secondary are copies for the list adornment, the same rule as
  `antigravityMetrics` in `MenuCardView+ModelHelpers.swift`. Skip the slot-hiding rewrite when
  presentation meters are already present.
- **Deferred / unmapped.** `cursorRequests`, `zaiUsage`, `minimaxUsage`, `kiroUsage`, `mistralUsage`,
  `deepseekUsage`, `deepgramUsage`, `openAIAPIUsage`, `claudeAdminAPIUsage`, `antigravityPlanInfo`.
  These wait until we can sample their live JSON. An unmapped shape renders nothing, silent by
  design, so mapping one requires a real payload to key against, not a guess. See the
  `Supplemental usage` entry in [`CONTEXT.md`](../CONTEXT.md).

## Surface 6. CLI install routine (hand-maintained)

*Verified against upstream `v0.45.1` (`757f1ca1`).*

When the CodexBar CLI is missing but the CodexBar app is installed, the extension can set up the
app's bundled CLI itself (ADR-0008). `installCodexBarCli` in
[`cliInstall.ts`](../src/lib/cliInstall.ts) is a port of the app's own Install CLI
button, `installCLI()` in `Sources/CodexBar/PreferencesAdvancedPane.swift`. This is the first place
the extension mirrors upstream behaviour rather than payload interpretation. The properties that
must survive any edit:

- Tries both `/usr/local/bin/codexbar` and `/opt/homebrew/bin/codexbar`, in that order,
  best-effort. Partial success is a normal outcome, not first-writable-wins.
- Never overwrites an existing destination (no `ln -sf`). A foreign file is reported (`Exists:`)
  and left alone.
- No `mkdir`. A missing prefix is skipped without a result entry, which is how
  `No writable bin dirs found.` is reached. No privilege escalation. A non-writable dir is
  reported, never sudo'd. The repo script `bin/install-codexbar-cli.sh` does escalate. We follow
  the GUI, not the script.
- The result strings are upstream's, verbatim: `Installed: {dir}` · `Exists: {dir}` ·
  `No write access: {dir}` · `Failed: {dir}` · `No writable bin dirs found.` ·
  `CodexBarCLI not found in app bundle.`

When re-verifying, re-read `installCLI()` and its `isLink` helper in
`PreferencesAdvancedPane.swift`. [`cliInstall.test.ts`](../src/lib/cliInstall.test.ts) pins each
property against real temp dirs, but only Swift says whether the algorithm itself moved.

## Provider id aliases (hand-maintained)

The CLI accepts alternate spellings for a provider id (its `cliName` plus upstream aliases from
`ProviderCLIConfig`, e.g. `alibaba-coding-plan` → `alibaba`, `groqcloud` → `groq`). `PROVIDER_ID_ALIASES`
in `catalog.ts` resolves each to the canonical id, the upstream enum case name, which is what
`config.json` and the payloads use. A config listing either spelling renders one row. When
upstream adds an alias, add it here, or a user's config that uses the new spelling falls through to
the title-cased fallback row.

---

## Worked example. Catching a new `pace:` row

Session and reset-window eligibility used to be a hand-maintained whitelist. That drifted. Grok
grew a weekly pacer. Cursor, Copilot, Kimi, Zai, and Notion already had descriptor rules we were not
running. The table is now `PACE_CAPABILITIES`, and `upstream:check` diffs it against every
descriptor.

When the check fails:

1. Read the descriptor `pace:` block. Parseable GUI fields (`windowDurationPresent`,
   `.calendarMonthResetWindow`, `.custom { }`, …) go in the table as data. A `.custom { }` needs a
   named function plus a `CUSTOM_PACE_RULES` fingerprint of the Swift body.
   CLI `resolvedKind` lanes stay out of the table.
2. `computeSlotUsagePacing` already evaluates the table. Add a gating test in
   [`normalize.test.ts`](../src/providers/normalize.test.ts) for the new rule.
3. Give the mock a window that actually satisfies it (reset inside the duration, enough elapsed
   for `idealUsedPercentByNow ≥ 3%`). See [`mocks/codexbar.ts`](../src/mocks/codexbar.ts).

Do not infer "has a 5-hour primary" from the payload. OpenCode Go is the reminder. The CLI lane
would session-pace that bar. The GUI `sessionPaceWindowRule` would not.
