import { Cache } from "@raycast/api";
import type { KeychainAccessPolicy } from "./keychainAccessPolicy";

const SERVE_STATE_KEY = "serve-runtime-v1";
const PROCESS_START_TOLERANCE_MS = 2_000;
let serveStateCache: Cache | undefined;

function getServeStateCache(): Cache {
  serveStateCache ??= new Cache({ namespace: "codexbar-serve-runtime" });
  return serveStateCache;
}

export type CodexBarServeProcessIdentity = {
  pid: number;
  command: string;
  startedAtMs: number;
};

export type CodexBarServeRuntimeRecord = CodexBarServeProcessIdentity & {
  keychainAccessPolicy: KeychainAccessPolicy;
  recordedAtMs: number;
};

export function recordCodexBarServeRuntime(
  processIdentity: CodexBarServeProcessIdentity,
  keychainAccessPolicy: KeychainAccessPolicy,
  now = Date.now(),
): void {
  const record: CodexBarServeRuntimeRecord = {
    ...processIdentity,
    keychainAccessPolicy,
    recordedAtMs: now,
  };
  getServeStateCache().set(SERVE_STATE_KEY, JSON.stringify(record));
}

export function readCodexBarServeRuntime(): CodexBarServeRuntimeRecord | undefined {
  const serialized = getServeStateCache().get(SERVE_STATE_KEY);
  if (!serialized) {
    return undefined;
  }

  try {
    const record = JSON.parse(serialized) as Partial<CodexBarServeRuntimeRecord>;
    if (
      !Number.isInteger(record.pid) ||
      (record.pid ?? 0) <= 0 ||
      typeof record.command !== "string" ||
      !record.command ||
      typeof record.startedAtMs !== "number" ||
      !Number.isFinite(record.startedAtMs) ||
      (record.keychainAccessPolicy !== "default" && record.keychainAccessPolicy !== "disabled") ||
      typeof record.recordedAtMs !== "number" ||
      !Number.isFinite(record.recordedAtMs)
    ) {
      clearCodexBarServeRuntime();
      return undefined;
    }

    return record as CodexBarServeRuntimeRecord;
  } catch {
    clearCodexBarServeRuntime();
    return undefined;
  }
}

export function codexBarServeRuntimeMatches(
  record: CodexBarServeRuntimeRecord,
  processIdentity: CodexBarServeProcessIdentity,
  keychainAccessPolicy: KeychainAccessPolicy,
): boolean {
  return (
    record.pid === processIdentity.pid &&
    record.command === processIdentity.command &&
    Math.abs(record.startedAtMs - processIdentity.startedAtMs) <= PROCESS_START_TOLERANCE_MS &&
    record.keychainAccessPolicy === keychainAccessPolicy
  );
}

export function clearCodexBarServeRuntime(): void {
  getServeStateCache().remove(SERVE_STATE_KEY);
}
