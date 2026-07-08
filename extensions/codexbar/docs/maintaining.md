# Maintaining CodexBar (Raycast extension)

Onboarding and reference for contributors. What the pieces are, how to run and test them, the runtime
quirks that trip people up, and the recurring chore of syncing with upstream.

- **What upstream is, and how to track it** → [`upstream-parity.md`](upstream-parity.md). Read it
  before touching provider metadata, pacing, or icons.
- **The words the code and docs use** → [`CONTEXT.md`](../CONTEXT.md). Provider, Reset window,
  Primary/Secondary/Tertiary, Pacing, etc. Use these terms; avoid the listed synonyms.
- **Why the runtime is shaped the way it is** → [`adr/`](adr/). Four decisions, each with its cost.

## What this extension does, in one paragraph

It shells out to an external `codexbar` CLI (or its `serve` HTTP mode), normalizes the JSON into
usage sections, and renders one row per Configured Provider with usage meters, pacing markers, and
incident badges. It does **not** fetch any provider's API or statuspage itself — the CLI owns all data
acquisition. The extension owns *interpretation and rendering*, re-implemented from the CodexBar
macOS app.

## Repo layout

```
src/
  usage-overview.tsx          Command: Usage Overview (view). The main UI entry point.
  refresh-usage-cache.ts      Command: no-view, 5-min interval. Warms caches + serve. (ADR-0002/0003)
  preferences.ts              Typed access to Raycast preferences (Hide Personal Information).

  lib/
    codexbar.ts               CLI discovery, one-shot exec, serve HTTP client, health check,
                              JSON extraction, error classification. The whole CLI boundary.
    providerConfig.ts         Read ~/.codexbar/config.json; enable/disable via CLI; reorder via
                              direct file write. (ADR-0001/0004)
    providerStatusCache.ts    Dedicated status cache (provider-status:<id>, 30-min TTL). (ADR-0003)
    backgroundRefresh.ts      Orchestration for refresh-usage-cache.
    presentation.ts           Formatting helpers (percentages, durations, currency).
    detailMarkdown.ts, svg.ts, twoBarAccessoryIcon.ts   Rendering helpers.

  providers/
    registry.ts               PROVIDER_DEFINITIONS + PROVIDER_ID_ALIASES. Parity surface 1. Also
                              derives brand palettes and exposes resolveProviderId / lookups.
    normalize.ts              Raw payload -> ProviderSection[]. Dynamic label overrides
                              (resolveSlotDisplayTitle), pacing defaults, supplemental mappers.
    usagePacing.ts            The pace formula, mirroring UsagePace.swift. Parity surface 4.
    status.ts                 Parse the CLI status object into a badge model.
    types.ts                  Shared types.

  components/                 UI: UsageList, ProviderListItem, ProviderDetail, ManageProviders, etc.
  hooks/                      Data hooks: useUsageOverview, useProviderDetails, useProviderStatuses,
                              useAvailableProviders, useMoveProvider, ...
  mocks/codexbar.ts           Dev-only mock payloads (see "Working with mock data").

scripts/
  check-upstream.mjs          npm run upstream:check      — provider metadata + override drift guard.
  sync-provider-icons.mjs     npm run upstream:sync-icons — icon harvest / drift guard.
  lib/upstream.mjs            Shared upstream source (ref resolution, GitHub / local checkout).
  lib/upstream-metadata.mjs   Pure parse/compare logic (unit-tested).

docs/                         This directory. upstream-parity.md, maintaining.md, adr/.
CONTEXT.md                    Domain glossary.
```

