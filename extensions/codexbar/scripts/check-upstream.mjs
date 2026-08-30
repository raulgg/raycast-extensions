#!/usr/bin/env node

// Checks catalog.ts and paceCapabilities.ts against the upstream CodexBar provider
// descriptors so the Raycast extension shows the same provider names, usage-bar
// labels, dashboard and status URLs, brand colors, and pace gating as the CodexBar
// GUI. Also verifies that every dynamic label override in the upstream renderers is
// either ported to DYNAMIC_SLOT_TITLES or documented as unportable.
//
// Usage:
//   npm run upstream:check                      # compare against codexbar-upstream.lock
//   npm run upstream:bump                       # check latest release, then pin lockfile
//   CODEXBAR_REF=main npm run upstream:check    # compare against a branch/tag/sha
//   CODEXBAR_DIR=~/code/CodexBar npm run ...    # compare against a local checkout
//
// Exits 1 on any undocumented divergence, missing provider, stale allowlist entry,
// unported dynamic override, or pace-capability mismatch.

import process from "node:process";
import { PROVIDER_CATALOG } from "../src/providers/catalog.ts";
import {
  DYNAMIC_SLOT_TITLES,
  EXTRA_WINDOW_PACE_PROVIDER_IDS,
  PACE_CAPABILITIES,
  UNPORTABLE_DYNAMIC_TITLES,
} from "../src/providers/paceCapabilities.ts";
import { createUpstreamSource, isMainModule, readFilesWithConcurrency } from "./lib/upstream.mjs";
import { compareProviders, parseDescriptorMetadata, parseDynamicOverrideProviders } from "./lib/upstream-metadata.mjs";
import {
  comparePaceCapabilities,
  parseDescriptorPace,
  parseExtraRateWindowPaceProviders,
  parsePresentationPaceFlags,
  parseSecondarySessionPaceProviders,
} from "./lib/upstream-pace.mjs";

const DESCRIPTOR_DIR = "Sources/CodexBarCore/Providers";
// Renderer files that set usage-bar titles. A dynamic override in any of them must be
// ported or listed as unportable. Fixed list: a renamed or deleted file fails on read,
// but a brand-new renderer is invisible until someone adds it here.
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

