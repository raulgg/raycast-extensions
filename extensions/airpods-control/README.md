# AirPods Control

Control your AirPods from Raycast: switch listening modes (Noise Cancellation, Transparency, Adaptive, or Off) and toggle Conversation Awareness.

## Requirements

The commands require macOS, compatible AirPods connected over Bluetooth, and the [airpods-control](https://github.com/raulgg/airpods-control) CLI. The CLI is developed and tested upstream on macOS Tahoe 26. Support depends on your model, firmware, and macOS version; see its [compatibility matrix](https://github.com/raulgg/airpods-control/blob/v0.4.0/docs/compatibility.md).

Homebrew builds the CLI on your Mac, so install Apple's Command Line Tools first if they are missing:

```bash
xcode-select --install
```

Install [Homebrew](https://brew.sh) if needed, then install the CLI:

```bash
brew install raulgg/tap/airpods-control
```

If the CLI is missing, each command offers to install it through a confirmation alert. Accept **Install with Homebrew** to start, or **Cancel** to leave setup. Homebrew can take several minutes; keep Raycast open to see the progress toast. After installation, run your command again. Installation never changes an AirPods setting or resumes the original action. The extension looks in `/opt/homebrew/bin` and `/usr/local/bin`. For another location, set the full binary path in **CLI Path**. A custom path overrides automatic detection. Clear it to restore detection after a Homebrew installation.

CLI v0.4.0 is the contract reference for this extension. To check or upgrade your installation:

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

- **Set Noise Cancellation / Set Transparency / Set Adaptive / Disable Noise Control**. Set a specific listening mode. The **Cycle Listening Mode** subtitle anticipates the requested mode and reconciles with macOS readback.
- **Cycle Listening Mode**. Cycle through modes selected in command preferences; select at least two modes. Its subtitle anticipates the next mode and reconciles with macOS readback.
- **Toggle Conversation Awareness**. Read the current state and flip it. Its subtitle anticipates the new state and reconciles with macOS readback.
- **Refresh AirPods Status**. Read both states and request subtitle updates immediately and, when Background Refresh is active, about once a minute. Manual refreshes keep Raycast open and show the states read from macOS. Failed subtitle refresh requests are reported.
- **Update Airpods-Control CLI**. Install the CLI when it is missing or update it through Homebrew. If Homebrew is not installed, this command explains how to install it and provides the CLI command to copy. Run your AirPods command again after an install or update.

## Status Refresh

The listening-mode, Conversation Awareness, and status-refresh commands always run against the real CLI. Run **Refresh AirPods Status** once to activate its shared Background Refresh schedule. Raycast schedules it approximately rather than at an exact time and lets you deactivate it from the command's Action Panel or preferences.

Dynamic status subtitles fall back to **AirPods** when a change or background read fails without a recognized state and the subtitle update succeeds. If an update cannot run, the previous subtitle can remain visible. Background reads are silent and never change an AirPods setting. If you deactivate Background Refresh, the last confirmed subtitles remain visible until another refresh or control command updates them.

## Troubleshooting

- If the CLI cannot be found after installation, clear an old **CLI Path** or correct it, then run your command again.
- If no device is available, connect your AirPods and select them as the Mac's audio output. Conversation Awareness requires a compatible selected output interface.
- If several compatible devices are connected and the CLI cannot select one, disconnect the others. This extension does not expose the CLI's device selector.
- Adaptive and Conversation Awareness require model support. Enable **Set Adaptive** in Raycast preferences if you want that command; it is disabled by default.
- Off can be unavailable because of your device's noise-control settings. Enable it in the AirPods settings if supported, or leave it out of your cycle selection. The **Disable Noise Control** command is disabled by default.
- If commands fail after a macOS update, check the CLI compatibility matrix and upgrade the CLI. A successful installation alone does not establish hardware compatibility.
