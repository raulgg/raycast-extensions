# Disabling Keychain access is a strict extension-wide policy

The CodexBar CLI owns authentication and usage acquisition for every Provider. Some of those paths
can read or write macOS Keychain, while others can work from manual credentials, Provider app
sessions, local files, OAuth state, or APIs without Keychain access. CodexBar exposes the process
environment variable `CODEXBAR_DISABLE_KEYCHAIN_ACCESS=1`, but the extension can also consume an
already-running CodexBar serve daemon whose launch environment it cannot inspect or prove.

Decision: the extension's **Disable Keychain Access** preference is a strict, Provider-agnostic
runtime policy. When enabled, every CodexBar child process launched by the extension receives
`CODEXBAR_DISABLE_KEYCHAIN_ACCESS=1`, including availability and capability probes, Provider usage
and status fetches, config commands, and background work. The policy applies equally to every
Configured Provider; it is not a Cursor-specific source or authentication mode.

The extension must never send strict-policy requests to a CodexBar serve daemon whose launch policy
it cannot verify. A healthy daemon might have been launched by the CodexBar app, another client, or
an earlier extension process without the environment variable, and the current health response does
not attest to its Keychain policy.

The Raycast background refresh owns daemon policy reconciliation. Whenever it starts a daemon, it
records the listener PID, binary path, process-start identity, and Keychain access policy. On later
runs it compares that record, the live listener, and the current preference. If a recognizable
CodexBar listener is unknown or uses the wrong policy, background refresh may stop and replace it,
including a daemon started by another client. A replacement for the disabled policy is launched
with `CODEXBAR_DISABLE_KEYCHAIN_ACCESS=1`; a replacement for the default policy is launched without
the variable. This deliberately broadens the accepted shared-process intervention in ADR-0006 from
binary staleness to policy mismatch.

Reconciliation is graceful-only. The extension sends `SIGTERM` and waits for the listener to stop,
but never escalates to `SIGKILL`. A listener that refuses to stop is left running for its possible
external owner, marked unusable for the current policy, and retried on a later background run;
Provider work uses guarded one-shot commands in the meantime.

Foreground Usage Overview still never starts or stops serve. It may use serve only when the live
listener matches the recorded daemon identity and current policy. Between a preference change and
the next background reconciliation—or whenever no matching daemon exists—foreground and background
Provider work falls back to one-shot CLI processes under the current policy. This closes the timing
gap without making a view command manage persistent processes.

Provider account data is isolated by policy. Provider detail snapshots, supplemental-section
memory, and consecutive-failure state fetched with Keychain access allowed must never satisfy reads
made with Keychain access disabled, or vice versa. Each cache key therefore includes the effective
Keychain access policy. Switching policy starts with a cold Provider-data namespace rather than
deleting the other namespace. Provider incident status remains shared because it is public,
account-independent data; strict-mode status refreshes still run through a one-shot process with
Keychain access disabled.

Isolation does not make inactive entries immortal. Foreground Usage Overview and background refresh
prune both policy namespaces whenever they run: Provider detail snapshots are physically removed
after the existing one-hour stale window, and supplemental-section memory after its existing
24-hour lifetime. Because Raycast commands are not continuously resident, deletion occurs on the
first extension run after expiry, not at an exact wall-clock deadline. Failure counters contain no
account data and continue to reset on a successful fetch in their policy namespace.

The extension does not version-gate this policy. The environment switch predates the currently
tested CodexBar releases, and a conservative version floor would reject older versions that can
honor it without giving the extension stronger proof about future versions. If an older CLI behaves
incorrectly or lacks a usable Keychain-free path, troubleshooting guidance asks the user to update
CodexBar for current support. A future advertised CLI capability may improve diagnostics, but is not
a prerequisite for the preference.

The Raycast preference is the policy's sole input. When it is enabled, the extension explicitly sets
`CODEXBAR_DISABLE_KEYCHAIN_ACCESS=1` for CodexBar children. When it is disabled, the extension removes
that key from the child environment instead of modeling an inherited process-level override. This
keeps runtime routing and cache scope aligned with the visible preference; external environment
configuration for Raycast is out of scope.

Provider fetch failures under the disabled policy preserve the CLI's original error and append:
“Keychain access is disabled. This Provider may require another authentication source. Configure
it in the CodexBar app or allow Keychain access and retry.” The hint is contextual, not a diagnosis:
network failures, Provider incidents, and unrelated CLI errors remain possible. It deliberately
contains no CodexBar upgrade instruction. Authentication setup remains out of scope for the
extension.

A failure after a successful disabled-policy fetch retains only that policy's last-good Provider
detail under the existing cache rules: it may render as stale for up to one hour, with the existing
failure threshold controlling when the error appears. It never falls back to a default-policy
snapshot. This preserves useful data through transient failures without weakening isolation.

The policy is exposed as an extension-wide **Disable Keychain Access** checkbox under Advanced,
off by default. Its description is: “Prevent CodexBar processes launched by this extension from
reading or writing macOS Keychain. Some Providers may become unavailable; configure another
authentication source in the CodexBar app.” Daemon reconciliation remains an implementation detail
and is not mentioned in preference copy.

The per-Provider **Copy CLI Command** action mirrors the active policy. Under the disabled policy it
copies `CODEXBAR_DISABLE_KEYCHAIN_ACCESS=1 codexbar usage --provider <provider>`; under the default
policy it keeps the existing command. A copied command executes outside the extension's guarantee,
but should not surprise a strict-mode user with an unguarded diagnostic fetch.

Consequences:

- The preference guarantees the behavior of work initiated by this extension, not that other apps
  or already-running CodexBar processes will avoid Keychain.
- Providers without a Keychain-free authentication path can become unavailable and must fail
  honestly; the extension does not implement Provider authentication or cookie extraction itself.
- Refreshes can be temporarily slower while the daemon is absent or awaiting background policy
  reconciliation; a matching daemon preserves the normal warm serve path.
- Toggling the preference initially shows no Provider account data from the previous policy while a
  fetch under the newly selected policy runs. Switching back can reuse still-fresh data from that
  policy's namespace.
- Inactive account-derived cache data is retained only through its normal logical lifetime and is
  deleted on the next extension run after expiry.
- A background refresh can terminate and replace a CodexBar serve daemon owned by the app, user, or
  another client when its policy cannot be verified. This disruption is accepted in exchange for
  preserving both the strict guarantee and warm serve performance on the shared port.
- ADR-0002 still governs process ownership: only background refresh starts or stops serve;
  foreground remains a consumer or uses one-shot fallback.
- Disabling Raycast's scheduled background refresh does not disable the Keychain access policy.
  Usage Overview remains fully functional through one-shot commands, but no process runs to
  reconcile or warm a policy-matching daemon until background refresh is enabled again.