// Custom Swift closures, keyed provider.field. fingerprint is the expanded Swift body.
const CUSTOM_PACE_RULES = {
  "antigravity.sessionPaceWindowRule": {
    id: "antigravitySession",
    fingerprint: "window, _ in window.windowMinutes == nil || window.windowMinutes == 300",
  },
  "claude.sessionPaceWindowRule": {
    id: "claudeSessionAlways",
    fingerprint: "_, _ in true",
  },
  "codex.sessionPaceWindowRule": {
    id: "codexSessionRejectsWeeklyMonthly",
    fingerprint:
      "window, _ in guard let minutes = window.windowMinutes else { return true } return minutes != 7 * 24 * 60 && minutes != 30 * 24 * 60",
  },
  "grok.resetWindowPace": {
    id: "grokWeeklyCredits",
    fingerprint:
      'window, now in guard Self.primaryLabel(window: window, now: now) == "Weekly", let resetsAt = window.resetsAt else { return false } let windowMinutes = window.windowMinutes ?? 7 * 24 * 60 let timeUntilReset = resetsAt.timeIntervalSince(now) return windowMinutes > 0 && timeUntilReset > 0 && timeUntilReset <= TimeInterval(windowMinutes) * 60',
  },
  "notion.sessionPaceWindowRule": {
    id: "notionRollingSession",
    fingerprint:
      "window, _ in guard let minutes = window.windowMinutes else { return false } return minutes <= 360",
  },
  "zai.resetWindowPace": {
    id: "zaiMonthlyMcp",
    fingerprint: 'window.windowMinutes == 43200 && window.resetDescription == "MCP"',
  },
  "zai.inferredMonthlyDuration": {
    id: "zaiMonthlyMcp",
    fingerprint: 'window.windowMinutes == 43200 && window.resetDescription == "MCP"',
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

// Known intentional differences from upstream, keyed provider then field. Entries record
// the exact value pair they excuse. When either side moves, the checker flags the entry
// as stale so it gets re-reviewed instead of rotting. "expr:" upstream values are Swift
// expressions the parser cannot resolve. `ours` is the manually resolved constant.
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

export const DEFAULT_POLICY = {
  catalog: PROVIDER_CATALOG,
  paceCapabilities: PACE_CAPABILITIES,
  extraWindowIds: EXTRA_WINDOW_PACE_PROVIDER_IDS,
  implementedTitles: new Set(Object.keys(DYNAMIC_SLOT_TITLES)),
  unportableTitles: UNPORTABLE_DYNAMIC_TITLES,
  customPaceRules: CUSTOM_PACE_RULES,
  allowedDivergences: ALLOWED_DIVERGENCES,
  unportableHeadroom: UNPORTABLE_HEADROOM_HINT,
  unportablePresentation: UNPORTABLE_PRESENTATION_PACE,
  rendererPaths: RENDERER_PATHS,
  paceRendererPaths: PACE_RENDERER_PATHS,
};

export async function checkUpstream(source, policy = DEFAULT_POLICY) {
  const {
    catalog,
    paceCapabilities,
    extraWindowIds,
    implementedTitles,
    unportableTitles,
    customPaceRules,
    allowedDivergences,
    unportableHeadroom,
    unportablePresentation,
    rendererPaths,
    paceRendererPaths,
  } = policy;

  const paceEntries = new Map(Object.entries(paceCapabilities));

  // `<Name>ProviderDescriptor.swift` files only. The bare ProviderDescriptor.swift is
  // the shared registry/protocol file, not a provider.
  const descriptorPaths = (await source.listFiles(DESCRIPTOR_DIR, "ProviderDescriptor.swift")).filter(
    (filePath) => !filePath.endsWith("/ProviderDescriptor.swift"),
  );
  if (descriptorPaths.length === 0) {
    throw new Error(`No provider descriptors found under ${DESCRIPTOR_DIR} in ${source.label}.`);
  }
  const [descriptorFiles, rendererFiles, paceRendererFiles] = await Promise.all([
    readFilesWithConcurrency(source, descriptorPaths),
    readFilesWithConcurrency(source, rendererPaths),
    readFilesWithConcurrency(source, paceRendererPaths),
  ]);

  const upstreamById = new Map();
  const presentationFlagsById = new Map();
  for (const { path: filePath, content } of descriptorFiles) {
    const metadata = parseDescriptorMetadata(content, filePath);
    metadata.pace = parseDescriptorPace(content, filePath);
    upstreamById.set(metadata.id, metadata);
    presentationFlagsById.set(metadata.id, parsePresentationPaceFlags(content));
  }

  const problems = compareProviders(catalog, upstreamById, allowedDivergences);
  const paceComparison = comparePaceCapabilities(paceEntries, upstreamById, customPaceRules);
  problems.push(...paceComparison.problems);

  const dynamicOverrides = parseDynamicOverrideProviders(rendererFiles);
  for (const metadata of upstreamById.values()) {
    if (metadata.definesDynamicPrimaryLabel) {
      dynamicOverrides.add(metadata.id);
    }
  }
  for (const providerId of dynamicOverrides) {
    if (implementedTitles.has(providerId) || Object.hasOwn(unportableTitles, providerId)) {
      continue;
    }
    problems.push(
      `${providerId}: upstream renderers apply a dynamic label override the extension does not implement ` +
        `(port it in paceCapabilities.ts DYNAMIC_SLOT_TITLES)`,
    );
  }
  for (const providerId of [...implementedTitles, ...Object.keys(unportableTitles)]) {
    if (!dynamicOverrides.has(providerId)) {
      problems.push(
        `${providerId}: listed as a dynamic override but upstream renderers no longer apply one. ` +
          `remove it from DYNAMIC_SLOT_TITLES / UNPORTABLE_DYNAMIC_TITLES.`,
      );
    }
  }

  const extraWindowProviders = parseExtraRateWindowPaceProviders(paceRendererFiles);
  for (const id of extraWindowProviders) {
    if (!extraWindowIds.has(id)) {
      problems.push(
        `${id}: MenuCardView paces extra rate windows but EXTRA_WINDOW_PACE_PROVIDER_IDS does not include it`,
      );
    }
  }
  for (const id of extraWindowIds) {
    if (!extraWindowProviders.has(id)) {
      problems.push(
        `${id}: EXTRA_WINDOW_PACE_PROVIDER_IDS lists extra-window pace but MenuCardView extraRateWindowPaceDetail no longer names it`,
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
    if (!unportableHeadroom[id]) {
      problems.push(`${id}: descriptor sets showsHeadroomHint. Port it or add UNPORTABLE_HEADROOM_HINT.`);
      continue;
    }
    usedHeadroom.add(id);
  }
  for (const id of Object.keys(unportableHeadroom)) {
    if (!usedHeadroom.has(id)) {
      problems.push(`${id}: stale UNPORTABLE_HEADROOM_HINT. Delete it.`);
    }
  }

  const usedPresentation = new Set();
  for (const [id, flags] of presentationFlagsById) {
    const allowance = unportablePresentation[id] ?? {};
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
  for (const [id, flags] of Object.entries(unportablePresentation)) {
    for (const flag of Object.keys(flags)) {
      if (!usedPresentation.has(`${id}.${flag}`)) {
        problems.push(`${id}: stale UNPORTABLE_PRESENTATION_PACE entry for ${flag}. Delete it.`);
      }
    }
  }

  return {
    problems,
    label: source.label,
    catalogCount: Object.keys(catalog).length,
    overrideCount: dynamicOverrides.size,
    paceCount: paceEntries.size,
  };
}

async function main() {
  const source = await createUpstreamSource();
  const result = await checkUpstream(source);
  if (result.problems.length > 0) {
    console.error(`Catalog out of sync with ${result.label}:\n`);
    for (const problem of result.problems) {
      console.error(`  - ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Catalog in sync: ${result.catalogCount} providers match ${result.label} ` +
      `(labels, names, URLs, colors, ${result.overrideCount} dynamic overrides, ` +
      `${result.paceCount} pace capabilities accounted for).`,
  );
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
