#!/usr/bin/env node

import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { optimize } from "svgo";
import { PROVIDER_CATALOG } from "../src/providers/catalog.ts";
import { createUpstreamSource, isMainModule } from "./lib/upstream.mjs";

const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/provider-icons");
const CONCURRENCY = 6;
const CHECK_ONLY = process.argv.includes("--check");

export function assertSafeIconSlug(slug) {
  if (typeof slug !== "string" || slug === "") {
    throw new Error("Icon slug is empty.");
  }

  if (slug.includes("..") || slug.startsWith("/") || slug.includes("/") || slug.includes("\\")) {
    throw new Error(`Unsafe icon slug "${slug}".`);
  }

  if (!/^[A-Za-z0-9._-]+$/.test(slug)) {
    throw new Error(`Unsafe icon slug "${slug}".`);
  }

  return slug;
}

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

function collectIconSlugsFromCatalog(catalog) {
  return Object.values(catalog).map((entry) => assertSafeIconSlug(entry.iconSlug));
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

async function fetchUpstreamIcon(source, slug) {
  return source.readFile(`Sources/CodexBar/Resources/ProviderIcon-${slug}.svg`);
}

export function optimizeSvg(svg, slug) {
  const result = optimize(svg, {
    multipass: true,
    path: `${assertSafeIconSlug(slug)}.svg`,
    plugins: [{ name: "preset-default" }, "removeScripts"],
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

async function syncOne(source, slug) {
  const upstream = await fetchUpstreamIcon(source, slug);
  const optimized = optimizeSvg(upstream, slug);
  const local = await readLocalIcon(slug);
  const changed = local !== optimized;

  if (!CHECK_ONLY && changed) {
    await writeFile(path.join(ASSETS_DIR, `${assertSafeIconSlug(slug)}.svg`), optimized, "utf8");
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
  const slugs = collectIconSlugsFromCatalog(PROVIDER_CATALOG);

  if (slugs.length === 0) {
    throw new Error("No iconSlug entries found in catalog.ts");
  }

  if (!(await fileExists(ASSETS_DIR))) {
    await mkdir(ASSETS_DIR, { recursive: true });
  }

  const source = await createUpstreamSource();
  const uniqueSlugs = [...new Set(slugs)].sort();
  const results = await mapWithConcurrency(uniqueSlugs, CONCURRENCY, (slug) => syncOne(source, slug));
  const changed = results.filter((result) => result.changed).map((result) => result.slug);
  const unchanged = results.filter((result) => !result.changed).map((result) => result.slug);

  const localFiles = await readdir(ASSETS_DIR);
  const localSlugs = localFiles
    .map((fileName) => fileName.match(/^(.+)\.svg$/))
    .filter(Boolean)
    .map((match) => match[1]);
  const staleSlugs = localSlugs.filter((slug) => !uniqueSlugs.includes(slug)).sort();

  console.log(`Synced ${uniqueSlugs.length} provider icons from ${source.label}.`);

  if (changed.length > 0) {
    console.log(
      CHECK_ONLY
        ? `Out of sync icons (${changed.length}): ${changed.join(", ")}`
        : `Updated icons (${changed.length}): ${changed.join(", ")}`,
    );
  }

  if (unchanged.length > 0) {
    console.log(`Unchanged icons (${unchanged.length}): ${unchanged.join(", ")}`);
  }

  if (staleSlugs.length > 0) {
    console.warn(`Stale local icons: ${staleSlugs.join(", ")}`);
  }

  if (CHECK_ONLY && (changed.length > 0 || staleSlugs.length > 0)) {
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`sync-provider-icons failed: ${message}`);
    process.exitCode = 1;
  });
}
