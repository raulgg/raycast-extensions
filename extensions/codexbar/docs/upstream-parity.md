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

There are six distinct surfaces where we track upstream. Three are **guarded by scripts** (drift
fails CI-style), three are **hand-maintained** (drift is silent — you only catch it by re-reading
Swift).

| # | Surface | Where it lives here | How drift is caught | Upstream source |
| - | --- | --- | --- | --- |
| 1 | Provider metadata — names, labels, dashboard/status URLs, brand colors | `registry.ts` `PROVIDER_DEFINITIONS` | `npm run upstream:check` | `Sources/CodexBarCore/Providers/**/…ProviderDescriptor.swift` |
| 2 | Dynamic usage-bar label overrides | `normalize.ts` `resolveSlotDisplayTitle` | `npm run upstream:check` | renderer files (see below) + descriptor `primaryLabel` |
| 3 | Provider icons | `assets/provider-icons/*.svg` | `npm run upstream:sync-icons -- --check` | `Sources/CodexBar/Resources/ProviderIcon-<slug>.svg` |
| 4 | Pacing — formula, gating, labels | `paceCapabilities.ts`, `usagePacing.ts`, `normalize.ts` | `npm run upstream:check` | descriptor `pace:` + `UsagePace.swift`, `UsagePaceText.swift`, `MenuCardView*.swift` |
| 5 | Supplemental usage shapes | `normalize.ts` mappers | ❌ hand-maintained | descriptor / snapshot shapes |
| 6 | CLI install routine — the app's **Install CLI** button | `cliInstall.ts` `installCodexBarCli` | ❌ hand-maintained | `Sources/CodexBar/PreferencesAdvancedPane.swift` |
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

Both sides are parsed by regex over stable formatting. Descriptor fields are read from the
`ProviderMetadata(` literal (not an earlier `displayName:` in a validator) and branding colors
from `ProviderColor(red:green:blue:)` or `ProviderColor(hex: 0xRRGGBB)`. If a parser can no longer
find what it expects it **throws loudly** rather than quietly verifying less — so a format change
on either side is a failure to fix, not a silent gap. If you reformat `PROVIDER_DEFINITIONS`, keep
the shape the parser expects (two-space-indented `id: {` … `},` blocks; one
`usageSectionLabels: { … }` line).

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

- **codex** — titles follow window length (`CodexConsumerProjection.rateTitle`): 5-hour → Session,
  7-day → Weekly, 30-day → Monthly.
