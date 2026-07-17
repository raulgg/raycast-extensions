# AGENTS.md — CodexBar Raycast extension

Instructions for AI coding agents (and humans) contributing to this extension.

## What this is

A Raycast extension that shells out to the external `codexbar` CLI (steipete's
[CodexBar](https://github.com/steipete/CodexBar) project) and renders coding-agent usage quotas.
It deliberately mirrors the upstream CodexBar macOS app — parity with upstream beats local
invention.

## Direction — read before changing anything

1. **Upstream parity wins.** Wording, pacing semantics, provider metadata, and icons track the
   upstream app. [docs/upstream-parity.md](docs/upstream-parity.md) is required reading before
   touching any of those surfaces.
2. **Provider metadata and icons are script-synced.** Never hand-edit provider entries in
   `src/providers/registry.ts` or files in `assets/provider-icons/`. Run `npm run upstream:check`
   to detect drift and `npm run upstream:sync-icons` to refresh icons.
3. **Vocabulary is fixed.** [CONTEXT.md](CONTEXT.md) defines the domain language (Provider, reset
   window, pacing, supplemental usage, …) and lists terms to avoid. Use those exact terms in code,
   UI copy, and docs.
4. **Architecture decisions are recorded.** [docs/adr/](docs/adr/) holds the accepted trade-offs
   (shared config ownership, serve-daemon startup, CLI-only status, config write ownership). Don't
   reverse one silently — propose a new ADR in your PR instead.

## Working here

- Develop with `npm run dev`. For mock data without a configured CLI, set `DEV_MOCK = true` in
  `src/mocks/codexbar.ts` (development builds only; dead code in production) — remember to revert
  it before committing.
- Before any PR: `npm test` and `npx ray lint` must pass. CI runs `ray lint`, which pins its own
  Prettier version — fix formatting with `npm run fix-lint`, not a locally installed prettier.
- Repo layout, runtime quirks, and the recurring upstream-sync chore:
  [docs/maintaining.md](docs/maintaining.md).

## Scope

This extension keeps a deliberately narrow direction, set by the extension author (see `author` in
`package.json`). Bug fixes, upstream-parity updates, and new provider mappings are welcome. New
surfaces, UX departures, or features the upstream app doesn't have should be raised for discussion
first — expect them to be declined if they diverge from upstream parity.
