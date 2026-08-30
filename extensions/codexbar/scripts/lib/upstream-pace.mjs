// Swift `pace:` parsing and comparison against PACE_CAPABILITIES. String-in /
// object-out so tests can feed fixture descriptors.

import { extractBalancedCall } from "./upstream-metadata.mjs";

export const MONTHLY_WINDOW_SENTINEL_MINUTES = 30 * 24 * 60;

const GUI_PACE_FIELDS = ["resetWindowPace", "inferredMonthlyDuration", "sessionPaceWindowRule"];

export const DEFAULT_PACE_CAPABILITY = {
  resetWindowPace: { type: "unsupported" },
  inferredMonthlyDuration: { type: "unsupported" },
  sessionPaceWindowRule: { type: "unsupported" },
};

const CALENDAR_MONTH_RESET_WINDOW = {
  resetWindowPace: { type: "windowDuration", minutes: MONTHLY_WINDOW_SENTINEL_MINUTES },
  inferredMonthlyDuration: { type: "windowDuration", minutes: MONTHLY_WINDOW_SENTINEL_MINUTES },
  sessionPaceWindowRule: { type: "unsupported" },
};

export function fingerprintSource(value) {
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

function extractSwiftFuncBody(source, name) {
  const match = source.match(
    new RegExp(`(?:^|\\n)[ \\t]*(?:(?:public|private|internal|fileprivate)\\s+)*(?:static\\s+)?func\\s+${name}\\b[^{]*\\{`),
  );
  if (!match) {
    return undefined;
  }

  const brace = match.index + match[0].length - 1;
  return extractBalanced(source, brace, "{", "}");
}

export function expandCustomFingerprint(source, fingerprint) {
  let expanded = fingerprint;
  const callOnly = expanded.match(/^[\w\s,]*\bin\s+Self\.(\w+)(?:\([^)]*\))?\s*$/);
  if (callOnly) {
    const body = extractSwiftFuncBody(source, callOnly[1]);
    if (body !== undefined) {
      expanded = fingerprintSource(body);
    }
  }

  const constants = parseDescriptorConstants(source);
  expanded = expanded.replace(/\bSelf\.(\w+)\b/g, (match, name) =>
    constants[name] !== undefined ? String(constants[name]) : match,
  );
  expanded = expanded.replaceAll(
    "ProviderPaceCapability.monthlyWindowSentinelMinutes",
    String(MONTHLY_WINDOW_SENTINEL_MINUTES),
  );
  return fingerprintSource(expanded);
}

function parseWindowOrDurationRule(raw, constants, fileName, source) {
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
    return { type: "custom", fingerprint: expandCustomFingerprint(source, fingerprintSource(body)) };
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

function parseCapabilityLiteral(inner, constants, fileName, source) {
  const capability = { ...DEFAULT_PACE_CAPABILITY };
  for (const field of splitTopLevelFields(inner)) {
    const separator = field.indexOf(":");
    if (separator === -1) {
      throw new Error(`${fileName} has a pace field without a name: "${field.slice(0, 80)}"`);
    }
    const name = field.slice(0, separator).trim();
    const value = field.slice(separator + 1).trim();
    if (name === "resetWindowPace" || name === "sessionPaceWindowRule") {
      capability[name] = parseWindowOrDurationRule(value, constants, fileName, source);
    } else if (name === "inferredMonthlyDuration") {
      capability.inferredMonthlyDuration = parseWindowOrDurationRule(value, constants, fileName, source);
    } else if (name === "primary" || name === "secondary" || name === "tertiary") {
      parseLane(value, constants, fileName);
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
  const descriptorInner = extractBalancedCall(source, "ProviderDescriptor", fileName);
  if (descriptorInner === undefined) {
    return { ...DEFAULT_PACE_CAPABILITY };
  }

  const match = descriptorInner.match(/(?:^|\n)[ \t]*pace:\s*/);
  if (!match) {
    return { ...DEFAULT_PACE_CAPABILITY };
  }

  const rest = descriptorInner.slice(match.index + match[0].length).trimStart();
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
    return parseCapabilityLiteral(inner, constants, fileName, source);
  }

  throw new Error(`${fileName} has an unparseable pace: value "${fingerprintSource(rest).slice(0, 160)}"`);
}

function guiField(capability, field) {
  return capability?.[field] ?? DEFAULT_PACE_CAPABILITY[field];
}

export function resolveUpstreamCustomRules(capability, providerId, customRules) {
  const resolved = { ...capability };
  for (const field of GUI_PACE_FIELDS) {
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
        `${providerId}: stale CUSTOM_PACE_RULES fingerprint for ${field}. ` +
          `recorded "${expected.fingerprint}" actual "${rule.fingerprint}". Re-review the Swift body.`,
      );
    }
    resolved[field] = { type: "custom", id: expected.id };
  }
  return resolved;
}

function formatRule(rule) {
  return JSON.stringify(rule ?? DEFAULT_PACE_CAPABILITY.resetWindowPace);
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
    for (const field of GUI_PACE_FIELDS) {
      if (upstream.pace[field]?.type === "custom") {
        usedCustom.add(`${id}.${field}`);
      }
    }

    const oursCapability = ours.get(id) ?? DEFAULT_PACE_CAPABILITY;
    for (const field of GUI_PACE_FIELDS) {
      const oursRule = guiField(oursCapability, field);
      const upstreamRule = guiField(resolved, field);
      if (JSON.stringify(oursRule) !== JSON.stringify(upstreamRule)) {
        problems.push(`${id}: ${field} ${formatRule(oursRule)} != upstream ${formatRule(upstreamRule)}`);
      }
    }
  }

  for (const id of ours.keys()) {
    if (!upstreamById.has(id)) {
      problems.push(`${id}: present in paceCapabilities.ts but has no upstream descriptor.`);
    }
  }

  for (const key of Object.keys(customRules)) {
    if (!usedCustom.has(key)) {
      problems.push(`${key}: CUSTOM_PACE_RULES entry matched no upstream custom. Delete it.`);
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

function sliceSwiftFunc(content, signature) {
  const start = content.indexOf(signature);
  if (start === -1) {
    return undefined;
  }
  const brace = content.indexOf("{", start);
  if (brace === -1) {
    return undefined;
  }
  let depth = 0;
  for (let index = brace; index < content.length; index += 1) {
    if (content[index] === "{") {
      depth += 1;
    } else if (content[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(start, index + 1);
      }
    }
  }
  return content.slice(start);
}

export function parseSecondarySessionPaceProviders(rendererSources) {
  const providers = new Set();
  for (const { content } of rendererSources) {
    const body = sliceSwiftFunc(content, "func secondaryMetric(");
    if (!body) {
      continue;
    }
    for (const match of body.matchAll(/sessionPaceDetail\(/g)) {
      const window = body.slice(Math.max(0, match.index - 200), match.index);
      for (const idMatch of window.matchAll(/provider == \.(\w+)/g)) {
        providers.add(idMatch[1]);
      }
    }
  }
  return providers;
}

export function parseExtraRateWindowPaceProviders(rendererSources) {
  const providers = new Set();
  let found = false;
  for (const { content } of rendererSources) {
    const body = sliceSwiftFunc(content, "func extraRateWindowPaceDetail(");
    if (!body) {
      continue;
    }
    found = true;
    for (const match of body.matchAll(/provider == \.(\w+)/g)) {
      providers.add(match[1]);
    }
  }
  if (!found) {
    throw new Error("extraRateWindowPaceDetail not found in pace renderer files. Did upstream move it?");
  }
  return providers;
}
