// Pure parsing and comparison logic for scripts/check-upstream.mjs, kept side-effect
// free so scripts/check-upstream.test.mjs can exercise it against fixture strings.
//
// Both sides are parsed with regexes over stable formatting (registry.ts is
// prettier-formatted; upstream descriptors follow one ProviderMetadata literal per
// file). Every parser throws or surfaces a problem when the shape drifts, so a format
// change breaks the check loudly instead of quietly narrowing what it verifies.

// ---------------------------------------------------------------------------
// Extension registry (src/providers/registry.ts)
// ---------------------------------------------------------------------------

export function parseRegistryEntries(registrySource) {
  const definitionsStart = registrySource.indexOf("const PROVIDER_DEFINITIONS = {");
  const definitionsEnd = registrySource.indexOf("} satisfies Record<string, ProviderDefinition>;");
  if (definitionsStart === -1 || definitionsEnd === -1) {
    throw new Error("Could not locate PROVIDER_DEFINITIONS in registry.ts — did the format change?");
  }

  const body = registrySource.slice(definitionsStart, definitionsEnd);
  const entries = new Map();
  // Entries are two-space-indented `id: {` blocks closed by a two-space-indented `},`.
  for (const match of body.matchAll(/^ {2}(\w+): \{\n([\s\S]*?)^ {2}\},$/gm)) {
    const [, id, block] = match;
    const labelsMatch = block.match(
      /usageSectionLabels: \{ primary: "([^"]*)"(?:, secondary: "([^"]*)")?(?:, tertiary: "([^"]*)")? \}/,
    );
    if (!labelsMatch) {
      throw new Error(`registry.ts entry "${id}" has no parseable usageSectionLabels.`);
    }

    const field = (name) => block.match(new RegExp(`(?<![\\w])${name}:\\s*"([^"]*)"`))?.[1];
    entries.set(id, {
      name: field("name"),
      // Raw icon expression (`providerIcon("codex", Icon.Terminal)` or `Icon.Circle`);
      // consumed by sync-provider-icons.mjs, not compared against upstream.
      icon: block.match(/(?<![\w])icon: ([^\n]+),\n/)?.[1],
      brandColor: field("brandColor"),
      dashboardUrl: field("dashboardUrl"),
      subscriptionDashboardUrl: field("subscriptionDashboardUrl"),
      statusPageUrl: field("statusPageUrl"),
      labels: { primary: labelsMatch[1], secondary: labelsMatch[2], tertiary: labelsMatch[3] },
    });
  }

  // Guard against a quietly narrowed parse: every `id: {` opener in the definitions
  // block must have produced an entry, or some block no longer matches the shape.
  const openers = body.match(/^ {2}\w+: \{$/gm)?.length ?? 0;
  if (entries.size === 0 || entries.size !== openers) {
    throw new Error(`Parsed ${entries.size} of ${openers} provider entries from registry.ts — did the format change?`);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Upstream descriptors (Sources/CodexBarCore/Providers/**/…ProviderDescriptor.swift)
// ---------------------------------------------------------------------------

// ProviderColor components are written as `16 / 255`, `0.06`, `1.0`, or `0`,
// possibly split across lines. Convert to the registry's #RRGGBB form.
export function providerColorToHex(red, green, blue) {
  const channel = (expression) => {
    const match = expression.trim().match(/^(\d+(?:\.\d+)?)(?:\s*\/\s*255)?$/);
    if (!match) {
      throw new Error(`Unrecognized ProviderColor component: "${expression}"`);
    }
    const value = expression.includes("/") ? Number(match[1]) : Number(match[1]) * 255;
    return Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(red)}${channel(green)}${channel(blue)}`.toUpperCase();
}

export function parseDescriptorMetadata(swiftSource, fileName = "descriptor") {
  const metadataCount = swiftSource.split("ProviderMetadata(").length - 1;
  if (metadataCount !== 1) {
    throw new Error(`${fileName} contains ${metadataCount} ProviderMetadata literals; expected exactly 1.`);
  }

  const id = swiftSource.match(/ProviderMetadata\(\s*id:\s*\.(\w+)/)?.[1];
  if (!id) {
    throw new Error(`${fileName} has no parseable ProviderMetadata id.`);
  }

  const string = (name) => swiftSource.match(new RegExp(`(?<![\\w])${name}:\\s*"([^"]*)"`))?.[1];
  // URL fields are sometimes Swift expressions (e.g. `ZaiAPIRegion.global.dashboardURL
  // .absoluteString`) that a regex cannot resolve. Surface them as "expr:<code>" so the
  // comparison demands an explicit ALLOWED_DIVERGENCES entry recording the manually
  // verified value — which goes stale (and fails) if the upstream expression changes.
  const stringOrExpression = (name) => {
    const raw = swiftSource.match(new RegExp(`(?<![\\w])${name}:\\s*([^\\n,]+)`))?.[1]?.trim();
    if (raw === undefined) {
      return undefined;
    }
    const literal = raw.match(/^"([^"]*)"/);
    if (literal) {
      return literal[1];
    }
    // Values at the end of the init call carry closing parens, e.g. `statusLinkURL: nil)`.
    const expression = raw.replace(/\)+$/, "").trim();
    return expression === "nil" || expression === "" ? undefined : `expr:${expression}`;
  };
  const colorMatch = swiftSource.match(/ProviderColor\(\s*red:\s*([^,]+),\s*green:\s*([^,]+),\s*blue:\s*([^)]+)\)/);

  return {
    id,
    displayName: string("displayName"),
    sessionLabel: string("sessionLabel"),
    weeklyLabel: string("weeklyLabel"),
    opusLabel: string("opusLabel"),
    dashboardURL: stringOrExpression("dashboardURL"),
    subscriptionDashboardURL: stringOrExpression("subscriptionDashboardURL"),
    statusPageURL: stringOrExpression("statusPageURL"),
    statusLinkURL: stringOrExpression("statusLinkURL"),
    brandColorHex: colorMatch ? providerColorToHex(colorMatch[1], colorMatch[2], colorMatch[3]) : undefined,
    // Descriptors that define a contextual label helper participate in dynamic
    // relabelling even before any renderer references them.
    definesDynamicPrimaryLabel: /static func primaryLabel\(/.test(swiftSource),
  };
}

