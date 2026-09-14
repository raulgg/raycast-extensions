# AirPods Control

Control your AirPods from Raycast: switch listening modes (Noise Cancellation, Transparency, Adaptive, or Off) and toggle Conversation Awareness.

## Requirements

The commands require macOS, compatible AirPods connected over Bluetooth, and the [airpods-control](https://github.com/raulgg/airpods-control) helper. The helper is developed and tested upstream on macOS Tahoe 26. Support depends on your model, firmware, and macOS version; see its [compatibility matrix](https://github.com/raulgg/airpods-control/blob/v0.4.0/docs/compatibility.md).

The helper compiles locally on your Mac. Homebrew is the recommended installation method, but you can also install it from source. Install Apple's Command Line Tools first if they are missing:

```bash
xcode-select --install
```

### Homebrew (recommended)

Install [Homebrew](https://brew.sh) if needed, then install the helper:

```bash
brew install raulgg/tap/airpods-control
```

### Install without Homebrew

If you do not use Homebrew, follow the helper's [installation instructions](https://github.com/raulgg/airpods-control/blob/v0.4.0/README.md#install). **Manage AirPods Control Helper** opens those instructions and offers a source-install command when the helper is missing. For an existing source installation, use the same installation method and location when updating it. After a manual installation, return to Raycast and choose the **Refresh** action, then run an AirPods command again.

If the helper is missing, control commands check setup before offering installation:

- With Homebrew and working developer tools, accept **Install with Homebrew** in the confirmation alert. Homebrew can take several minutes; keep Raycast open to see the progress toast.
- Without Homebrew, **Manage AirPods Control Helper** opens setup instructions. Choose **Copy Homebrew Install Command**, paste it into Terminal, and run it. Follow the installer prompts, return to Raycast, and choose the **Refresh** action. Then choose **Install with Homebrew**. To install without Homebrew, choose **Copy Source Install Command** instead.
- Without working developer tools, the view explains how to install Apple's Command Line Tools. If `xcode-select` is unavailable, use the Apple download link. A full Xcode installation also works. Complete this step, return to Raycast, and choose the **Refresh** action.

After installation, run an AirPods command again. Setup never changes an AirPods setting or resumes the original action. The setup view keeps its progress, success, or error message visible until you leave or check again. Concurrent Homebrew installations are prevented across command launches.

Raycast detects the helper automatically. For another location, set the full binary path in **CLI Path**. A custom path overrides automatic detection. An invalid custom path opens recovery instructions before attempting installation.

CLI v0.4.0 is the contract reference for this extension. **Manage AirPods Control Helper** shows the installed helper version and whether it was installed with Homebrew or manually. It offers a Homebrew update when the active helper belongs to the detected formula and Homebrew reports a newer version. For a manual update, choose the **Copy Update Command** action, run both commands in Terminal, then return to Raycast and choose the **Refresh** action. When the helper is missing and prerequisites are ready, choose the **Install with Homebrew** action to install it directly.

To check or upgrade your installation in Terminal:

```bash
airpods-control --version
brew update
brew upgrade raulgg/tap/airpods-control
```

Keep the complete CLI installation, including `avbypass.dylib`; copying only the executable is insufficient. Detection confirms an executable exists, not that your device supports every command.

## Compatibility and privacy

The CLI uses private macOS audio interfaces and a companion library that adjusts an entitlement check inside its own process. It does not require Accessibility permission or elevate privileges. Apple can change these interfaces in a macOS update. Review the CLI's [security and trust model](https://github.com/raulgg/airpods-control/blob/v0.4.0/SECURITY.md) before installing.

Status and successful changes reflect macOS provider readback, not a direct acknowledgment from the AirPods. The extension runs local CLI commands and has no analytics. Homebrew downloads source during installation. The CLI has its own local cache behavior, documented in its [reference](https://github.com/raulgg/airpods-control/blob/v0.4.0/docs/cli.md#cached-allow-off-availability).

## Commands

Control commands keep Raycast open and show a confirmation toast. If Raycast is closed when the command finishes, including when launched by a keyboard shortcut with the window closed, the confirmation appears in a HUD instead.

- **Set to Noise Cancellation / Set to Transparency / Set to Adaptive / Set to Off**. Set a specific listening mode. After macOS confirms the change, the **Cycle Listening Mode** subtitle updates to that mode.
- **Cycle Listening Mode**. Cycle through modes selected in command preferences; select at least two modes. Its subtitle updates after macOS confirms the new mode.
- **Toggle Conversation Awareness**. Read the current state and flip it. Its subtitle updates after macOS confirms the new state.
- **Refresh AirPods Status**. Read both states, show the confirmed values in its combined subtitle, and update the feature subtitles immediately and, when Background Refresh is active, about once a minute. Manual refreshes keep Raycast open and show the states read from macOS. Failed subtitle refresh requests are reported.
- **Manage AirPods Control Helper**. Install, update, or recover the helper. It reports the installed version and installation method. Homebrew updates are offered when the active helper belongs to the detected formula and Homebrew reports a newer version. Source and custom installations receive manual update instructions when GitHub reports a newer release. Unlinked Homebrew installations and invalid CLI paths get specific recovery steps. Run an AirPods command again after an install or update.

## Status Refresh

The listening-mode, Conversation Awareness, and status-refresh commands always run against the real CLI. The **Refresh AirPods Status** subtitle combines the confirmed states in a compact format. Only available values are shown. After a control action finishes, the extension requests a background status refresh so the subtitles reflect the confirmed outcome without waiting for the next scheduled refresh. If the status command is disabled, this request cannot run.

Run **Refresh AirPods Status** once to activate its shared Background Refresh schedule, which also detects changes made outside the extension. Raycast schedules it approximately rather than at an exact time and lets you deactivate it from the command's Action Panel or preferences.

When the CLI reports no connected device and neither setting can be read, **Refresh AirPods Status** shows **Not connected**. A manual refresh also asks you to connect your AirPods. After reconnection, the next successful refresh restores the listening mode and Conversation Awareness readings. Wearing and case states are not shown.

If controls are unavailable, the combined subtitle falls back to **AirPods**. Transient or malformed reads preserve its last confirmed value, and partial reads show only the available setting. The individual control subtitles fall back to **AirPods** when their setting cannot be read. If a subtitle update cannot run, its previous value can remain visible. Background reads are silent and never change an AirPods setting. If you deactivate Background Refresh, the last confirmed subtitles remain visible until another refresh or control command updates them.

## Troubleshooting

- If the CLI cannot be found after installation, clear an old **CLI Path** or correct it, then run your command again.
- If no device is available, connect your AirPods and select them as the Mac's audio output. Conversation Awareness requires a compatible selected output interface.
- If several compatible devices are connected and the CLI cannot select one, disconnect the others. This extension does not expose the CLI's device selector.
- Adaptive and Conversation Awareness require model support. Enable **Set to Adaptive** in Raycast preferences if you want that command; it is disabled by default.
- Off can be unavailable because of your device's noise-control settings. Enable it in the AirPods settings if supported, or leave it out of your cycle selection. The **Set to Off** command is disabled by default.
- If commands fail after a macOS update, check the CLI compatibility matrix and upgrade the CLI. A successful installation alone does not establish hardware compatibility.

## Developer verification

See [Architecture](ARCHITECTURE.md) for the module map, command flows, dependency rules, and behavior contracts.

Run `npm test`, `npm run type-check`, `npm run lint`, `npm run build`, and `npm run test:coverage` to verify CLI envelope and state validation, bounded process diagnostics, subtitle freshness ordering, setup lifecycle transitions, real temporary-helper transport cases, and fixed listening-mode entrypoint dispatch. Coverage includes runtime TypeScript and TSX while excluding tests, types, configuration, and mocks.

The transport tests use real child processes and temporary files, but do not invoke AirPods commands or validate Homebrew, private macOS APIs, installed helper runtime behavior, or hardware.
