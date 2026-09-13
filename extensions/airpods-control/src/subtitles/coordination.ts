import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { environment, updateCommandMetadata } from "@raycast/api";

export type SubtitleChannel = "listening-mode" | "conversation-awareness" | "status";
export type SubtitleRevision = string;

export interface CommandSubtitleOptions {
  channel: SubtitleChannel;
  revision?: SubtitleRevision;
}

interface RevisionState {
  listeningMode: SubtitleRevision | null;
  conversationAwareness: SubtitleRevision | null;
  status: SubtitleRevision | null;
}

const INITIAL_REVISION_STATE: RevisionState = {
  listeningMode: null,
  conversationAwareness: null,
  status: null,
};

const LOCKF_PATH = "/usr/bin/lockf";
const LOCK_TIMEOUT_SECONDS = "10";
const METADATA_LOCK_NAME = "subtitle-metadata.lock";
const GLOBAL_OPERATION_LOCK_NAME = "subtitle-operation.lock";
const OPERATION_LOCK_NAMES: Record<SubtitleChannel, string> = {
  "listening-mode": "subtitle-listening-mode-operation.lock",
  "conversation-awareness": "subtitle-conversation-awareness-operation.lock",
  status: "subtitle-status-operation.lock",
};
const REVISION_STATE_NAME = "subtitle-metadata.json";

function pathFor(name: string): string {
  const path = environment.supportPath;
  mkdirSync(path, { recursive: true });
  return join(path, name);
}

function waitForLockf(
  child: ReturnType<typeof spawn>,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
}

async function withOperatingSystemLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  // Keep the descriptor open across awaits. The OS releases its lock on process exit.
  const descriptor = openSync(path, "a+");
  try {
    const lockf = spawn(LOCKF_PATH, ["-s", "-t", LOCK_TIMEOUT_SECONDS, "3"], {
      stdio: ["ignore", "ignore", "ignore", descriptor],
    });
    const result = await waitForLockf(lockf);
    if (result.code !== 0) {
      throw new Error(
        `Could not acquire subtitle coordination lock (exit ${result.code ?? "unknown"}, ${result.signal ?? "no signal"})`,
      );
    }
    return await operation();
  } finally {
    closeSync(descriptor);
  }
}

async function withFileLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const path = pathFor(name);
  return withOperatingSystemLock(path, operation);
}

function revisionForChannel(state: RevisionState, channel: SubtitleChannel): SubtitleRevision | null {
  if (channel === "listening-mode") return state.listeningMode;
  if (channel === "conversation-awareness") return state.conversationAwareness;
  return state.status;
}

function setRevisionForChannel(
  state: RevisionState,
  channel: SubtitleChannel,
  revision: SubtitleRevision,
): RevisionState {
  if (channel === "listening-mode") return { ...state, listeningMode: revision, status: revision };
  if (channel === "conversation-awareness") return { ...state, conversationAwareness: revision, status: revision };
  return { ...state, status: revision };
}

function readRevisionState(): RevisionState {
  try {
    const parsed = JSON.parse(readFileSync(pathFor(REVISION_STATE_NAME), "utf8")) as Partial<RevisionState> | null;
    if (parsed === null || typeof parsed !== "object") {
      return { ...INITIAL_REVISION_STATE };
    }
    return {
      listeningMode:
        typeof parsed.listeningMode === "string" && parsed.listeningMode.length > 0
          ? parsed.listeningMode
          : INITIAL_REVISION_STATE.listeningMode,
      conversationAwareness:
        typeof parsed.conversationAwareness === "string" && parsed.conversationAwareness.length > 0
          ? parsed.conversationAwareness
          : INITIAL_REVISION_STATE.conversationAwareness,
      status:
        typeof parsed.status === "string" && parsed.status.length > 0 ? parsed.status : INITIAL_REVISION_STATE.status,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
      return { ...INITIAL_REVISION_STATE };
    }
    throw error;
  }
}

function writeRevisionState(state: RevisionState): void {
  const statePath = pathFor(REVISION_STATE_NAME);
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, statePath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The state file may not have been created before the write failed.
    }
    throw error;
  }
}

