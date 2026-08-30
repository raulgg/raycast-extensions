# CodexBar Raycast extension

Instructions for people and coding agents working on this extension.

## What this is

A Raycast extension that shells out to the external `codexbar` CLI (steipete's
[CodexBar](https://github.com/steipete/CodexBar) project) and renders coding-agent usage quotas.
It tracks the upstream CodexBar macOS app. Matching upstream beats inventing local behavior.

## Direction. Read this first

1. **Upstream parity wins.** Wording, pacing semantics, provider metadata, and icons track the
   upstream app. [docs/upstream-parity.md](docs/upstream-parity.md) is required reading before
   touching any of those.
2. **Provider metadata is transcribed, icons are harvested.** Copy names, labels, URLs, and colors
   from the upstream descriptor into `catalog.ts`. Do not invent values. Run `npm run upstream:check`
   after editing `catalog.ts` or `paceCapabilities.ts`. Refresh icons with
   `npm run upstream:sync-icons`. Do not hand-draw files in `assets/provider-icons/`.
3. **Vocabulary is fixed.** [CONTEXT.md](CONTEXT.md) defines the domain language (Provider, reset
   window, pacing, supplemental usage) and lists terms to avoid. Use those exact terms in code,
   UI copy, and docs.
4. **Architecture decisions are recorded.** [docs/adr/](docs/adr/) holds the accepted trade-offs
   (shared config ownership, serve-daemon startup, CLI-only status, config write ownership). Don't
   reverse one silently. Propose a new ADR in your PR instead.

## Working here

- Develop with `npm run dev`. For mock data without a configured CLI, set `DEV_MOCK = true` in
  `src/mocks/codexbar.ts` (development builds only, dead code in production). Revert it before
  committing.
- Before any PR, `npm test` and `npx ray lint` must pass. CI runs `ray lint`, which pins its own
  Prettier version. Fix formatting with `npm run fix-lint`, not a locally installed prettier.
- Repo layout, runtime quirks, and the recurring upstream-sync chore:
  [docs/maintaining.md](docs/maintaining.md).

## Scope

This extension keeps a deliberately narrow direction, set by the extension author (see `author` in
`package.json`). Bug fixes, upstream-parity updates, and new provider mappings are welcome. New
screens, UX departures, or features the upstream app doesn't have should be raised for discussion
first. Expect them to be declined if they diverge from upstream parity.
