/**
 * One upgrade shared by the menu bar, Show Upgrades, and the Upgrade All command.
 *
 * The record lives in LocalStorage, not Cache. Cache loads its journal once
 * per process, so a view that already constructed it cannot see a worker's
 * later writes — and a `get` from that process can write the stale journal
 * back. `getItem` reads the database on every call.
 *
 * Cancel is a second key. A heartbeat rewrite of the record must not be able
 * to drop a cancel the view stored a moment earlier.
 */

import { LocalStorage } from "@raycast/api";
import type { UpgradePackage, UpgradePackageStatus } from "./brew/upgrade";
import { uiLogger } from "./logger";

export const UPGRADE_RUN_KEY = "brew-upgrade-run";
const CANCEL_PREFIX = "brew-upgrade-run-cancel:";

/**
 * A queued or running record whose heartbeat is this old is not live. The
 * worker rewrites the heartbeat about once a second; twenty seconds is long
 * enough to miss a few writes and short enough that a killed worker does not
 * block the next upgrade.
 */
export const LIVE_HEARTBEAT_MS = 20_000;

export type UpgradeRunPhase = "queued" | "running" | "done" | "failed" | "canceled";
export type UpgradeRunScope = "one" | "all";

export interface UpgradeRunPackage {
  name: string;
  isCask: boolean;
  from?: string;
  to?: string;
  pinned?: boolean;
  status?: UpgradePackageStatus;
}

export interface UpgradeRunRecord {
  id: string;
  phase: UpgradeRunPhase;
  scope: UpgradeRunScope;
  /** Packages the click asked to upgrade. The worker does not re-read the menu. */
  selection: UpgradePackage[];
  /** Full rows, so a view with an empty fetch cache can still paint the run. */
  packages: UpgradeRunPackage[];
  queuedAt: number;
  heartbeatAt: number;
  owner?: string;
  error?: string;
}

const PHASES: readonly UpgradeRunPhase[] = ["queued", "running", "done", "failed", "canceled"];
const SCOPES: readonly UpgradeRunScope[] = ["one", "all"];
const STATUSES: readonly UpgradePackageStatus[] = ["upgrading", "upgraded", "failed", "skipped"];

export function cancelKey(id: string): string {
  return `${CANCEL_PREFIX}${id}`;
}

/** Damaged JSON is no run: a record this process cannot trust must not block upgrades. */
export async function readUpgradeRun(): Promise<UpgradeRunRecord | undefined> {
  try {
    const raw = await LocalStorage.getItem<string>(UPGRADE_RUN_KEY);
    if (typeof raw !== "string" || raw.length === 0) return undefined;
    return parseRun(raw);
  } catch (err) {
    uiLogger.warn("Could not read the upgrade run", err);
    return undefined;
  }
}

/**
 * `queued` or `running`, and only while the heartbeat is younger than
 * {@link LIVE_HEARTBEAT_MS}. A finished phase is never live, however fresh.
 */
export async function readLiveRun(now = Date.now()): Promise<UpgradeRunRecord | undefined> {
  const run = await readUpgradeRun();
  if (!run) return undefined;
  if (run.phase !== "queued" && run.phase !== "running") return undefined;
  if (now - run.heartbeatAt >= LIVE_HEARTBEAT_MS) return undefined;
  return run;
}

export async function writeUpgradeRun(run: UpgradeRunRecord): Promise<void> {
  await LocalStorage.setItem(UPGRADE_RUN_KEY, JSON.stringify(run));
}