Tests are **colocated** (`src/**/*.test.ts[x]`, `scripts/*.test.mjs`) with shared setup under
`test/`. There is a test next to almost every non-trivial module — mirror that when you add code.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | `ray develop` — hot-reload the extension into Raycast. |
| `npm test` | Run the vitest suite once. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run lint` / `npm run fix-lint` | Raycast ESLint (`--fix` to autofix). |
| `npm run build` | `ray build` — production build. |
| `npm run upstream:check` | Guard: provider metadata + dynamic overrides vs upstream. |
| `npm run upstream:sync-icons [-- --check]` | Sync (or check) provider icons vs upstream. |

Before opening a PR: `npm test && npm run lint && npm run upstream:check && npm run upstream:sync-icons -- --check`.

## Runtime quirks worth knowing

These surprise people. Each has an ADR with the full reasoning; the short version:

- **The CLI is found on `PATH`, then two fallback paths.** `resolveCodexBarBinary` searches `PATH`
  (defaulting to a Homebrew-inclusive `PATH` when Raycast's environment has none), then
  `/opt/homebrew/bin/codexbar` and `/usr/local/bin/codexbar`. The CLI can be installed standalone
  (Homebrew, GitHub releases); it does **not** require the CodexBar app. See `codexbar.ts`.
- **Serve is a real daemon, started only by the background refresh.** The extension talks to
  `codexbar serve` over `127.0.0.1:17653`. Only `refresh-usage-cache` may start it; the foreground
  Usage Overview only *reads* an already-healthy serve and otherwise falls back to a one-shot CLI
  call. Opening a view must never silently spawn a long-lived process. Serve is never killed by the
  extension. → **ADR-0002**.
- **Status comes only from the CLI, only in the background.** Incident badges are sourced from
  `usage --status` and cached separately (`provider-status:<id>`, 30-min TTL). Serve mode can't
  produce status, so a serve-sourced refresh pays one extra `usage --status` per provider. If the
  background refresh is disabled, badges simply don't appear — graceful absence, no error, no lazy
  foreground fetch. → **ADR-0003**.
- **The shared config is written two ways.** Enable/disable goes through `codexbar config
  enable/disable` (the app-sanctioned path, with validation and side effects); reorder writes
  `~/.codexbar/config.json` directly (no CLI command exists). Both live in `providerConfig.ts` and are
  serialized in the UI so they can't clobber each other's read-modify-write. → **ADR-0001 / ADR-0004**.
- **The two caches never merge.** Serve-sourced usage writes carry no status and must not clobber a
  cached status (nor the reverse). A poorer refresh payload must not replace a richer cached one
  (quality-aware writes). → **ADR-0003**.

## Working with mock data

`src/mocks/codexbar.ts` supplies fake payloads for development. It only activates when
`environment.isDevelopment && DEV_MOCK` — flip the `DEV_MOCK` const to `true` locally (don't commit
it `true`). Mocks matter for parity: pacing markers only render when the mock window shapes are valid
(e.g. a session window must reset within ~5h with enough elapsed time). When you make a provider
newly pace-eligible, fix its mock too — see the pacing worked example in
[`upstream-parity.md`](upstream-parity.md).

## The recurring chore: syncing with upstream

Upstream ships often. A periodic sync pass:

1. **Point at the ref you want.** Default is the latest release tag. For iterating, clone upstream
   once and export `CODEXBAR_DIR=~/code/CodexBar` (no network, no rate limit). To preview an
   unreleased change, `CODEXBAR_REF=main`. Set `GITHUB_TOKEN` if you hit a `403`.
2. **Run the guards.**
   ```
   npm run upstream:check
   npm run upstream:sync-icons -- --check
   ```
3. **Fix what they flag.** New provider → add a `PROVIDER_DEFINITIONS` entry (name, brandColor,
   labels, URLs, icon) transcribed from its `…ProviderDescriptor.swift`; **don't invent values**. New
   alias → `PROVIDER_ID_ALIASES`. Field mismatch → update the registry, or record an intentional
   `ALLOWED_DIVERGENCES` entry with a reason. New/removed dynamic override → port it into
   `resolveSlotDisplayTitle` and update the override lists, or mark it unportable. Icons out of date →
   drop the `-- --check` and let the sync script write them.
4. **Re-verify the hand-maintained surfaces** the scripts *can't* see: pacing (re-read
   `UsagePaceText.swift` / `UsagePace.swift`), and supplemental shapes if you now have live JSON to
   sample. These only drift silently.
5. **Cite the ref.** In commit messages / plan notes / code comments, name the upstream file and SHA
   you verified against, so the next sync can tell what's already been checked.
6. **Test and lint**, then commit.

The `plans/*.local.md` files (gitignored) capture larger in-flight parity efforts (missing providers,
pace-indicator parity). They snapshot an upstream SHA and are working notes, not the source of
truth — upstream Swift always wins over a plan's snapshot.
</content>
