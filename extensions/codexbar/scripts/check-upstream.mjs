#!/usr/bin/env node

// Checks src/providers/registry.ts and paceCapabilities.ts against the upstream
// CodexBar provider descriptors so the Raycast extension shows the same provider
// names, usage-bar labels, dashboard and status URLs, brand colors, and pace
// gating as the CodexBar GUI. Also verifies that every dynamic label override in
// the upstream renderers is either ported to normalize.ts or documented as unportable.
//
// Usage:
//   npm run upstream:check                      # compare against the latest release tag
//   CODEXBAR_REF=main npm run upstream:check    # compare against a branch/tag/sha
//   CODEXBAR_DIR=~/code/CodexBar npm run ...    # compare against a local checkout
//
// Exits 1 on any undocumented divergence, missing provider, stale allowlist entry,
// unported dynamic override, or pace-capability mismatch.

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { CUSTOM_WINDOW_RULES, PACE_CAPABILITIES } from "../src/providers/paceCapabilities.ts";
import { createUpstreamSource, readFilesWithConcurrency } from "./lib/upstream.mjs";
import { compareProviders, parseDescriptorMetadata, parseDynamicOverrideProviders, parseRegistryEntries } from "./lib/upstream-metadata.mjs";
import {
  comparePaceCapabilities,
  fingerprintSource,
  parseDescriptorPace,
  parsePresentationPaceFlags,
  parseSecondarySessionPaceProviders,
} from "./lib/upstream-pace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(__dirname, "../src/providers/registry.ts");
const DESCRIPTOR_DIR = "Sources/CodexBarCore/Providers";
// Every upstream surface that renders usage-bar titles; a dynamic override added to
// any of them must be ported (or documented below) for the extension to stay aligned.
// Fixed list: a renamed/deleted file fails loudly on read, but a brand-new renderer
// file is invisible until someone adds it here.
const RENDERER_PATHS = [
  "Sources/CodexBar/MenuDescriptor.swift",
  "Sources/CodexBar/MenuCardView+ModelHelpers.swift",
  "Sources/CodexBar/UsageStore+WidgetSnapshot.swift",
  "Sources/CodexBarCLI/CLIRenderer.swift",
  "Sources/CodexBarCLI/DashboardSnapshotBuilder.swift",
];

// Menu card files that special-case pace outside descriptor `pace:` (Kimi secondary
// sessionPaceDetail). Kept separate from RENDERER_PATHS so a file without label
// sites does not break the dynamic-override scan.
const PACE_RENDERER_PATHS = [
  "Sources/CodexBar/MenuCardView.swift",
  "Sources/CodexBar/MenuCardView+ModelHelpers.swift",
];

