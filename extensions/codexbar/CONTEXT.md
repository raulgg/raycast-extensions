# CodexBar (Raycast Extension)

A Raycast extension that reports coding-agent usage quotas by shelling out to the external `codexbar` CLI, normalizing its JSON, and rendering a usage overview.

## Language

**Provider**:
A coding-agent service whose usage quota CodexBar can report on, identified by a stable `id` (e.g. `codex`, `claude`). It is the unit a user enables in their CodexBar config and the unit this extension renders one row per. A Provider is the thing you hold an account/quota against — not a model and not a vendor brand, which is why one Provider may meter several models internally.
_Avoid_: Agent, tool, vendor, service, account

**CodexBar CLI**:
The external `codexbar` executable this extension wraps; the sole source of usage data. Found on `PATH` (or known fallback paths) and invoked either as a one-shot usage command or through its serve mode. Can be installed standalone (Homebrew, GitHub releases) — it does not strictly require the CodexBar app.
_Avoid_: "the binary" (used bare)

**CodexBar serve daemon**:
A long-lived localhost-only process started from the CodexBar CLI's serve mode that exposes CodexBar usage payloads over HTTP. It is still part of the external CodexBar CLI, not the CodexBar app, and can outlive a single Raycast command invocation. In this extension, the scheduled Raycast background refresh may start it, while the Usage Overview foreground command only consumes it if it is already healthy.
_Avoid_: Raycast background task, app daemon

**Raycast background refresh**:
Raycast's scheduled launch of a `no-view` or `menu-bar` command at a manifest-defined interval. It is useful for prefetching and updating shared extension state, but it is not a persistent process and does not keep a command loaded between runs. CodexBar uses `refresh-usage-cache` to warm provider detail cache data and to keep the CodexBar serve daemon available when that scheduled command is enabled.
_Avoid_: Daemon, worker, service

**CodexBar app**:
steipete's macOS menu-bar app that ships and can install/configure the CLI. Upstream of this extension; not part of it.

**CodexBar**:
Used bare, refers to this Raycast extension itself.

## Usage

**Usage**:
Consumption of a Provider's quota within a reset window, expressed as a percentage. The core metered quantity, distinct from Credits and Cost below.

**Reset window**:
The time horizon a usage quota resets on — Session, Weekly, Monthly, or Daily. Each window has a remaining amount and a countdown to its reset. Upstream models these as the ordered slots Primary / Secondary / Tertiary.
_Avoid_: Limit, bucket, quota period

**Primary / Secondary / Tertiary**:
The canonical ordered slots a Provider's reset windows occupy, taken directly from the CodexBar CLI's `usage` payload. Primary is typically the Session window, Secondary the Weekly window, Tertiary an optional third (a Monthly window or a per-model window). Each slot is shown under a per-Provider **display title** (e.g. Codex's Primary reads "Session"; Cursor's reads "Total").

**Display title**:
The per-Provider human label for a usage slot (Session, Weekly, Sonnet, Total, Auto, …). The slot is the position; the display title is what the user reads.

**Usage meter**:
The visual progress bar showing how much of a reset window remains.
_Avoid_: Progress bar, gauge

**Usage adornment**:
The compact usage summary attached to a Provider row, comprising remaining-percentage text and a meter icon. It summarizes the ordered Primary and Secondary reset windows independently of the Provider detail view.
_Avoid_: Accessory, badge

**Pacing**:
A comparison of a reset window's actual usage against its expected usage — summarized as **on pace** when close, otherwise **in deficit** (consuming faster than the window's even pace) or **in reserve** (slower, leaving headroom). Wording matches upstream (revisit resolved 2026-07: parity wins; "ahead" read as good when it means bad).
_Avoid_: Ahead, behind, on track, burn rate (internal)

**Expected usage**:
The percentage of a window you would ideally have consumed by now if usage were spread evenly across the window — the benchmark Pacing measures against.
_Avoid_: Ideal used percent

**Run-out**:
A projection, from the current pace, of when a window's remaining usage will be exhausted — either before the window resets ("runs out in X") or not ("lasts until reset").

## Balances & Cost

> **Not currently surfaced.** The detail view focuses on Usage and Supplemental usage only. The terms below describe concepts the CodexBar CLI still reports but that the extension no longer renders; kept as vocabulary for a possible later revisit.

**Credits**:
A spendable balance a Provider draws down over time, independent of any reset window. Replenished by purchase or plan, not by a reset clock.
_Avoid_: Tokens, points

**Cost**:
Money spent against a spending limit within a billing period. Was surfaced as "Extra usage" for pay-as-you-go overage beyond an included plan. (Open: whether "Extra usage" is strictly overage or any metered dollar cost — unconfirmed.)
_Avoid_: Spend, charge

**Quota**:
A counted allowance of requests or tokens consumed against an included limit, distinct from dollar Cost. (Open: whether Quota is truly distinct from a non-resetting Usage window — unconfirmed.)

## Configuration

**Configured Provider**:
A Provider the user has enabled in their CodexBar config. The extension shows exactly these, in the order the config lists them; reordering in the extension rewrites that order back to the shared config file.
_Avoid_: Enabled provider, active provider

**Provider config**:
The CodexBar config file (`~/.codexbar/config.json`), owned by the CodexBar app, listing which Providers are enabled and in what order. The extension reads and reorders it but treats the app as the owner.

**Source**:
How the CodexBar CLI acquires a Provider's usage — API, browser session (web), OAuth, local file, or CLI. The extension forwards the Provider's shared-config source and requests the upstream GUI-parity fetch profile when the installed CLI supports it. (Not currently surfaced — the Source row lived in the now-removed General section.)

**Provider id alias**:
An alternate spelling the CLI accepts for a Provider id (its `cliName` or upstream aliases, e.g. `alibaba-coding-plan` → `alibaba`, `groqcloud` → `groq`). The registry resolves aliases to the canonical id (the upstream enum case name, which is what the config file and payloads use) so a config listing either spelling renders one row.

## Identity & Supplemental Meters

**Account identity**:
The account a Configured Provider is authenticated as, per upstream's identity snapshot: account email, optional organization, and login method. Only the email (and the plan tier derived from login method) is shown, in the detail header; the email can be hidden via the _Hide Personal Information_ preference. Organization and account label are no longer surfaced (they lived in the now-removed General section).

**Login method**:
Upstream's single identity field carrying both how you authenticated and your plan tier as one string (e.g. `chatgpt-plus`, `oauth`). Upstream has no separate plan field, so plan/tier is read from here.
_Avoid_: Plan, tier, subscription (upstream models no such standalone field)

**Supplemental usage**:
A Provider-specific usage meter that falls outside the Primary/Secondary/Tertiary windows. The extension surfaces: Codex's "Code review" allowance, named **extra rate windows** (upstream `extraRateWindows`, e.g. "Codex Spark"), and OpenRouter key usage (via a per-field mapper table in `normalize.ts`). Upstream also models shapes not yet mapped — `cursorRequests`, `zaiUsage`, `minimaxUsage`, `kiroUsage`, `mistralUsage`, `deepseekUsage`, `deepgramUsage`, `openAIAPIUsage`, `claudeAdminAPIUsage`, and `antigravityPlanInfo` — deferred until their live JSON can be sampled; unmapped shapes render nothing.

**General section** _(removed)_:
Formerly the detail view's info list (Last Updated, Source, CLI version, account label/organization, subscription renewal/expiry), plus the sibling Recent credit activity and Daily credit spend info sections. All removed — the detail view now renders only Usage and Supplemental usage meters. The "Updated …" time moved to the header subtitle.
