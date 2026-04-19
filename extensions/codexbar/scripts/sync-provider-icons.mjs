#!/usr/bin/env node

import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { optimize } from "svgo";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(ROOT, "src/providers/registry.ts");
const ASSETS_DIR = path.join(ROOT, "assets/provider-icons");
const CODEXBAR_REF = process.env.CODEXBAR_REF || "main";
const CONCURRENCY = 6;
const CHECK_ONLY = process.argv.includes("--check");

const REGISTRY_BLOCK_REGEX =
  /(\w+):\s*{[\s\S]*?\n\s*icon:\s*([^\n,]+(?:\([^)\n]*\))?)[\s\S]*?\n\s*},?/g;
const PROVIDER_ICON_REGEX = /^providerIcon\("([^"]+)"/;

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function normalizeSvgRootDimensions(svg) {
  return svg.replace(/<svg\b([^>]*)>/, (_match, attrs) => {
    const withoutWidth = attrs.replace(/\swidth="[^"]*"/, "");
    const withoutHeight = withoutWidth.replace(/\sheight="[^"]*"/, "");
    return `<svg${withoutHeight} width="100" height="100">`;
  });
}

function parseRegistryEntries(source) {
  const slugs = [];
  const skippedProviders = [];

  for (const match of source.matchAll(REGISTRY_BLOCK_REGEX)) {
    const providerId = match[1];
    const iconExpression = match[2].trim();
    const iconMatch = iconExpression.match(PROVIDER_ICON_REGEX);

    if (iconMatch) {
      slugs.push({ providerId, slug: iconMatch[1] });
      continue;
    }

    skippedProviders.push({ providerId, iconExpression });
  }

  return { slugs, skippedProviders };
}

async function readLocalIcon(slug) {
  const filePath = path.join(ASSETS_DIR, `${slug}.svg`);

  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function fetchUpstreamIcon(slug) {
  const url = `https://raw.githubusercontent.com/steipete/CodexBar/${CODEXBAR_REF}/Sources/CodexBar/Resources/ProviderIcon-${slug}.svg`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${slug} from ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function optimizeSvg(svg, slug) {
  const result = optimize(svg, {
    multipass: true,
    path: `${slug}.svg`,
    plugins: [{ name: "preset-default" }],
  });

  if ("error" in result) {
    throw new Error(`SVGO failed for ${slug}: ${result.error}`);
  }

  if (!result.data.includes("viewBox=")) {
    throw new Error(`Optimized SVG for ${slug} is missing viewBox`);
  }

  return ensureTrailingNewline(normalizeSvgRootDimensions(result.data));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function syncOne(slug) {
  const upstream = await fetchUpstreamIcon(slug);
  const optimized = optimizeSvg(upstream, slug);
  const local = await readLocalIcon(slug);
  const changed = local !== optimized;

  if (!CHECK_ONLY && changed) {
    await writeFile(path.join(ASSETS_DIR, `${slug}.svg`), optimized, "utf8");
  }

  return { slug, changed };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function main() {
  const registrySource = await readFile(REGISTRY_PATH, "utf8");
  const { slugs, skippedProviders } = parseRegistryEntries(registrySource);

  if (slugs.length === 0) {
    throw new Error("No providerIcon(...) entries found in registry.ts");
  }

  if (!(await fileExists(ASSETS_DIR))) {
    await mkdir(ASSETS_DIR, { recursive: true });
  }

  const uniqueSlugs = [...new Set(slugs.map(({ slug }) => slug))].sort();
  const results = await mapWithConcurrency(uniqueSlugs, CONCURRENCY, syncOne);
  const changed = results.filter((result) => result.changed).map((result) => result.slug);
  const unchanged = results.filter((result) => !result.changed).map((result) => result.slug);

  const localFiles = await readdir(ASSETS_DIR);
  const localSlugs = localFiles
    .map((fileName) => fileName.match(/^(.+)\.svg$/))
    .filter(Boolean)
    .map((match) => match[1]);
  const staleSlugs = localSlugs.filter((slug) => !uniqueSlugs.includes(slug)).sort();

  console.log(`Synced ${uniqueSlugs.length} provider icons from CodexBar ref "${CODEXBAR_REF}".`);

  if (changed.length > 0) {
    console.log(
      CHECK_ONLY
        ? `Out of sync icons (${changed.length}): ${changed.join(", ")}`
        : `Updated icons (${changed.length}): ${changed.join(", ")}`
    );
  }

  if (unchanged.length > 0) {
    console.log(`Unchanged icons (${unchanged.length}): ${unchanged.join(", ")}`);
  }

  if (skippedProviders.length > 0) {
    console.warn(
      `Providers without providerIcon(...) (${skippedProviders.length}): ${skippedProviders
        .map(({ providerId }) => providerId)
        .join(", ")}`
    );
  }

  if (staleSlugs.length > 0) {
    console.warn(`Stale local icons: ${staleSlugs.join(", ")}`);
  }

  if (CHECK_ONLY && changed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`sync-provider-icons failed: ${message}`);
  process.exitCode = 1;
});