// Custom Swift closures in ProviderPaceCapability, keyed provider.field.
// `fingerprint` is the expanded, whitespace-normalized Swift body (Self.foo
// wrappers inlined). `tsFingerprint` is CUSTOM_WINDOW_RULES[id].toString()
// the same way. Either going stale means re-review the predicate.
const CUSTOM_PACE_RULES = {
  "antigravity.sessionPaceWindowRule": {
    id: "antigravitySession",
    fingerprint: "window, _ in window.windowMinutes == nil || window.windowMinutes == 300",
    tsFingerprint: "(window) => window.windowMinutes === undefined || window.windowMinutes === 300",
  },
  "claude.sessionPaceWindowRule": {
    id: "claudeSessionAlways",
    fingerprint: "_, _ in true",
    tsFingerprint: "() => true",
  },
  "codex.sessionPaceWindowRule": {
    id: "codexSessionRejectsWeeklyMonthly",
    fingerprint:
      "window, _ in guard let minutes = window.windowMinutes else { return true } return minutes != 7 * 24 * 60 && minutes != 30 * 24 * 60",
    tsFingerprint:
      "(window) => { if (window.windowMinutes === undefined) { return true; } return window.windowMinutes !== 7 * 24 * 60 && window.windowMinutes !== 30 * 24 * 60; }",
  },
  "grok.resetWindowPace": {
    id: "grokWeeklyCredits",
    fingerprint:
      'window, now in guard Self.primaryLabel(window: window, now: now) == "Weekly", let resetsAt = window.resetsAt else { return false } let windowMinutes = window.windowMinutes ?? 7 * 24 * 60 let timeUntilReset = resetsAt.timeIntervalSince(now) return windowMinutes > 0 && timeUntilReset > 0 && timeUntilReset <= TimeInterval(windowMinutes) * 60',
    tsFingerprint:
      'function grokWeeklyCredits(window , now ) { if (!window.resetsAt) { return false; } if (grokPrimaryDisplayTitle(grokWindowDurationMs(window.windowMinutes, window.resetsAt, now)) !== "Weekly") { return false; } const resetAtMs = Date.parse(window.resetsAt); if (Number.isNaN(resetAtMs)) { return false; } const windowMinutes = window.windowMinutes ?? WEEKLY_PACE_DEFAULT_WINDOW_MINUTES; const timeUntilResetSeconds = (resetAtMs - now) / 1000; return windowMinutes > 0 && timeUntilResetSeconds > 0 && timeUntilResetSeconds <= windowMinutes * 60; }',
  },
  "notion.sessionPaceWindowRule": {
    id: "notionRollingSession",
    fingerprint:
      "window, _ in guard let minutes = window.windowMinutes else { return false } return minutes <= 360",
    tsFingerprint: "(window) => window.windowMinutes !== undefined && window.windowMinutes <= 6 * 60",
  },
  "zai.resetWindowPace": {
    id: "zaiMonthlyMcp",
    fingerprint: 'window.windowMinutes == 43200 && window.resetDescription == "MCP"',
    tsFingerprint:
      '(window) => window.windowMinutes === MONTHLY_WINDOW_SENTINEL_MINUTES && window.resetDescription === "MCP"',
  },
  "zai.inferredMonthlyDuration": {
    id: "zaiMonthlyMcp",
    fingerprint: 'window.windowMinutes == 43200 && window.resetDescription == "MCP"',
    tsFingerprint:
      '(window) => window.windowMinutes === MONTHLY_WINDOW_SENTINEL_MINUTES && window.resetDescription === "MCP"',
  },
};

const UNPORTABLE_PRESENTATION_PACE = {
  abacus: {
    usesAbacusPace: "billing-cycle copy on the primary bar, not UsagePace",
  },
  synthetic: {
    usesSyntheticRollingRegen: "rolling regen detail, not usage pace",
  },
};

const UNPORTABLE_HEADROOM_HINT = {
  codex: "1.5× session headroom hint, not implemented",
};

// Dynamic overrides ported to normalize.ts (resolveSlotDisplayTitle). When upstream
// adds a provider to its renderers, this check fails until the override is ported and
// listed here.
const IMPLEMENTED_DYNAMIC_OVERRIDES = new Set([
  "codex",
  "factory",
  "grok",
  "doubao",
  "crof",
  "amp",
  "alibabatokenplan",
  "sub2api",
]);

// Dynamic overrides that CANNOT be ported: the CLI JSON payload the extension consumes
// lacks the data they key on.
const UNPORTABLE_DYNAMIC_OVERRIDES = {
  // MenuCardView relabels legacy request-quota Cursor plans as "Requests" based on
  // snapshot.detailRow(label: "Request quota"), a live GUI detail the CLI JSON
  // does not expose as a usage-bar field.
  cursor: "keyed on snapshot.detailRow(label: \"Request quota\"), which the CLI JSON does not expose as a usage-bar field",
};

