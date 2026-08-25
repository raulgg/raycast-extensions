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

function extractBalancedCall(source, callee, fileName) {
  const match = source.match(new RegExp(`(?<![\\w])${callee}\\(`));
  if (!match) {
    return undefined;
  }

  const open = match.index + match[0].length - 1;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }

  throw new Error(`${fileName} has an unbalanced ${callee}( literal.`);
}

function parseBrandColor(brandingSource, fileName) {
  const colorBody = brandingSource.match(/color:\s*ProviderColor\(([\s\S]*?)\)/)?.[1]?.trim();
  if (!colorBody) {
    throw new Error(`${fileName} has no parseable branding color.`);
  }

  const hexMatch = colorBody.match(/^hex:\s*0x([0-9A-Fa-f]{6})$/);
  if (hexMatch) {
    return `#${hexMatch[1].toUpperCase()}`;
  }

  const rgbMatch = colorBody.match(/red:\s*([^,]+),\s*green:\s*([^,]+),\s*blue:\s*([^)]+)/);
  if (!rgbMatch) {
    throw new Error(`${fileName} has an unrecognized ProviderColor: "${colorBody}"`);
  }

  return providerColorToHex(rgbMatch[1], rgbMatch[2], rgbMatch[3]);
}

export function parseDescriptorMetadata(swiftSource, fileName = "descriptor") {
  const metadataCount = swiftSource.split("ProviderMetadata(").length - 1;
  if (metadataCount !== 1) {
    throw new Error(`${fileName} contains ${metadataCount} ProviderMetadata literals; expected exactly 1.`);
  }

  const metadata = extractBalancedCall(swiftSource, "ProviderMetadata", fileName);
  if (!metadata) {
    throw new Error(`${fileName} has no extractable ProviderMetadata literal.`);
  }

  const id = metadata.match(/^\s*id:\s*\.(\w+)/)?.[1];
  if (!id) {
    throw new Error(`${fileName} has no parseable ProviderMetadata id.`);
  }

  const string = (name) => metadata.match(new RegExp(`(?<![\\w])${name}:\\s*"([^"]*)"`))?.[1];
  // URL fields are sometimes Swift expressions (e.g. `ZaiAPIRegion.global.dashboardURL
  // .absoluteString`) that a regex cannot resolve. Surface them as "expr:<code>" so the
  // comparison demands an explicit ALLOWED_DIVERGENCES entry recording the manually
  // verified value — which goes stale (and fails) if the upstream expression changes.
  const stringOrExpression = (name) => {
    const raw = metadata.match(new RegExp(`(?<![\\w])${name}:\\s*([^\\n,]+)`))?.[1]?.trim();
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

  const branding = extractBalancedCall(swiftSource, "ProviderBranding", fileName);
  if (!branding) {
    throw new Error(`${fileName} has no parseable ProviderBranding literal.`);
  }

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
    brandColorHex: parseBrandColor(branding, fileName),
    // Descriptors that define a contextual label helper participate in dynamic
    // relabelling even before any renderer references them.
    definesDynamicPrimaryLabel: /static func primaryLabel\(/.test(swiftSource),
  };
}

// ---------------------------------------------------------------------------
// Dynamic label overrides (renderer call sites)
// ---------------------------------------------------------------------------

// Overrides show up in three shapes across the GUI/widget/CLI renderers:
//   - `XxxProviderDescriptor.primaryLabel(...)` / `.displayLabel(...)` calls
//   - `provider == .xxx` conditionals inside rateWindowLabels-style helpers
//     (factory tertiary, cursor legacy requests)
//   - `descriptor.presentation.rateWindowLabels(...)` — CLI renderers that
//     delegate to each descriptor's presentation labeler (v0.53+)
//
// Known blind spots of this heuristic (accepted — a Swift parser is not worth it):
// a `provider == .x` conditional in a function other than rateWindowLabels stays
// invisible while the file's other call sites keep the scan green, and a `" func "`
// token inside the rateWindowLabels body (comment, nested closure) truncates the
// scanned region early. Deleted/renamed files fail loudly via read errors.
export function parseDynamicOverrideProviders(rendererSources) {
  const providers = new Set();
  for (const { path: filePath, content } of rendererSources) {
    for (const match of content.matchAll(/(\w+)ProviderDescriptor\.(?:primaryLabel|displayLabel)\(/g)) {
      providers.add(match[1].toLowerCase());
    }

    const labelsStart = content.indexOf("func rateWindowLabels(");
    if (labelsStart !== -1) {
      const nextFunc = content.indexOf(" func ", labelsStart + "func rateWindowLabels(".length);
      const body = content.slice(labelsStart, nextFunc === -1 ? undefined : nextFunc);
      for (const match of body.matchAll(/provider == \.(\w+)/g)) {
        providers.add(match[1]);
      }
    } else if (
      !/ProviderDescriptor\.(?:primaryLabel|displayLabel)\(/.test(content) &&
      !/presentation\.rateWindowLabels\(/.test(content)
    ) {
      throw new Error(
        `${filePath} has neither rateWindowLabels, primaryLabel/displayLabel, nor presentation.rateWindowLabels call sites — did upstream move them?`,
      );
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

// ---------------------------------------------------------------------------
// Pace capabilities (descriptor `pace:` vs src/providers/paceCapabilities.ts)
// ---------------------------------------------------------------------------

export const MONTHLY_WINDOW_SENTINEL_MINUTES = 30 * 24 * 60;

const DEFAULT_PACE_CAPABILITY = {
  resetWindowPace: { type: "unsupported" },
  inferredMonthlyDuration: { type: "unsupported" },
  sessionPaceWindowRule: { type: "unsupported" },
};

const CALENDAR_MONTH_RESET_WINDOW = {
  resetWindowPace: { type: "windowDuration", minutes: MONTHLY_WINDOW_SENTINEL_MINUTES },
  inferredMonthlyDuration: { type: "windowDuration", minutes: MONTHLY_WINDOW_SENTINEL_MINUTES },
  sessionPaceWindowRule: { type: "unsupported" },
};

function fingerprintSource(value) {
  return value.replace(/\s+/g, " ").trim();
}

function extractBalanced(source, openIndex, openChar, closeChar) {
  if (source[openIndex] !== openChar) {
    return undefined;
  }

  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === openChar) {
      depth += 1;
    } else if (character === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex + 1, index);
      }
    }
  }

  return undefined;
}

function splitTopLevelFields(body) {
  const fields = [];
  let start = 0;
  let paren = 0;
  let brace = 0;
  for (let index = 0; index <= body.length; index += 1) {
    const character = index < body.length ? body[index] : ",";
    if (character === "(") {
      paren += 1;
    } else if (character === ")") {
      paren -= 1;
    } else if (character === "{") {
      brace += 1;
    } else if (character === "}") {
      brace -= 1;
    } else if (character === "," && paren === 0 && brace === 0) {
      const piece = body.slice(start, index).trim();
      if (piece) {
        fields.push(piece);
      }
      start = index + 1;
    }
  }
  return fields;
}

export function parseMinutesExpression(expression, constants = {}) {
  const trimmed = expression.replace(/\s+/g, " ").trim();
  if (constants[trimmed] !== undefined) {
    return constants[trimmed];
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (/^\d+(?: \* \d+)+$/.test(trimmed)) {
    return trimmed.split(" * ").map(Number).reduce((left, right) => left * right, 1);
  }

  if (trimmed === "ProviderPaceCapability.monthlyWindowSentinelMinutes") {
    return MONTHLY_WINDOW_SENTINEL_MINUTES;
  }

  const selfRef = trimmed.match(/^(?:Self|self)\.(\w+)$/);
  if (selfRef && constants[selfRef[1]] !== undefined) {
    return constants[selfRef[1]];
  }

  throw new Error(`Cannot resolve minutes expression "${expression}".`);
}

export function parseDescriptorConstants(source) {
  const constants = {};
  for (const match of source.matchAll(/(?:public\s+)?static\s+let\s+(\w+)\s*=\s*([^\n]+)/g)) {
    const [, name, raw] = match;
    const expression = raw.replace(/\/\/.*$/, "").trim();
    try {
      constants[name] = parseMinutesExpression(expression, constants);
    } catch {
      // Non-numeric lets (URLs, strings) are ignored.
    }
  }
  return constants;
}

function parseWindowOrDurationRule(raw, constants, fileName) {
  const value = raw.trim();
  if (value.startsWith(".unsupported")) {
    return { type: "unsupported" };
  }
  if (value.startsWith(".resetDatePresent")) {
    return { type: "resetDatePresent" };
  }
  if (value.startsWith(".windowDurationPresent")) {
    return { type: "windowDurationPresent" };
  }
  if (value.startsWith(".windowDurationMissing")) {
    return { type: "windowDurationMissing" };
  }
  if (value.startsWith(".windowDuration(")) {
    const inner = extractBalanced(value, value.indexOf("("), "(", ")");
    if (!inner) {
      throw new Error(`${fileName} has an unbalanced windowDuration( in pace:.`);
    }
    const minutesMatch = inner.match(/minutes:\s*([^,]+)/);
    if (!minutesMatch) {
      throw new Error(`${fileName} windowDuration is missing minutes:.`);
    }
    return { type: "windowDuration", minutes: parseMinutesExpression(minutesMatch[1], constants) };
  }
  if (value.startsWith(".custom")) {
    const braceIndex = value.indexOf("{");
    const body = extractBalanced(value, braceIndex, "{", "}");
    if (body === undefined) {
      throw new Error(`${fileName} has an unbalanced .custom { } in pace:.`);
    }
    return { type: "custom", fingerprint: fingerprintSource(body) };
  }

  throw new Error(`${fileName} has an unparseable pace rule: "${fingerprintSource(value).slice(0, 160)}"`);
}

function parseLane(raw, constants, fileName) {
  const value = raw.trim();
  if (value.startsWith(".weeklyWithDuration")) {
    return { kind: "weeklyWithDuration" };
  }
  if (value.startsWith(".weekly")) {
    return { kind: "weekly" };
  }
  if (value.startsWith(".session(")) {
    const inner = extractBalanced(value, value.indexOf("("), "(", ")");
    if (!inner) {
      throw new Error(`${fileName} has an unbalanced .session( in pace:.`);
    }
    const maximumMinutes = parseMinutesExpression(inner.match(/maximumMinutes:\s*([^,]+)/)?.[1] ?? "", constants);
    const lane = { kind: "session", maximumMinutes };
    if (/requiresDuration:\s*true/.test(inner)) {
      lane.requiresDuration = true;
    }
    return lane;
  }
  if (value.startsWith(".exact(")) {
    const inner = extractBalanced(value, value.indexOf("("), "(", ")");
    if (!inner) {
      throw new Error(`${fileName} has an unbalanced .exact( in pace:.`);
    }
    const paceKind = inner.match(/kind:\s*\.(session|weekly)/)?.[1];
    const minutes = parseMinutesExpression(inner.match(/minutes:\s*([^,]+)/)?.[1] ?? "", constants);
    if (!paceKind) {
      throw new Error(`${fileName} .exact lane is missing kind:.`);
    }
    return { kind: "exact", paceKind, minutes };
  }

  throw new Error(`${fileName} has an unparseable pace lane: "${fingerprintSource(value).slice(0, 160)}"`);
}

function parseCapabilityLiteral(inner, constants, fileName) {
  const capability = { ...DEFAULT_PACE_CAPABILITY };
  for (const field of splitTopLevelFields(inner)) {
    const separator = field.indexOf(":");
    if (separator === -1) {
      throw new Error(`${fileName} has a pace field without a name: "${field.slice(0, 80)}"`);
    }
    const name = field.slice(0, separator).trim();
    const value = field.slice(separator + 1).trim();
    if (name === "resetWindowPace" || name === "sessionPaceWindowRule") {
      capability[name] = parseWindowOrDurationRule(value, constants, fileName);
    } else if (name === "inferredMonthlyDuration") {
      capability.inferredMonthlyDuration = parseWindowOrDurationRule(value, constants, fileName);
    } else if (name === "primary" || name === "secondary" || name === "tertiary") {
      capability[name] = parseLane(value, constants, fileName);
    } else if (name === "showsHeadroomHint") {
      capability.showsHeadroomHint = value.startsWith("true");
    } else {
      throw new Error(`${fileName} has an unknown ProviderPaceCapability field "${name}".`);
    }
  }
  return capability;
}

export function parseDescriptorPace(source, fileName = "descriptor") {
  const constants = parseDescriptorConstants(source);
  const match = source.match(/(?:^|\n)[ \t]*pace:\s*/);
  if (!match) {
    return { ...DEFAULT_PACE_CAPABILITY };
  }

  const rest = source.slice(match.index + match[0].length).trimStart();
  if (rest.startsWith(".calendarMonthResetWindow")) {
    return { ...CALENDAR_MONTH_RESET_WINDOW };
  }
  if (rest.startsWith(".unsupported")) {
    return { ...DEFAULT_PACE_CAPABILITY };
  }
  if (rest.startsWith("ProviderPaceCapability(")) {
    const inner = extractBalanced(rest, rest.indexOf("("), "(", ")");
    if (inner === undefined) {
      throw new Error(`${fileName} has an unbalanced ProviderPaceCapability( in pace:.`);
    }
    return parseCapabilityLiteral(inner, constants, fileName);
  }

  throw new Error(`${fileName} has an unparseable pace: value "${fingerprintSource(rest).slice(0, 160)}"`);
}

function parseTsMinutes(raw) {
  const trimmed = raw.trim();
  if (trimmed === "MONTHLY_WINDOW_SENTINEL_MINUTES") {
    return MONTHLY_WINDOW_SENTINEL_MINUTES;
  }
  return Number(trimmed.replaceAll("_", ""));
}

function parseTsRule(raw) {
  const type = raw.match(/type:\s*"([^"]+)"/)?.[1];
  if (!type) {
    throw new Error(`paceCapabilities.ts rule is missing type: ${raw.slice(0, 80)}`);
  }
  if (type === "custom") {
    const id = raw.match(/id:\s*"([^"]+)"/)?.[1];
    if (!id) {
      throw new Error(`paceCapabilities.ts custom rule is missing id: ${raw.slice(0, 80)}`);
    }
    return { type, id };
  }
  if (type === "windowDuration") {
    const minutesRaw = raw.match(/minutes:\s*([^,}]+)/)?.[1];
    return { type, minutes: parseTsMinutes(minutesRaw ?? "") };
  }
  return { type };
}

function parseTsLane(raw) {
  const kind = raw.match(/kind:\s*"([^"]+)"/)?.[1];
  if (kind === "session") {
    const lane = { kind, maximumMinutes: parseTsMinutes(raw.match(/maximumMinutes:\s*([^,}]+)/)?.[1] ?? "") };
    if (/requiresDuration:\s*true/.test(raw)) {
      lane.requiresDuration = true;
    }
    return lane;
  }
  if (kind === "exact") {
    return {
      kind,
      paceKind: raw.match(/paceKind:\s*"([^"]+)"/)?.[1],
      minutes: parseTsMinutes(raw.match(/minutes:\s*([^,}]+)/)?.[1] ?? ""),
    };
  }
  return { kind };
}