async function reserveSubtitleRevisionUnderMetadataLock(channel: SubtitleChannel): Promise<SubtitleRevision> {
  return withFileLock(METADATA_LOCK_NAME, async () => {
    const state = readRevisionState();
    const revision = randomUUID();
    writeRevisionState(setRevisionForChannel(state, channel, revision));
    return revision;
  });
}

async function reserveSnapshotRevisionUnderMetadataLock(): Promise<SubtitleRevision> {
  return withFileLock(METADATA_LOCK_NAME, async () => {
    const revision = randomUUID();
    writeRevisionState({
      listeningMode: revision,
      conversationAwareness: revision,
      status: revision,
    });
    return revision;
  });
}

async function withSubtitleOperationLock<T>(channel: SubtitleChannel, operation: () => Promise<T>): Promise<T> {
  return withFileLock(GLOBAL_OPERATION_LOCK_NAME, () => withFileLock(OPERATION_LOCK_NAMES[channel], operation));
}

/** Reserve a durable revision for a delayed, read-free subtitle reset. */
export async function reserveSubtitleRevisionForReset(channel: SubtitleChannel): Promise<SubtitleRevision> {
  return withSubtitleOperationLock(channel, () => reserveSubtitleRevisionUnderMetadataLock(channel));
}

/**
 * Serialize one feature's complete CLI transaction across Raycast processes.
 * The callback receives the revision reserved before its first CLI call.
 */
export async function withSubtitleOperation<T>(
  channel: SubtitleChannel,
  operation: (revision: SubtitleRevision) => Promise<T>,
): Promise<T> {
  return withSubtitleOperationLock(channel, async () => {
    const revision = await reserveSubtitleRevisionUnderMetadataLock(channel);
    return operation(revision);
  });
}

/**
 * Serialize a refresh that reads multiple AirPods features as one snapshot.
 * The same revision is reserved for every subtitle derived from that snapshot.
 */
export async function withSubtitleSnapshotOperation<T>(
  operation: (revision: SubtitleRevision) => Promise<T>,
): Promise<T> {
  return withFileLock(GLOBAL_OPERATION_LOCK_NAME, async () => {
    const revision = await reserveSnapshotRevisionUnderMetadataLock();
    return operation(revision);
  });
}

async function writeSubtitleForRevision(
  subtitle: string | null,
  channel: SubtitleChannel,
  revision: SubtitleRevision,
): Promise<void> {
  await withFileLock(METADATA_LOCK_NAME, async () => {
    if (revisionForChannel(readRevisionState(), channel) !== revision) return;
    await updateCommandMetadata({ subtitle });
  });
}

async function clearSubtitleAfterPublicationFailure(
  channel: SubtitleChannel,
  revision: SubtitleRevision,
): Promise<void> {
  try {
    await writeSubtitleForRevision(null, channel, revision);
  } catch (error) {
    console.error("Failed to restore the command subtitle", error);
  }
}

export async function resetCommandSubtitle(options: CommandSubtitleOptions): Promise<void> {
  const revision = options.revision;
  try {
    if (revision) {
      await writeSubtitleForRevision(null, options.channel, revision);
      return;
    }
    await withSubtitleOperation(options.channel, async (operationRevision) => {
      await writeSubtitleForRevision(null, options.channel, operationRevision);
    });
  } catch (error) {
    console.error("Failed to restore the command subtitle", error);
  }
}

export async function publishCommandSubtitle(subtitle: string, options: CommandSubtitleOptions): Promise<void> {
  let revision = options.revision;
  try {
    if (revision) {
      await writeSubtitleForRevision(subtitle, options.channel, revision);
    } else {
      await withSubtitleOperation(options.channel, async (operationRevision) => {
        revision = operationRevision;
        await writeSubtitleForRevision(subtitle, options.channel, operationRevision);
      });
    }
  } catch (error) {
    console.error("Failed to update the command subtitle", error);
    if (revision) {
      await clearSubtitleAfterPublicationFailure(options.channel, revision);
    }
  }
}