- **factory** — switches to 5-hour / Weekly / Monthly whenever a tertiary window is present.
- **grok** — relabels its primary bar by billing-window length (`windowMinutes`, else the distance to
  `resetsAt`). Untyped windows with only `resetsAt` fall back to "Weekly" (`displayLabel`, #2929).
- **doubao** — relabels a windowless "requests"-style primary as "Requests".
- **crof** — relabels a lone primary as "Credits", or "Requests" when a secondary window is present.
- **amp** — dual-window accounts become "Other usage" / "Orb usage"; a lone primary keeps "Amp Free".
- **alibabatokenplan** — a 5-hour primary becomes "5-hour", a 7-day secondary becomes "7-day".
- **sub2api** — a present secondary window relabels primary as "Daily quota" (MenuCardView
  shortens secondary/tertiary; we keep the descriptor's Weekly quota / Monthly quota).

`upstream:check` scans the renderer files for override call sites and cross-checks them against two
lists in `check-upstream.mjs`:

- `IMPLEMENTED_DYNAMIC_OVERRIDES` — ported in `resolveSlotDisplayTitle` (`codex`, `factory`, `grok`,
  `doubao`, `crof`, `amp`, `alibabatokenplan`, `sub2api`).
- `UNPORTABLE_DYNAMIC_OVERRIDES` — cannot be ported because the CLI JSON lacks the field they key on
  (e.g. `cursor`'s legacy "Requests" relabel keys on `snapshot.detailRow(label: "Request quota")`).

If upstream adds a dynamic override for a new provider, the check fails until you either port it (and
add the id to `IMPLEMENTED_DYNAMIC_OVERRIDES`) or justify it as unportable. If upstream *removes* one,
the check flags the now-orphaned list entry.

The renderer files scanned are pinned in `RENDERER_PATHS`:

```
Sources/CodexBar/MenuDescriptor.swift
Sources/CodexBar/MenuCardView+ModelHelpers.swift
Sources/CodexBar/UsageStore+WidgetSnapshot.swift
Sources/CodexBarCLI/CLIRenderer.swift
Sources/CodexBarCLI/DashboardSnapshotBuilder.swift
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

## Surface 4 — Pacing (`upstream:check`)

*Verified against upstream `v0.55.0` (`061593ca`).*

Eligibility lives in [`paceCapabilities.ts`](../src/providers/paceCapabilities.ts), a table that
mirrors each descriptor's `pace: ProviderPaceCapability(...)`. `computeSlotUsagePacing` in
`normalize.ts` evaluates that table the way the **app menu card** does, not the CLI's
`resolvedKind` (those two disagree for some providers; the GUI wins).

- **The formula** → `calculateUsagePacing` in [`usagePacing.ts`](../src/providers/usagePacing.ts),
  mirroring `UsagePace.swift`. Session default 300 minutes; weekly default 10_080. Calendar-month
  sentinels (43_200) are expanded to the real month via `inferredMonthlyWindowMinutes`.
- **Gating** → `sessionPaceWindowRule` on primary (and Kimi's secondary), else `resetWindowPace` on
  any slot, else the generic weekly rule (`windowMinutes` required except Codex secondary).
- **Labels** → `formatUsagePacingLabels` in `usagePacing.ts`.

`upstream:check` parses every descriptor `pace:` argument, diffs it against the table, and treats
`.custom { ... }` closures as fingerprints in `CUSTOM_PACE_RULES`. An unknown custom, a changed
body, or a new `pace:` on a previously-unsupported provider fails the check. Presentation-only
paths (`usesAbacusPace`, `usesSyntheticRollingRegen`) and Kimi's secondary `sessionPaceDetail` in
`MenuCardView.swift` are scanned the same way dynamic labels are.

Do **not** session-pace OpenCode Go's 5-hour primary: `sessionPaceWindowRule` is `.unsupported` in
the GUI even though the CLI `resolvedKind` lane would allow it.

### One deliberate divergence we keep

**On-track marker.** Upstream hides the marker when a window is on track; we always draw it.

### Out of scope — not the plain pace marker

Abacus billing-cycle copy and Synthetic rolling-regen detail are listed in
`UNPORTABLE_PRESENTATION_PACE`. Codex `showsHeadroomHint` (1.5×), workday-aware pacing, and
historical run-out probability are not implemented.

## Codex-only raw projection — weekly caps session

On the **raw** usage path (no `presentation.schemaVersion === 1` meters), Codex applies the app's
`CodexConsumerProjection.weeklyCapsSession` rule in `normalize.ts`: when weekly remaining is 0 and
still binding, Primary is forced to 0% remaining and its reset is retargeted via `bindingReset`.
Presentation meters stay authoritative (ADR-0005) — the cap is not re-applied on that path.

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

## Surface 6 — CLI install routine (hand-maintained)

*Verified against upstream `v0.45.1` (`757f1ca1`).*

When the CodexBar CLI is missing but the CodexBar app is installed, the extension can set up the
app's bundled CLI itself (ADR-0008). `installCodexBarCli` in
[`cliInstall.ts`](../src/lib/cliInstall.ts) is a faithful port of the app's own **Install CLI**
button — `installCLI()` in `Sources/CodexBar/PreferencesAdvancedPane.swift` — and is the first place
the extension mirrors upstream **behaviour** rather than payload interpretation. The properties that
must survive any edit:

- Tries **both** `/usr/local/bin/codexbar` and `/opt/homebrew/bin/codexbar`, in that order,
  best-effort — partial success is a normal outcome, not first-writable-wins.
- **Never overwrites** an existing destination (no `ln -sf`): a foreign file is reported (`Exists:`)
  and left alone.
- **No `mkdir`** — a missing prefix is skipped without a result entry (which is how
  `No writable bin dirs found.` is reached) — and **no privilege escalation**: a non-writable dir is
  reported, never sudo'd. (The repo script `bin/install-codexbar-cli.sh` *does* escalate; we follow
  the GUI, not the script.)
- The result strings are upstream's, verbatim: `Installed: {dir}` · `Exists: {dir}` ·
  `No write access: {dir}` · `Failed: {dir}` · `No writable bin dirs found.` ·
  `CodexBarCLI not found in app bundle.`

When re-verifying, re-read `installCLI()` and its `isLink` helper in
`PreferencesAdvancedPane.swift`. [`cliInstall.test.ts`](../src/lib/cliInstall.test.ts) pins each
property against real temp dirs, but only Swift says whether the algorithm itself moved.

## Provider id aliases (hand-maintained)

The CLI accepts alternate spellings for a provider id (its `cliName` plus upstream aliases from
`ProviderCLIConfig`, e.g. `alibaba-coding-plan` → `alibaba`, `groqcloud` → `groq`). `PROVIDER_ID_ALIASES`
in `registry.ts` resolves each to the **canonical** id — the upstream enum case name, which is what
`config.json` and the payloads use — so a config listing either spelling renders one row. When
upstream adds an alias, add it here, or a user's config that uses the new spelling falls through to
the title-cased fallback row.

---

## Worked example: catching a new `pace:` row

Session and reset-window eligibility used to be a hand-maintained whitelist. That drifted (Grok
grew a weekly pacer; Cursor/Copilot/Kimi/Zai/Notion already had descriptor rules we were not
running). The table is now `PACE_CAPABILITIES`, and `upstream:check` diffs it against every
descriptor.

When the check fails:

1. Read the descriptor `pace:` block. Parseable cases (`windowDurationPresent`,
   `.calendarMonthResetWindow`, `.session(maximumMinutes:)`, …) go in the table as data. A
   `.custom { }` needs a named function plus a `CUSTOM_PACE_RULES` fingerprint.
2. `computeSlotUsagePacing` already evaluates the table. Add a gating test in
   [`normalize.test.ts`](../src/providers/normalize.test.ts) for the new rule.
3. Give the mock a window that actually satisfies it (reset inside the duration, enough elapsed
   for `idealUsedPercentByNow ≥ 3%`) — see [`mocks/codexbar.ts`](../src/mocks/codexbar.ts).

Do not infer "has a 5-hour primary" from the payload. OpenCode Go is the reminder: the CLI lane
would session-pace that bar, the GUI `sessionPaceWindowRule` would not.
</content>
</invoke>
