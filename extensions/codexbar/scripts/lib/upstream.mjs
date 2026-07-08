// Shared access to the upstream CodexBar repository for the upstream:* scripts.
//
// Both scripts compare/harvest against the same ref by default: the latest GitHub
// release tag (what shipped to users), not main. Override with CODEXBAR_REF, or point
// CODEXBAR_DIR at a local checkout to skip the network entirely. Resolution failures
// throw — a checker that silently falls back to a different ref answers a question
// nobody asked.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export const UPSTREAM_REPO = "steipete/CodexBar";

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const rateLimitHint =
      response.status === 403 && url.startsWith("https://api.github.com/")
        ? " (likely the unauthenticated rate limit — set GITHUB_TOKEN, or CODEXBAR_DIR for a local checkout)"
        : "";
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}${rateLimitHint}`);
  }
  return response.text();
}

export async function resolveUpstreamRef() {
  if (process.env.CODEXBAR_REF) {
    return process.env.CODEXBAR_REF;
  }

  const release = JSON.parse(
    await fetchText(`https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest`, githubHeaders()),
  );
  if (!release.tag_name) {
    throw new Error(`Could not resolve the latest ${UPSTREAM_REPO} release tag.`);
  }
  return release.tag_name;
}

async function listLocalFiles(dir, suffix) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listLocalFiles(entryPath, suffix)));
    } else if (entry.name.endsWith(suffix)) {
      files.push(entryPath);
    }
  }
  return files;
}

// Returns a source-agnostic reader over the upstream repo:
//   { label, listFiles(prefix, suffix), readFile(repoPath) }
// backed by CODEXBAR_DIR when set, otherwise by GitHub at the resolved ref.
export async function createUpstreamSource() {
  const localDir = process.env.CODEXBAR_DIR;
  if (localDir) {
    return {
      label: `local checkout ${localDir}`,
      listFiles: async (prefix, suffix) => {
        const files = await listLocalFiles(path.join(localDir, prefix), suffix);
        return files.map((file) => path.relative(localDir, file));
      },
      readFile: (repoPath) => readFile(path.join(localDir, repoPath), "utf8"),
    };
  }

  const ref = await resolveUpstreamRef();
  const rawUrl = (repoPath) => `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${ref}/${repoPath}`;
  return {
    label: `CodexBar ref "${ref}"`,
    ref,
    listFiles: async (prefix, suffix) => {
      const tree = JSON.parse(
        await fetchText(`https://api.github.com/repos/${UPSTREAM_REPO}/git/trees/${ref}?recursive=1`, githubHeaders()),
      );
      if (tree.truncated) {
        throw new Error(`GitHub tree listing for ref "${ref}" was truncated; cannot enumerate ${prefix}.`);
      }
      return tree.tree
        .filter((entry) => entry.path.startsWith(prefix) && entry.path.endsWith(suffix))
        .map((entry) => entry.path);
    },
    readFile: (repoPath) => fetchText(rawUrl(repoPath)),
  };
}

export async function readFilesWithConcurrency(source, repoPaths, concurrency = 6) {
  const contents = [];
  for (let index = 0; index < repoPaths.length; index += concurrency) {
    const batch = repoPaths.slice(index, index + concurrency);
    contents.push(...(await Promise.all(batch.map((repoPath) => source.readFile(repoPath)))));
  }
  return repoPaths.map((repoPath, index) => ({ path: repoPath, content: contents[index] }));
}
