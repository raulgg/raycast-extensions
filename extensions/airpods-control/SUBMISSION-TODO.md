# Submission checklist

Prepared September 12, 2026. The audited code improvements are committed and automated validation passes. Hardware behavior and Store acceptance still require the manual checks here. See [submission notes](SUBMISSION-NOTES.md) for dependency provenance and the rationale for a separate extension.

## Completed improvements

- [x] Reject inherited property names and malformed CLI listening modes.
- [x] Preserve subtitle-launch errors and distinguish successful reads from failed subtitle refresh requests.
- [x] Reject fewer than two selected cycle modes before reading or writing the device; offer command preferences and predict cycles in the CLI's canonical order.
- [x] Handle current CLI read, unavailable, ambiguous-device, and no-op responses.
- [x] Explain Command Line Tools, custom CLI paths, compatibility, private APIs, and the complete CLI installation.
- [x] Correct command titles and macOS readback wording; use Raycast's default root navigation title.
- [x] Remove the unused terminal icon.
- [x] Upgrade Raycast API and utilities to 2.3.1 and patch vulnerable development dependencies.
- [x] Make installer failure/retry and unmount handling reliable, with component regression tests. Retain happy-dom for those tests.
- [x] Verify CLI v0.4.0 source provenance and independently match the source archive checksum to its Homebrew formula.

## Final automated validation

Verified September 12, 2026 after the installer commit `64cd32c19`:

- Clean `npm ci`: passed; lockfile unchanged; 0 reported vulnerabilities across 387 audited packages.
- `npm test`: 172 tests passed across 15 files, including 8 installer component tests.
- `npm run type-check`: passed.
- `npm run lint`: passed without warnings, including online manifest/author validation.
- `npm run build`: distribution build passed for all eight commands.
- `npm ls --depth=0`: passed with no extraneous dependencies.
- `git diff --check`: passed.

Environment: Node 22.22.2, Raycast API and utilities 2.3.1, CLI contract reference v0.4.0. The main icon is a custom 512 × 512 PNG; MIT license and initial changelog are present.

Tests mock Raycast and CLI behavior; a distribution build passing does not establish native runtime or device compatibility.

## Manual TODOs for Raul

### Submission decisions and assets

- [ ] Confirm that `raulg` is your Raycast account username.
- [ ] Decide on the submission approach. [AirPods Noise Control](https://www.raycast.com/chrahe/airpods-noise-control) already provides these controls through AppleScript. Explain why CLI control, macOS readback, and background subtitles justify a separate extension, or discuss contributing to the existing extension. Obtain author sign-off if taking the significant-contribution route. See the [extension guidelines](https://manual.raycast.com/extensions-guidelines).
- [ ] Review the dependency explanation in [submission notes](SUBMISSION-NOTES.md). Confirm reviewer acceptance of the private macOS interfaces and companion interpose library if needed. Recheck the formula before submission because it can change independently.
- [ ] Capture screenshots in `media/`: root search with status subtitles, CLI setup, and manual status feedback are useful subjects. Use consistent styling and remove personal information. Raycast recommends at least three, allows six, and specifies 2000 × 1250 PNGs in its [Store preparation guide](https://developers.raycast.com/basics/prepare-an-extension-for-store#screenshots).
- [ ] Confirm artwork distribution rights and icon legibility in light and dark themes.

### Installation and hardware checks

- [ ] Try a fresh Homebrew installation, including Command Line Tools. Cover Apple Silicon and Intel paths where available, a custom path, no Homebrew, and a missing CLI.
- [ ] Install with an invalid custom CLI Path, then clear or correct it and retry detection. Verify the setup explanation makes this override clear.
- [ ] Exercise installer success, failure, retry, repeated actions, and leaving the view during installation in Raycast. Component tests do not establish native UI lifecycle behavior.
- [ ] Test all four explicit modes, selected-mode cycling, Conversation Awareness, and manual refresh with physical AirPods. Compare displayed results with macOS and device behavior.
- [ ] Test disconnected AirPods, unsupported features, Off disabled by device settings, and zero/one selected cycle modes. Verify errors are useful and copyable.
- [ ] Activate background refresh, change settings outside Raycast, and verify subtitles follow without changing device settings or opening UI. Deactivate it and check stale-subtitle behavior. Test a disabled Cycle command and the explicit-command fallback.
- [ ] Exercise a refresh overlapping a control command. Refresh snapshots have no ordering metadata; an older read may overwrite a newer subtitle. Record whether this occurs before selecting a coordination fix. This timing risk has not been reproduced or resolved by unit tests.
- [ ] Stop development mode and exercise core flows using the final distribution build. Record macOS version, architecture, AirPods model, firmware, and CLI version.

### Submit

- [ ] Recheck open PRs for overlapping work. The September 11 title search found none, but does not cover later or differently titled submissions.
- [ ] Rerun clean install, tests, type checking, lint, and build if you change the extension after this audit.
- [ ] Submit with `npm run publish` or a manually prepared PR. Include the rationale, dependency provenance, screenshots, and hardware test evidence. Keep `{PR_MERGE_DATE}` in the changelog. See the [publishing guide](https://developers.raycast.com/basics/publish-an-extension).

No branch has been pushed or PR opened, and no AirPods setting was changed during preparation.
