#!/usr/bin/env node

// Checks src/providers/registry.ts against the upstream CodexBar provider descriptors
// so the Raycast extension shows the same provider names, usage-bar labels, dashboard
// and status URLs, and brand colors as the CodexBar GUI. Also verifies that every
// dynamic label override in the upstream renderers is either ported to normalize.ts
// or documented as unportable.
//
// Usage:
//   npm run upstream:check                      # compare against the latest release tag
//   CODEXBAR_REF=main npm run upstream:check    # compare against a branch/tag/sha
//   CODEXBAR_DIR=~/code/CodexBar npm run ...    # compare against a local checkout
//
// Exits 1 on any undocumented divergence, missing provider, stale allowlist entry, or
// unported dynamic override.

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createUpstreamSource, readFilesWithConcurrency } from "./lib/upstream.mjs";
import {
  compareProviders,
  parseDescriptorMetadata,
  parseDynamicOverrideProviders,
  parseRegistryEntries,
} from "./lib/upstream-metadata.mjs";

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

async function main() {
  const registryEntries = parseRegistryEntries(await readFile(REGISTRY_PATH, "utf8"));
  const source = await createUpstreamSource();

  // `<Name>ProviderDescriptor.swift` files only — the bare ProviderDescriptor.swift is
  // the shared registry/protocol file, not a provider.
  const descriptorPaths = (await source.listFiles(DESCRIPTOR_DIR, "ProviderDescriptor.swift")).filter(
    (filePath) => !filePath.endsWith("/ProviderDescriptor.swift"),
  );
  if (descriptorPaths.length === 0) {
    throw new Error(`No provider descriptors found under ${DESCRIPTOR_DIR} in ${source.label}.`);
  }
  const [descriptorFiles, rendererFiles] = await Promise.all([
    readFilesWithConcurrency(source, descriptorPaths),
    readFilesWithConcurrency(source, RENDERER_PATHS),
  ]);

  const upstreamById = new Map();
  for (const { path: filePath, content } of descriptorFiles) {
    const metadata = parseDescriptorMetadata(content, filePath);
    upstreamById.set(metadata.id, metadata);
  }

  const problems = compareProviders(registryEntries, upstreamById, ALLOWED_DIVERGENCES);

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
      `(labels, names, URLs, colors, ${dynamicOverrides.size} dynamic overrides accounted for).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
