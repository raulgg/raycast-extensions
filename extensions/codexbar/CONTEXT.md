# CodexBar (Raycast Extension)

A Raycast extension that reports coding-agent usage quotas by shelling out to the external `codexbar` CLI, normalizing its JSON, and rendering a usage overview.

## Language

**Provider**:
A coding-agent service whose usage quota CodexBar can report on, identified by a stable `id` (e.g. `codex`, `claude`). It is the unit a user enables in their CodexBar config and the unit this extension renders one row per. A Provider is the thing you hold an account/quota against — not a model and not a vendor brand, which is why one Provider may meter several models internally.
_Avoid_: Agent, tool, vendor, service, account

**CodexBar CLI**:
The external `codexbar` executable this extension wraps; the sole source of usage data. Found on `PATH` (or known fallback paths) and invoked as `usage --provider <id>`. Can be installed standalone (Homebrew, GitHub releases) — it does not strictly require the CodexBar app.
_Avoid_: "the binary" (used bare)

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

**Pacing**:
A comparison of a reset window's actual usage against its expected usage — summarized as **on track** when close, otherwise **ahead** (consuming faster than the window's even pace) or **behind** (slower, leaving headroom). Note: this ahead/behind framing deliberately diverges from upstream's "on pace / in reserve" wording, chosen here for clarity and pending a later revisit.
_Avoid_: On pace, in reserve, burn rate (internal)

**Expected usage**:
The percentage of a window you would ideally have consumed by now if usage were spread evenly across the window — the benchmark Pacing measures against.
_Avoid_: Ideal used percent

**Run-out**:
A projection, from the current pace, of when a window's remaining usage will be exhausted — either before the window resets ("runs out in X") or not ("lasts until reset").

## Balances & Cost

**Credits**:
A spendable balance a Provider draws down over time, independent of any reset window. Replenished by purchase or plan, not by a reset clock.
_Avoid_: Tokens, points

**Cost**:
Money spent against a spending limit within a billing period. Surfaced as "Extra usage" for pay-as-you-go overage beyond an included plan. (Open: whether "Extra usage" is strictly overage or any metered dollar cost — unconfirmed.)
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
How the CodexBar CLI acquires a Provider's usage — API, browser session (web), OAuth, local file, or CLI. Upstream categorizes Providers by source; this extension requests `auto` and does not currently surface which source was used.

## Identity & Supplemental Meters

**Account identity**:
The account a Configured Provider is authenticated as, per upstream's identity snapshot: account email, optional organization, and login method. Shown in the detail header; the email can be hidden via the *Hide Personal Information* preference.

**Login method**:
Upstream's single identity field carrying both how you authenticated and your plan tier as one string (e.g. `chatgpt-plus`, `oauth`). Upstream has no separate plan field, so plan/tier is read from here.
_Avoid_: Plan, tier, subscription (upstream models no such standalone field)

**Supplemental usage**:
A Provider-specific usage meter that falls outside the Primary/Secondary/Tertiary windows (e.g. Codex's "Code review" allowance; upstream also models Cursor requests and z.ai/MiniMax/OpenRouter metrics). The extension currently surfaces only Code review.
