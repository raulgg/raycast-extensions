# Background refresh restarts a stale CodexBar serve daemon

ADR-0002 left serve shutdown out of scope: the daemon is detached, may have been started by anyone, and Raycast exposes no lifecycle hook. That stance created a real failure mode. The CodexBar app auto-updates its bundled CLI, but a serve daemon started before the update keeps running the old code indefinitely — the process observed in the field had been alive for a week across an app update. A stale daemon serves the old version's payload shapes (missing extra rate windows, older meter sets), while forced refreshes and serve outages fall back to a fresh one-shot CLI command running the new code. The result is a UI that flips between two different meter sets depending on which path answered, which reads as random inconsistency.

Decision: `ensureCodexBarServe` — still called only from the background refresh command, preserving ADR-0002's ownership boundary — checks daemon staleness on every cycle where serve reports healthy. Staleness is detected statelessly, with no version parsing (the CLI's `--version` output carries no number) and no persisted bookkeeping: the listener PID comes from `lsof` on the serve port, the process start time from `ps -o etime=`, and the binary timestamp from `stat` on the resolved CLI path (following symlinks into the app bundle). A daemon whose process started before the binary's mtime is stale: it is sent SIGTERM and a fresh daemon is spawned once the port's health check goes dark.

Guardrails:

- Only a process whose command name recognizably belongs to CodexBar is ever signalled. An unrelated listener on the port is left untouched, and the extension simply keeps using whatever the health check reports.
- Every probe failure (missing `lsof`, unparseable `ps` output, `stat` error) degrades to "not stale" — the existing daemon keeps serving.
- If the stale daemon outlives SIGTERM, no second daemon is spawned onto the port; the stale one remains authoritative until the next cycle.

Consequences:

- After an app update, serve payloads converge on the new CLI version within one background refresh interval instead of persisting until reboot.
- The check costs one `lsof`, one `ps`, and one `stat` per background cycle, and only when serve is already healthy.
- ADR-0002's "no shutdown on disable" stance stands: this restart replaces a daemon with a newer copy of itself; it never leaves the port empty on purpose.