// ---------------------------------------------------------------------------
// Dynamic label overrides (renderer call sites)
// ---------------------------------------------------------------------------

// Overrides show up in two shapes across the GUI/widget/CLI renderers:
//   - `XxxProviderDescriptor.primaryLabel(...)` calls (grok, doubao)
//   - `provider == .xxx` conditionals inside rateWindowLabels-style helpers
//     (factory tertiary, cursor legacy requests)
//
// Known blind spots of this heuristic (accepted — a Swift parser is not worth it):
// a `provider == .x` conditional in a function other than rateWindowLabels stays
// invisible while the file's other call sites keep the scan green, and a `" func "`
// token inside the rateWindowLabels body (comment, nested closure) truncates the
// scanned region early. Deleted/renamed files fail loudly via read errors.
export function parseDynamicOverrideProviders(rendererSources) {
  const providers = new Set();
  for (const { path: filePath, content } of rendererSources) {
    for (const match of content.matchAll(/(\w+)ProviderDescriptor\.primaryLabel\(/g)) {
      providers.add(match[1].toLowerCase());
    }

    const labelsStart = content.indexOf("func rateWindowLabels(");
    if (labelsStart !== -1) {
      const nextFunc = content.indexOf(" func ", labelsStart + "func rateWindowLabels(".length);
      const body = content.slice(labelsStart, nextFunc === -1 ? undefined : nextFunc);
      for (const match of body.matchAll(/provider == \.(\w+)/g)) {
        providers.add(match[1]);
      }
    } else if (!/ProviderDescriptor\.primaryLabel\(/.test(content)) {
      throw new Error(`${filePath} has neither rateWindowLabels nor primaryLabel call sites — did upstream move them?`);
    }
  }
  return providers;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

// Upstream expresses "no value" as nil or ""; the registry omits the property.
const same = (registryValue, upstreamValue) => (registryValue ?? "") === (upstreamValue ?? "");

function fieldRules(upstream) {
  return [
    ["name", upstream.displayName],
    ["labels.primary", upstream.sessionLabel],
    ["labels.secondary", upstream.weeklyLabel],
    ["labels.tertiary", upstream.opusLabel],
    ["dashboardUrl", upstream.dashboardURL],
    ["subscriptionDashboardUrl", upstream.subscriptionDashboardURL],
    // The extension only ever opens this URL in a browser, so upstream's
    // browser-only statusLinkURL is the correct fallback for it.
    ["statusPageUrl", upstream.statusPageURL ?? upstream.statusLinkURL],
    ["brandColor", upstream.brandColorHex, (a, b) => (a ?? "").toUpperCase() === (b ?? "").toUpperCase()],
  ];
}

function registryFieldValue(entry, field) {
  return field.startsWith("labels.") ? entry.labels[field.slice("labels.".length)] : entry[field];
}

// allowedDivergences: { providerId: { field: { ours, upstream, reason } } }.
// An entry only suppresses the exact recorded pair; when either side moves (including
// into agreement) the entry is reported as stale so it gets re-reviewed and removed.
export function compareProviders(registryEntries, upstreamById, allowedDivergences = {}) {
  const problems = [];
  const usedAllowances = new Set();

  for (const [id, entry] of registryEntries) {
    const upstream = upstreamById.get(id);
    if (!upstream) {
      problems.push(`${id}: present in registry.ts but has no upstream descriptor (renamed or removed upstream?)`);
      continue;
    }

    for (const [field, upstreamValue, equals = same] of fieldRules(upstream)) {
      const registryValue = registryFieldValue(entry, field);
      const allowance = allowedDivergences[id]?.[field];
      if (allowance) {
        usedAllowances.add(`${id}.${field}`);
        if (same(registryValue, allowance.ours) && same(upstreamValue, allowance.upstream)) {
          continue;
        }
        problems.push(
          `${id}: stale ALLOWED_DIVERGENCES entry for ${field} — recorded ours="${allowance.ours}" upstream="${allowance.upstream}", ` +
            `actual ours="${registryValue}" upstream="${upstreamValue}". Re-review and update or delete it.`,
        );
        continue;
      }
      if (!equals(registryValue, upstreamValue)) {
        problems.push(`${id}: ${field} "${registryValue}" != upstream "${upstreamValue}"`);
      }
    }
  }

  for (const id of upstreamById.keys()) {
    if (!registryEntries.has(id)) {
      problems.push(`${id}: upstream provider missing from registry.ts`);
    }
  }

  for (const [id, fields] of Object.entries(allowedDivergences)) {
    for (const field of Object.keys(fields)) {
      if (!usedAllowances.has(`${id}.${field}`)) {
        problems.push(`${id}: ALLOWED_DIVERGENCES entry for ${field} matched no comparison — delete it.`);
      }
    }
  }

  return problems;
}