export async function queueRun(input: {
  id?: string;
  scope: UpgradeRunScope;
  selection: UpgradePackage[];
  packages: UpgradeRunPackage[];
  now?: number;
}): Promise<UpgradeRunRecord> {
  const now = input.now ?? Date.now();
  const run: UpgradeRunRecord = {
    id: input.id ?? `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    phase: "queued",
    scope: input.scope,
    selection: input.selection,
    packages: input.packages,
    queuedAt: now,
    heartbeatAt: now,
  };
  await writeUpgradeRun(run);
  return run;
}

/**
 * Take a queued run. The owner is written and then read back: a mismatched
 * owner means another worker stored its own claim in between, and this one
 * must not start brew.
 */
export async function claimRun(id: string, owner: string, now = Date.now()): Promise<UpgradeRunRecord | undefined> {
  const current = await readUpgradeRun();
  if (!current || current.id !== id || current.phase !== "queued") return undefined;
  const claimed: UpgradeRunRecord = { ...current, phase: "running", owner, heartbeatAt: now };
  await writeUpgradeRun(claimed);
  const readBack = await readUpgradeRun();
  if (!readBack || readBack.id !== id || readBack.owner !== owner || readBack.phase !== "running") {
    return undefined;
  }
  return readBack;
}

export async function requestCancel(id: string): Promise<void> {
  await LocalStorage.setItem(cancelKey(id), "1");
}

export async function isCancelRequested(id: string): Promise<boolean> {
  const value = await LocalStorage.getItem(cancelKey(id));
  return value === "1" || value === 1 || value === true;
}

/** Drop the record. A failed launch uses this while the record is still queued. */
export async function deleteUpgradeRun(id?: string): Promise<void> {
  const current = await readUpgradeRun();
  if (id && current && current.id !== id) return;
  if (current) await LocalStorage.removeItem(cancelKey(current.id));
  await LocalStorage.removeItem(UPGRADE_RUN_KEY);
}

/**
 * A view or the menu may clear a run only after it has finished. A live
 * record stays, so a slow paint cannot delete the worker's claim.
 */
export async function clearFinishedRun(): Promise<void> {
  const current = await readUpgradeRun();
  if (!current) return;
  if (current.phase === "queued" || current.phase === "running") return;
  await LocalStorage.removeItem(cancelKey(current.id));
  await LocalStorage.removeItem(UPGRADE_RUN_KEY);
}

function parseRun(raw: string): UpgradeRunRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as Partial<UpgradeRunRecord>;
    if (typeof record.id !== "string" || record.id.length === 0) return undefined;
    if (!isPhase(record.phase) || !isScope(record.scope)) return undefined;
    if (typeof record.queuedAt !== "number" || !Number.isFinite(record.queuedAt)) return undefined;
    if (typeof record.heartbeatAt !== "number" || !Number.isFinite(record.heartbeatAt)) return undefined;
    const selection = parsePackages(record.selection);
    const packages = parseRunPackages(record.packages);
    if (!selection || !packages) return undefined;
    if (record.owner !== undefined && typeof record.owner !== "string") return undefined;
    if (record.error !== undefined && typeof record.error !== "string") return undefined;
    return {
      id: record.id,
      phase: record.phase,
      scope: record.scope,
      selection,
      packages,
      queuedAt: record.queuedAt,
      heartbeatAt: record.heartbeatAt,
      owner: record.owner,
      error: record.error,
    };
  } catch (err) {
    uiLogger.warn("Could not read the upgrade run", err);
    return undefined;
  }
}

function parsePackages(value: unknown): UpgradePackage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const packages: UpgradePackage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const { name, isCask } = item as Partial<UpgradePackage>;
    if (typeof name !== "string" || typeof isCask !== "boolean") return undefined;
    packages.push({ name, isCask });
  }
  return packages;
}

function parseRunPackages(value: unknown): UpgradeRunPackage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const packages: UpgradeRunPackage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const row = item as Partial<UpgradeRunPackage>;
    if (typeof row.name !== "string" || typeof row.isCask !== "boolean") return undefined;
    if (row.from !== undefined && typeof row.from !== "string") return undefined;
    if (row.to !== undefined && typeof row.to !== "string") return undefined;
    if (row.pinned !== undefined && typeof row.pinned !== "boolean") return undefined;
    if (row.status !== undefined && !isStatus(row.status)) return undefined;
    packages.push({
      name: row.name,
      isCask: row.isCask,
      from: row.from,
      to: row.to,
      pinned: row.pinned,
      status: row.status,
    });
  }
  return packages;
}

function isPhase(value: unknown): value is UpgradeRunPhase {
  return typeof value === "string" && PHASES.includes(value as UpgradeRunPhase);
}

function isScope(value: unknown): value is UpgradeRunScope {
  return typeof value === "string" && SCOPES.includes(value as UpgradeRunScope);
}

function isStatus(value: unknown): value is UpgradePackageStatus {
  return typeof value === "string" && STATUSES.includes(value as UpgradePackageStatus);
}
