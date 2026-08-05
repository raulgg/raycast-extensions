# AirPods Control

Control your AirPods from Raycast: switch listening modes (Noise Cancellation, Transparency, Adaptive, or Off) and toggle Conversation Awareness.

## Requirements

The listening-mode and Conversation Awareness commands are powered by the [airpods-control](https://github.com/raulgg/airpods-control) CLI. Install it with Homebrew:

```bash
brew install raulgg/tap/airpods-control
```

If the CLI is missing, the commands open the **Install AirPods Control CLI** screen instead of running, with actions to copy the install command or run the Homebrew install directly from Raycast. The extension looks for the binary in `/opt/homebrew/bin` and `/usr/local/bin`; if you installed it somewhere else, set the full path in the **CLI Path** extension preference.

## Commands

- **Set Noise Cancellation / Set Transparency / Set Adaptive / Set Off** — set a specific listening mode. The **Cycle Listening Mode** subtitle updates optimistically, then corrects itself if your AirPods confirm a different mode.
- **Cycle Listening Mode** — cycle through the modes selected in the command preferences. Its subtitle anticipates the next mode and reconciles with the mode confirmed by your AirPods.
- **Toggle Conversation Awareness** — read the current state from the device and flip it. Its subtitle updates optimistically and reconciles with the confirmed On or Off state.
- **Refresh AirPods Status** — safely refresh both status subtitles immediately and, when Background Refresh is active, about once a minute. Manual refreshes keep Raycast open and show both confirmed states in a toast.
- **Install AirPods Control CLI** — check whether the CLI is detected, copy the install command, or install it with Homebrew directly.

## Status Refresh

The listening-mode, Conversation Awareness, and status-refresh commands always run against the real CLI. Run **Refresh AirPods Status** once to activate its shared Background Refresh schedule. Raycast schedules it approximately rather than at an exact time and lets you deactivate it from the command's Action Panel or preferences.

Dynamic status subtitles fall back to **AirPods** whenever a change or background read fails without a recognized confirmed state. Background reads are silent and never change an AirPods setting. If you deactivate Background Refresh, the last confirmed subtitles remain visible until another refresh or control command updates them.