// Known intentional differences from upstream, keyed provider → field. Entries record
// the exact value pair they excuse; when either side moves, the checker flags the entry
// as stale so it gets re-reviewed instead of rotting. "expr:" upstream values are Swift
// expressions the parser cannot resolve — `ours` records the manually resolved constant.
const ALLOWED_DIVERGENCES = {
  alibaba: {
    dashboardUrl: {
      ours: "https://modelstudio.console.alibabacloud.com/ap-southeast-1/?tab=coding-plan#/efm/coding_plan",
      upstream: "expr:AlibabaCodingPlanAPIRegion.international.dashboardURL.absoluteString",
      reason: "upstream computes the URL per region; ours is the resolved .international constant",
    },
  },
  alibabatokenplan: {
    dashboardUrl: {
      ours: "https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/token-plan",
      upstream: "expr:AlibabaTokenPlanUsageFetcher.dashboardURL.absoluteString",
      reason: "upstream computes the URL; ours is the resolved constant from AlibabaTokenPlanUsageFetcher",
    },
  },
  zai: {
    dashboardUrl: {
      ours: "https://z.ai/manage-apikey/coding-plan/personal/my-plan",
      upstream: "expr:ZaiAPIRegion.global.dashboardURL.absoluteString",
      reason: "upstream computes the URL per region; ours is the resolved .global constant",
    },
  },
  qoder: {
    dashboardUrl: {
      ours: "https://qoder.com/account/usage",
      upstream: "expr:QoderWebSite.international.dashboardURL.absoluteString",
      reason: "upstream computes the URL per site; ours is the resolved .international constant",
    },
  },
  qwencloud: {
    dashboardUrl: {
      ours: "https://home.qwencloud.com/billing/subscription/token-plan-individual",
      upstream: "expr:QwenCloudUsageFetcher.dashboardURL.absoluteString",
      reason: "upstream computes the URL from QWEN_CLOUD_HOST; ours is the empty-env default",
    },
  },
  wayfinder: {
    dashboardUrl: {
      ours: "http://127.0.0.1:8088/router",
      upstream: "expr:WayfinderSettingsReader.dashboardURL(environment: [:]).absoluteString",
      reason: "upstream builds dashboard from WAYFINDER_GATEWAY_URL; ours is the empty-env default (http://127.0.0.1:8088/router)",
    },
  },
};

function tsFingerprintFor(id) {
  const fn = CUSTOM_WINDOW_RULES[id];
  if (typeof fn !== "function") {
    throw new Error(`CUSTOM_WINDOW_RULES is missing ${id}`);
  }
  return fingerprintSource(fn.toString());
}

