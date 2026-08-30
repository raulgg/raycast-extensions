#!/usr/bin/env node

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchLatestReleaseTarget, upstreamLockPath } from "./lib/upstream.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runNpm(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, { cwd: ROOT, stdio: "inherit", env });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function bump() {
  const target = await fetchLatestReleaseTarget();
  console.log(`Checking CodexBar ${target.tag} (${target.sha}) before writing the lockfile.`);

  const env = { ...process.env, CODEXBAR_REF: target.sha };
  delete env.CODEXBAR_DIR;

  const checkCode = await runNpm(["run", "upstream:check"], env);
  if (checkCode !== 0) {
    console.error("upstream:check failed; lockfile not updated.");
    process.exitCode = checkCode;
    return;
  }

  const iconCode = await runNpm(["run", "upstream:sync-icons", "--", "--check"], env);
  if (iconCode !== 0) {
    console.error("upstream:sync-icons --check failed; lockfile not updated.");
    process.exitCode = iconCode;
    return;
  }

  const lockPath = upstreamLockPath();
  await writeFile(lockPath, `${JSON.stringify(target, null, 2)}\n`, "utf8");
  console.log(`Wrote ${lockPath}: ${target.tag} ${target.sha}`);
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  bump().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
