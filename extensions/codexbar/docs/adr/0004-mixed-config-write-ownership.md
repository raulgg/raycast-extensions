# Provider config is written through two paths: CLI and direct file

The extension writes the CodexBar shared config (`~/.codexbar/config.json`) two ways. Enabling and disabling a provider goes through the CLI (`codexbar config enable/disable`); reordering enabled providers writes the config file directly (`moveConfiguredProviderInConfig`). This is deliberate, and both paths live in `lib/providerConfig.ts`.

Toggling goes through the CLI because that is the app-sanctioned way to flip a provider's `enabled` flag: the CLI validates the provider id, owns any side effects of enabling (e.g. registering the provider), and flips the flag in place without disturbing array order. Reordering does not go through the CLI because the CLI exposes no reorder command; per [ADR-0001](0001-shared-codexbar-config.md) the extension owns reordering by writing the config array directly. Rather than re-implement enable/disable as a direct file write (duplicating the CLI's validation and side effects) or block reordering until upstream adds a command, we accept the two paths.

Consequences:

- The two writers are serialized in the UI (a shared busy ref in `ManageProviders`, and `useMoveProvider`'s busy ref) so a CLI toggle and a direct file reorder cannot interleave and clobber each other's read-modify-write. This serialization is the extension's responsibility; neither path locks the file.
- The direct reorder write inherits ADR-0001's risk: an upstream config schema change could break it independently of the CLI toggle path.
- If upstream adds a `config reorder` (or equivalent) command, the direct file write should collapse into the CLI path and this ADR can be superseded.
