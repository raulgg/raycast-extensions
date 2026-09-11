# Submission audit and TODOs

Audited September 11, 2026. Runtime code is unchanged. This is a preparation checklist, not a claim that the extension is ready to publish.

## Verified

- `npm test`: 141 tests passed across 14 files.
- `npm run type-check`: passed.
- `npm run build`: distribution build passed for all eight commands.
- `npm run lint`: passed with one warning, `Set Off` is expected to be `Set off` by the title checker.
- MIT license, macOS platform declaration, lockfile, README, and initial changelog with `{PR_MERGE_DATE}` are present.
- The manifest icon is a custom 512 × 512 PNG and was visually inspected.
- CLI execution uses `execFile` with separate arguments and a 15-second timeout. Background entry points separate reads from device writes. The extension source contains no external analytics or credential handling.

Raycast and hardware flows were not exercised. Tests mock Raycast APIs and the CLI; they do not establish cross-command lifecycle behavior or device compatibility. Installed versions are `@raycast/api` 1.104.23 and `@raycast/utils` 2.2.7. Registry lookup failed because DNS was unavailable, so latest-version compliance is unverified. The Homebrew formula could not be fetched. Open-PR searches were inconclusive.

## Code improvements before submission

- [ ] **P2: Reject inherited property names in CLI mode validation.** In `src/core/airpods-control-cli.ts:18`, `value in EXTENSION_MODES` accepts `toString`, `constructor`, and `__proto__`. A malformed JSON response can therefore return a function or object as a supposedly valid listening mode, then crash presentation code. Confirmed with a Node reproduction of the lookup. Use `Object.hasOwn` or an explicit set. Add regression cases for these names alongside the existing unknown-mode test.
- [ ] **P2: Report subtitle dispatch failures.** In `src/core/airpods-status-refresh.ts:49`, `Promise.allSettled` discards both launch results. If a target command cannot launch, successful CLI reads still produce “AirPods status refreshed” while its subtitle remains stale. Preserve dispatch errors, log them for background runs, and distinguish read success from subtitle delivery failure in manual feedback. Test a rejected launch independently from a rejected CLI read.
- [ ] **P2: Honor an empty or single-mode cycle selection.** In `src/core/airpods-control.ts:149`, fewer than two selected modes causes an unrestricted CLI cycle. Unchecking modes can therefore re-enable those same modes, including Off. The existing test explicitly locks in this behavior. Prefer a preferences error before any write, with an action to open command preferences, or clearly document and deliberately retain the fallback. Test zero and one selections.
- [ ] **P2: Explain installation and compatibility requirements.** `README.md` currently only names the CLI and Homebrew command. Add Command Line Tools, the tested macOS/device scope, private-API dependence, and troubleshooting for unsupported devices and blocked Off mode. Document a tested CLI release or commit and upgrade instructions. `src/install-cli.tsx` checks only executable presence before saying every command is available; describe that as detection, or verify CLI compatibility before claiming readiness. The upstream CLI documents source compilation and a companion library, so a copied executable alone is not proof of a working installation. See the [CLI documentation](https://github.com/raulgg/airpods-control).
- [ ] **P3: Correct misleading command names and copy.** `OFF_NOT_APPLIED_HINT` in `src/core/airpods-control.ts:16` directs users to a nonexistent “Disable Noise Control” command. Use the actual command title. Resolve the manifest title warning, preferably with a clearer title such as “Turn Noise Control Off”, preserving the `set-off` command identifier. Shorten the extension description to one sentence.
- [ ] **P3: Use the default root navigation title.** Remove the root `navigationTitle` overrides in `src/install-cli.tsx:29` and `src/components/install-cli-view.tsx:60`. The setup command changes its navigation title depending on detection state.

The title and root-navigation recommendations follow the [Store preparation guide](https://developers.raycast.com/basics/prepare-an-extension-for-store).

## Additional checks worth doing

- [ ] Exercise a refresh overlapping a mode change. Refresh contexts carry snapshots without ordering information, so an older read may overwrite a newer confirmed subtitle. Reproduce this in Raycast before choosing coordination or stale-update rejection. Current unit tests do not cover this timing.
- [ ] Test installation with an invalid custom CLI Path. That preference deliberately disables automatic fallback, so a successful Homebrew installation can still leave the setup screen unable to detect the CLI. Explain how to clear or correct the preference.
- [ ] Exercise the installer UI through success, failure, retry, and leaving the view mid-install. There are no component tests. Consider moving toast creation inside the installer’s `try/finally` so a feedback failure cannot leave `isInstalling` stuck.
- [ ] Remove the unused `assets/airpods-control-terminal.png`. Consider removing `happy-dom` and its Vitest project if no component tests are planned. These are optional cleanup, not release blockers.

## Manual TODOs for Raul

- [ ] Confirm that `raulg` is your Raycast account username, not just your GitHub identity.
- [ ] Resolve the submission approach. [AirPods Noise Control](https://www.raycast.com/chrahe/airpods-noise-control) already provides listening-mode switching and Conversation Awareness through AppleScript. Explain why direct CLI control and confirmed status justify this separate extension, or discuss contributing to the existing extension. Obtain its author's sign-off if taking the significant-contribution route. The [extension guidelines](https://manual.raycast.com/extensions-guidelines) emphasize avoiding duplicate integrations.
- [ ] Make the CLI dependency reviewable. Record its tested version, source/build links, and the Homebrew formula's pinned source and checksum. Explain its private macOS interfaces and companion interpose library in the submission. Ask reviewers about acceptance if needed; this audit does not establish either approval or a prohibition.
- [ ] Try a fresh Homebrew installation, including the Command Line Tools prerequisite. Test standard Apple Silicon and Intel paths where hardware is available, a custom path, no Homebrew, and a missing CLI.
- [ ] In Raycast, test all four explicit mode commands, cycling, Conversation Awareness, and manual refresh with connected AirPods. Check displayed states against macOS/device state, not just the success HUD.
- [ ] Test disconnected AirPods, unsupported Adaptive/Conversation Awareness, Off disabled by device settings, and zero/one selected cycle modes. Verify errors are useful and copyable.
- [ ] Activate background refresh, change settings outside Raycast, and verify subtitles follow without changing device settings or opening UI. Deactivate it and verify the documented stale-subtitle behavior. Test a disabled Cycle command and the explicit-command fallback.
- [ ] Capture Store screenshots into `media/`. Suggested subjects: root search with confirmed status subtitles, CLI setup, and manual status feedback. Use consistent styling and remove personal information. Raycast recommends at least three screenshots, allows six, and specifies 2000 × 1250 PNGs in its [screenshot guidance](https://developers.raycast.com/basics/prepare-an-extension-for-store#screenshots).
- [ ] Confirm you can distribute the icon artwork and check its legibility in Raycast's light and dark themes.
- [ ] Once network access works, verify the latest Raycast API, update it and compatible utilities if needed, and commit the resulting lockfile. Run a clean `npm ci` and repeat lint, tests, type checking, and build. The current installed tree also contains extraneous `dotenv`, so a clean install is useful release evidence.
- [ ] Stop development mode, build again after final edits, and repeat the core flows using the distribution build. Record macOS version, architecture, AirPods model, firmware, and CLI version.
- [ ] Recheck open PRs for overlapping work, then submit with `npm run publish` or a manually prepared PR. Include the distinction from the existing extension, dependency provenance, screenshots, and test evidence. Keep `{PR_MERGE_DATE}` in the changelog. Publication opens an external PR, as described in the [publishing guide](https://developers.raycast.com/basics/publish-an-extension).

No branch was pushed, PR opened, package installed, or device setting changed during this audit.