export function parsePaceCapabilitiesTable(source) {
  const start = source.indexOf("export const PACE_CAPABILITIES");
  if (start === -1) {
    throw new Error("Could not locate PACE_CAPABILITIES in paceCapabilities.ts — did the format change?");
  }

  const brace = source.indexOf("{", start);
  const inner = extractBalanced(source, brace, "{", "}");
  if (inner === undefined) {
    throw new Error("PACE_CAPABILITIES has unbalanced braces — did the format change?");
  }

  const body = inner;
  const entries = new Map();
  for (const match of body.matchAll(/^ {2}(\w+): \{\n([\s\S]*?)^ {2}\},$/gm)) {
    const [, id, block] = match;
    const capability = { ...DEFAULT_PACE_CAPABILITY };
    const field = (name) => {
      const fieldMatch = block.match(new RegExp(`${name}:\\s*(\\{[\\s\\S]*?\\}|true|false),`, "m"));
      return fieldMatch?.[1];
    };

    for (const ruleName of ["resetWindowPace", "inferredMonthlyDuration", "sessionPaceWindowRule"]) {
      const raw = field(ruleName);
      if (raw?.startsWith("{")) {
        capability[ruleName] = parseTsRule(raw);
      }
    }
    for (const laneName of ["primary", "secondary", "tertiary"]) {
      const raw = field(laneName);
      if (raw?.startsWith("{")) {
        capability[laneName] = parseTsLane(raw);
      }
    }
    if (field("secondarySessionPace")?.trim() === "true") {
      capability.secondarySessionPace = true;
    }
    if (field("showsHeadroomHint")?.trim() === "true") {
      capability.showsHeadroomHint = true;
    }
    entries.set(id, capability);
  }

  const openers = body.match(/^ {2}\w+: \{$/gm)?.length ?? 0;
  if (entries.size === 0 || entries.size !== openers) {
    throw new Error(
      `Parsed ${entries.size} of ${openers} PACE_CAPABILITIES entries — did the format change?`,
    );
  }
  return entries;
}

function capabilityKey(capability) {
  const canonical = {
    resetWindowPace: capability.resetWindowPace,
    inferredMonthlyDuration: capability.inferredMonthlyDuration,
    sessionPaceWindowRule: capability.sessionPaceWindowRule,
  };
  for (const lane of ["primary", "secondary", "tertiary"]) {
    if (capability[lane]) {
      canonical[lane] = capability[lane];
    }
  }
  if (capability.showsHeadroomHint) {
    canonical.showsHeadroomHint = true;
  }
  return JSON.stringify(canonical);
}

export function resolveUpstreamCustomRules(capability, providerId, customRules) {
  const resolved = { ...capability };
  for (const field of ["resetWindowPace", "inferredMonthlyDuration", "sessionPaceWindowRule"]) {
    const rule = resolved[field];
    if (rule?.type !== "custom") {
      continue;
    }
    const expected = customRules[`${providerId}.${field}`];
    if (!expected) {
      throw new Error(
        `${providerId}: upstream ${field} is a custom closure the extension does not implement ` +
          `(fingerprint "${rule.fingerprint}"). Port it or add CUSTOM_PACE_RULES.`,
      );
    }
    if (expected.fingerprint !== rule.fingerprint) {
      throw new Error(
        `${providerId}: stale CUSTOM_PACE_RULES fingerprint for ${field} — ` +
          `recorded "${expected.fingerprint}" actual "${rule.fingerprint}". Re-review the Swift body.`,
      );
    }
    resolved[field] = { type: "custom", id: expected.id };
  }
  return resolved;
}

export function comparePaceCapabilities(ours, upstreamById, customRules) {
  const problems = [];
  const usedCustom = new Set();

  for (const [id, upstream] of upstreamById) {
    let resolved;
    try {
      resolved = resolveUpstreamCustomRules(upstream.pace, id, customRules);
    } catch (error) {
      problems.push(error.message);
      continue;
    }
    for (const field of ["resetWindowPace", "inferredMonthlyDuration", "sessionPaceWindowRule"]) {
      if (upstream.pace[field]?.type === "custom") {
        usedCustom.add(`${id}.${field}`);
      }
    }

    const oursCapability = ours.get(id) ?? { ...DEFAULT_PACE_CAPABILITY };
    const comparableOurs = { ...oursCapability };
    delete comparableOurs.secondarySessionPace;
    if (capabilityKey(comparableOurs) !== capabilityKey(resolved)) {
      problems.push(
        `${id}: pace capability diverges from upstream (update paceCapabilities.ts to match the descriptor, or fix the parser).`,
      );
    }
  }

  for (const id of ours.keys()) {
    if (!upstreamById.has(id)) {
      problems.push(`${id}: present in paceCapabilities.ts but has no upstream descriptor.`);
    }
  }

  for (const key of Object.keys(customRules)) {
    if (!usedCustom.has(key)) {
      problems.push(`${key}: CUSTOM_PACE_RULES entry matched no upstream custom — delete it.`);
    }
  }

  return { problems };
}

export function parsePresentationPaceFlags(source) {
  return {
    usesAbacusPace: /usesAbacusPace:\s*true/.test(source),
    usesSyntheticRollingRegen: /usesSyntheticRollingRegen:\s*true/.test(source),
  };
}

export function parseKimiSecondarySessionPace(rendererSources) {
  return rendererSources.some(({ content }) => /provider == \.kimi/.test(content) && /sessionPaceDetail\(/.test(content));
}