async function main() {
  const registryEntries = parseRegistryEntries(await readFile(REGISTRY_PATH, "utf8"));
  const paceEntries = new Map(Object.entries(PACE_CAPABILITIES));
  const source = await createUpstreamSource();

  // `<Name>ProviderDescriptor.swift` files only — the bare ProviderDescriptor.swift is
  // the shared registry/protocol file, not a provider.
  const descriptorPaths = (await source.listFiles(DESCRIPTOR_DIR, "ProviderDescriptor.swift")).filter(
    (filePath) => !filePath.endsWith("/ProviderDescriptor.swift"),
  );
  if (descriptorPaths.length === 0) {
    throw new Error(`No provider descriptors found under ${DESCRIPTOR_DIR} in ${source.label}.`);
  }
  const [descriptorFiles, rendererFiles, paceRendererFiles] = await Promise.all([
    readFilesWithConcurrency(source, descriptorPaths),
    readFilesWithConcurrency(source, RENDERER_PATHS),
    readFilesWithConcurrency(source, PACE_RENDERER_PATHS),
  ]);

  const upstreamById = new Map();
  const presentationFlagsById = new Map();
  for (const { path: filePath, content } of descriptorFiles) {
    const metadata = parseDescriptorMetadata(content, filePath);
    metadata.pace = parseDescriptorPace(content, filePath);
    upstreamById.set(metadata.id, metadata);
    presentationFlagsById.set(metadata.id, parsePresentationPaceFlags(content));
  }

  const problems = compareProviders(registryEntries, upstreamById, ALLOWED_DIVERGENCES);
  const paceComparison = comparePaceCapabilities(paceEntries, upstreamById, CUSTOM_PACE_RULES);
  problems.push(...paceComparison.problems);

  const dynamicOverrides = parseDynamicOverrideProviders(rendererFiles);
  for (const metadata of upstreamById.values()) {
    if (metadata.definesDynamicPrimaryLabel) {
      dynamicOverrides.add(metadata.id);
    }
  }
  for (const providerId of dynamicOverrides) {
    if (IMPLEMENTED_DYNAMIC_OVERRIDES.has(providerId) || providerId in UNPORTABLE_DYNAMIC_OVERRIDES) {
      continue;
    }
    problems.push(
      `${providerId}: upstream renderers apply a dynamic label override the extension does not implement ` +
        `(port it in normalize.ts resolveSlotDisplayTitle, then add it to IMPLEMENTED_DYNAMIC_OVERRIDES)`,
    );
  }
  for (const providerId of [...IMPLEMENTED_DYNAMIC_OVERRIDES, ...Object.keys(UNPORTABLE_DYNAMIC_OVERRIDES)]) {
    if (!dynamicOverrides.has(providerId)) {
      problems.push(
        `${providerId}: listed as a dynamic override but upstream renderers no longer apply one — ` +
          `remove it from the override lists (and normalize.ts if implemented).`,
      );
    }
  }

  for (const [key, rule] of Object.entries(CUSTOM_PACE_RULES)) {
    const actual = tsFingerprintFor(rule.id);
    if (actual !== rule.tsFingerprint) {
      problems.push(
        `${key}: stale tsFingerprint for ${rule.id} — recorded "${rule.tsFingerprint}" actual "${actual}". Re-review CUSTOM_WINDOW_RULES.`,
      );
    }
  }

  const rendererSessionProviders = parseSecondarySessionPaceProviders(paceRendererFiles);
  for (const id of rendererSessionProviders) {
    if (paceEntries.get(id)?.secondarySessionPace !== true) {
      problems.push(
        `${id}: MenuCardView session-paces the secondary window but paceCapabilities.ts is missing secondarySessionPace: true`,
      );
    }
  }
  for (const [id, capability] of paceEntries) {
    if (capability.secondarySessionPace && !rendererSessionProviders.has(id)) {
      problems.push(
        `${id}: paceCapabilities.ts sets secondarySessionPace but MenuCardView no longer session-paces that slot`,
      );
    }
  }

  const usedHeadroom = new Set();
  for (const [id, metadata] of upstreamById) {
    if (!metadata.pace.showsHeadroomHint) {
      continue;
    }
    if (!UNPORTABLE_HEADROOM_HINT[id]) {
      problems.push(`${id}: descriptor sets showsHeadroomHint. Port it or add UNPORTABLE_HEADROOM_HINT.`);
      continue;
    }
    usedHeadroom.add(id);
  }
  for (const id of Object.keys(UNPORTABLE_HEADROOM_HINT)) {
    if (!usedHeadroom.has(id)) {
      problems.push(`${id}: stale UNPORTABLE_HEADROOM_HINT — delete it.`);
    }
  }

  const usedPresentation = new Set();
  for (const [id, flags] of presentationFlagsById) {
    const allowance = UNPORTABLE_PRESENTATION_PACE[id] ?? {};
    for (const flag of ["usesAbacusPace", "usesSyntheticRollingRegen"]) {
      if (!flags[flag]) {
        continue;
      }
      if (!allowance[flag]) {
        problems.push(
          `${id}: descriptor sets ${flag} (presentation-only pace). Port it or add UNPORTABLE_PRESENTATION_PACE.`,
        );
        continue;
      }
      usedPresentation.add(`${id}.${flag}`);
    }
  }
  for (const [id, flags] of Object.entries(UNPORTABLE_PRESENTATION_PACE)) {
    for (const flag of Object.keys(flags)) {
      if (!usedPresentation.has(`${id}.${flag}`)) {
        problems.push(`${id}: stale UNPORTABLE_PRESENTATION_PACE entry for ${flag} — delete it.`);
      }
    }
  }

  if (problems.length > 0) {
    console.error(`Registry out of sync with ${source.label}:\n`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Registry in sync: ${registryEntries.size} providers match ${source.label} ` +
      `(labels, names, URLs, colors, ${dynamicOverrides.size} dynamic overrides, ` +
        `${paceEntries.size} pace capabilities accounted for).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
