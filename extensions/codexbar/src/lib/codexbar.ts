import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { request } from "node:http";
import { homedir, userInfo } from "node:os";
import { delimiter, join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { isProviderSelectorId } from "../providers/registry";
import {
  extractProviderErrorMessage,
  extractProviderStatus,
  normalizeProviderDetailPayload,
} from "../providers/normalize";
import type {
  ProviderDetailData,
  ProviderInteractionMode,
  ProviderSourceMode,
  ProviderStatus,
} from "../providers/types";
import { getMockProviderPayload, isCodexBarMockMode } from "../mocks/codexbar";
import { buildInstallHelp, detectHomebrew, findCodexBarApp, type InstallHelpState } from "./cliInstall";
import { applyProviderUsageSectionMemory } from "./providerShapeMemory";
import { applyKeychainAccessPolicy, type KeychainAccessPolicy } from "./keychainAccessPolicy";
import {
  clearCodexBarServeRuntime,
  codexBarServeRuntimeMatches,
  readCodexBarServeRuntime,
  recordCodexBarServeRuntime,
  type CodexBarServeProcessIdentity,
} from "./codexBarServeState";

const CODEXBAR_TIMEOUT_MS = 60_000;
const CODEXBAR_WEB_TIMEOUT_MS = 5_000;
const CODEXBAR_SERVE_HOST = "127.0.0.1";
const CODEXBAR_SERVE_PORT = 17_653;
const CODEXBAR_SERVE_REFRESH_INTERVAL_SECONDS = 600;
const CODEXBAR_SERVE_REQUEST_TIMEOUT_SECONDS = 30;
const CODEXBAR_SERVE_HEALTH_TIMEOUT_MS = 500;
const CODEXBAR_SERVE_STARTUP_TIMEOUT_MS = 1_500;
const CODEXBAR_SERVE_STARTUP_POLL_MS = 150;
const MAX_BUFFER_BYTES = 5 * 1024 * 1024;
const DEFAULT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const FALLBACK_PATHS = ["/opt/homebrew/bin/codexbar", "/usr/local/bin/codexbar"] as const;

export type ResolvedCodexBarBinary = {
  command: string;
  source: "path" | "fallback" | "mock";
  keychainAccessPolicy: KeychainAccessPolicy;
  capabilities?: CodexBarCapabilities;
};

export type CodexBarCapabilities = {
  appFetchProfile: boolean;
  interactionModes: boolean;
  presentationSchemaVersions: number[];
  serveAppFetchProfile: boolean;
  serveForceRefresh: boolean;
};

type ProviderFetchOptions = {
  mode?: "auto" | "force";
  source?: ProviderSourceMode;
  interaction?: ProviderInteractionMode;
};

const LEGACY_CAPABILITIES: CodexBarCapabilities = {
  appFetchProfile: false,
  interactionModes: false,
  presentationSchemaVersions: [],
  serveAppFetchProfile: false,
  serveForceRefresh: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type CodexBarCliErrorKind = "unavailable" | "timeout" | "invalid-json" | "execution";

export class CodexBarCliError extends Error {
  kind: CodexBarCliErrorKind;
  detail?: string;

  constructor(kind: CodexBarCliErrorKind, message: string, detail?: string) {
    super(message);
    this.name = "CodexBarCliError";
    this.kind = kind;
    this.detail = detail;
  }
}

export const KEYCHAIN_ACCESS_DISABLED_PROVIDER_ERROR_HINT =
  "Keychain access is disabled. This Provider may require another authentication source.\n\nConfigure it in the CodexBar app or allow Keychain access and retry.";

function appendKeychainAccessPolicyHint(error: unknown, binary: ResolvedCodexBarBinary): Error {
  if (binary.keychainAccessPolicy !== "disabled") {
    return error instanceof Error ? error : new Error(String(error));
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(KEYCHAIN_ACCESS_DISABLED_PROVIDER_ERROR_HINT)) {
    return error instanceof Error ? error : new Error(message);
  }

  const hintedMessage = `${message}\n\n${KEYCHAIN_ACCESS_DISABLED_PROVIDER_ERROR_HINT}`;
  return error instanceof CodexBarCliError
    ? new CodexBarCliError(error.kind, hintedMessage, error.detail)
    : new Error(hintedMessage);
}

async function withProviderFetchErrorHint<T>(binary: ResolvedCodexBarBinary, fetch: () => Promise<T>): Promise<T> {
  try {
    return await fetch();
  } catch (error) {
    throw appendKeychainAccessPolicyHint(error, binary);
  }
}

export type { InstallHelpState };

export type CodexBarAvailability =
  | { status: "available"; binary: ResolvedCodexBarBinary }
  | { status: "unavailable"; install: InstallHelpState; error?: Error }
  | { status: "error"; error: Error };

type ExecFailure = Error & {
  code?: number | string;
  killed?: boolean;
  signal?: NodeJS.Signals;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

type ExecFileOptions = {
  encoding: BufferEncoding;
  timeout: number;
  maxBuffer: number;
  env?: NodeJS.ProcessEnv;
};

function execFileAsync(
  command: string,
  args: string[],
  options: ExecFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function buildCodexBarProcessEnv(policy: KeychainAccessPolicy): NodeJS.ProcessEnv {
  const currentUser = userInfo();
  const username = process.env.USER || process.env.LOGNAME || currentUser.username;

  return applyKeychainAccessPolicy(
    {
      ...process.env,
      HOME: process.env.HOME || currentUser.homedir || homedir(),
      USER: username,
      LOGNAME: process.env.LOGNAME || username,
      SHELL: process.env.SHELL || currentUser.shell || "/bin/zsh",
      PATH: process.env.PATH || DEFAULT_PATH,
    },
    policy,
  );
}

function getFailureOutput(error: unknown, key: "stdout" | "stderr"): string {
  const output = (error as ExecFailure | undefined)?.[key];
  if (typeof output === "string") {
    return output;
  }
  if (Buffer.isBuffer(output)) {
    return output.toString("utf8");
  }
  return "";
}

function isExecutablePath(path: string): Promise<boolean> {
  return access(path, constants.X_OK)
    .then(() => true)
    .catch(() => false);
}

async function findInPath(executable: string, pathValue = process.env.PATH ?? ""): Promise<string | undefined> {
  for (const segment of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = join(segment, executable);
    if (await isExecutablePath(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export async function resolveCodexBarBinary(
  keychainAccessPolicy: KeychainAccessPolicy,
): Promise<ResolvedCodexBarBinary> {
  const fromPath = await findInPath("codexbar");
  if (fromPath) {
    return {
      command: fromPath,
      source: "path",
      keychainAccessPolicy,
    };
  }

  for (const fallbackPath of FALLBACK_PATHS) {
    if (await isExecutablePath(fallbackPath)) {
      return {
        command: fallbackPath,
        source: "fallback",
        keychainAccessPolicy,
      };
    }
  }

  throw new CodexBarCliError("unavailable", "Unable to find the `codexbar` CLI on this machine.");
}

export function extractJsonPayload(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new CodexBarCliError("invalid-json", "CodexBar returned no JSON output.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const objectStart = trimmed.indexOf("{");
    const arrayStart = trimmed.indexOf("[");
    const startCandidates = [objectStart, arrayStart].filter((value) => value >= 0);
    if (startCandidates.length === 0) {
      throw new CodexBarCliError("invalid-json", "CodexBar returned invalid JSON.", trimmed);
    }

    const start = Math.min(...startCandidates);
    const openChar = trimmed[start];
    const closeChar = openChar === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < trimmed.length; index += 1) {
      const char = trimmed[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === openChar) {
        depth += 1;
      } else if (char === closeChar) {
        depth -= 1;
        if (depth === 0) {
          return JSON.parse(trimmed.slice(start, index + 1));
        }
      }
    }
  }

  throw new CodexBarCliError("invalid-json", "CodexBar returned invalid JSON.", trimmed);
}

function getJsonErrorMessage(payload: unknown): string | undefined {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  if (!isRecord(payload)) {
    return undefined;
  }

  const record = payload;
  const directMessage =
    (typeof record.message === "string" && record.message) ||
    (typeof record.error === "string" && record.error) ||
    (typeof record.detail === "string" && record.detail);
  if (directMessage) {
    return directMessage;
  }

  const nestedError = record.error;
  if (isRecord(nestedError)) {
    if (typeof nestedError.message === "string" && nestedError.message) {
      return nestedError.message;
    }
  }

  return undefined;
}

export function classifyExecFailure(error: unknown): CodexBarCliError {
  const failure = error as ExecFailure | undefined;
  const code = failure?.code === undefined ? "" : String(failure.code);
  const stdout = getFailureOutput(error, "stdout");
  const stderr = getFailureOutput(error, "stderr");
  const combinedDetail = [stdout, stderr].filter(Boolean).join("\n");
  const message = [failure?.message, stderr].filter(Boolean).join("\n");
  const normalized = message.toLowerCase();

  if (
    code === "ENOENT" ||
    code === "EACCES" ||
    normalized.includes("command not found") ||
    (normalized.includes("spawn") && normalized.includes("enoent"))
  ) {
    return new CodexBarCliError("unavailable", "Unable to launch the `codexbar` CLI.", combinedDetail);
  }

  if (code === "ETIMEDOUT" || failure?.killed || failure?.signal === "SIGTERM") {
    return new CodexBarCliError("timeout", "CodexBar timed out while fetching usage data.", combinedDetail);
  }

  return new CodexBarCliError("execution", "CodexBar failed to fetch usage data.", combinedDetail);
}

export async function executeCodexBar(binary: ResolvedCodexBarBinary, args: string[]): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync(binary.command, args, {
      encoding: "utf8",
      timeout: CODEXBAR_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
      env: buildCodexBarProcessEnv(binary.keychainAccessPolicy),
    });

    return extractJsonPayload(stdout);
  } catch (error) {
    const stdout = getFailureOutput(error, "stdout");
    if (stdout.trim()) {
      const payload = extractJsonPayload(stdout);
      const jsonErrorMessage = getJsonErrorMessage(payload);
      if (!jsonErrorMessage) {
        return payload;
      }

      throw new CodexBarCliError("execution", jsonErrorMessage, getFailureOutput(error, "stderr"));
    }

    throw classifyExecFailure(error);
  }
}

function requestCodexBarServeJson(path: string, timeout: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const req = request(
      {
        hostname: CODEXBAR_SERVE_HOST,
        port: CODEXBAR_SERVE_PORT,
        path,
        method: "GET",
        timeout,
      },
      (res) => {
        res.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.byteLength;
          if (totalBytes > MAX_BUFFER_BYTES) {
            req.destroy(new Error("CodexBar serve returned too much data."));
            return;
          }

          chunks.push(buffer);
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`CodexBar serve returned HTTP ${res.statusCode ?? "unknown"}.`));
            return;
          }

          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new CodexBarCliError("invalid-json", "CodexBar serve returned invalid JSON."));
          }
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new CodexBarCliError("timeout", "CodexBar serve request timed out."));
    });
    req.on("error", reject);
    req.end();
  });
}

export async function isCodexBarServeHealthy(): Promise<boolean> {
  try {
    const payload = await requestCodexBarServeJson("/health", CODEXBAR_SERVE_HEALTH_TIMEOUT_MS);
    return isRecord(payload) && payload.status === "ok";
  } catch {
    return false;
  }
}

function parseCodexBarCapabilities(payload: unknown): CodexBarCapabilities {
  if (!isRecord(payload)) {
    return LEGACY_CAPABILITIES;
  }

  const rawCapabilities = isRecord(payload.capabilities) ? payload.capabilities : payload;
  const fetchProfiles = Array.isArray(rawCapabilities.fetchProfiles) ? rawCapabilities.fetchProfiles : [];
  const interactionModes = Array.isArray(rawCapabilities.interactionModes) ? rawCapabilities.interactionModes : [];
  const presentationSchemaVersions = Array.isArray(rawCapabilities.presentationSchemaVersions)
    ? rawCapabilities.presentationSchemaVersions.filter(
        (version): version is number => typeof version === "number" && Number.isFinite(version),
      )
    : [];
  const serve = isRecord(rawCapabilities.serve) ? rawCapabilities.serve : undefined;

  return {
    appFetchProfile: fetchProfiles.includes("app"),
    interactionModes: interactionModes.includes("background") && interactionModes.includes("user"),
    presentationSchemaVersions,
    serveAppFetchProfile: serve?.fetchProfile === true,
    serveForceRefresh: serve?.forceRefresh === true,
  };
}

function hasNegotiatedCapabilities(capabilities: CodexBarCapabilities): boolean {
  return (
    capabilities.appFetchProfile ||
    capabilities.interactionModes ||
    capabilities.presentationSchemaVersions.length > 0 ||
    capabilities.serveAppFetchProfile ||
    capabilities.serveForceRefresh
  );
}

async function detectCodexBarCapabilities(binary: ResolvedCodexBarBinary): Promise<CodexBarCapabilities | undefined> {
  try {
    const payload = await executeCodexBar(binary, ["capabilities", "--format", "json", "--json-only"]);
    const capabilities = parseCodexBarCapabilities(payload);
    return hasNegotiatedCapabilities(capabilities) ? capabilities : undefined;
  } catch {
    return undefined;
  }
}

function startCodexBarServe(binary: ResolvedCodexBarBinary, onError: (error: Error) => void): number | undefined {
  const child = spawn(
    binary.command,
    [
      "serve",
      "--port",
      String(CODEXBAR_SERVE_PORT),
      "--refresh-interval",
      String(CODEXBAR_SERVE_REFRESH_INTERVAL_SECONDS),
      "--request-timeout",
      String(CODEXBAR_SERVE_REQUEST_TIMEOUT_SECONDS),
    ],
    {
      detached: true,
      stdio: "ignore",
      env: buildCodexBarProcessEnv(binary.keychainAccessPolicy),
    },
  );
  child.once("error", onError);
  child.unref();
  return child.pid;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const SERVE_PROBE_TIMEOUT_MS = 5_000;
const SERVE_PROBE_MAX_BUFFER = 64 * 1024;

async function findCodexBarServePid(): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", "-ti", `tcp:${CODEXBAR_SERVE_PORT}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      timeout: SERVE_PROBE_TIMEOUT_MS,
      maxBuffer: SERVE_PROBE_MAX_BUFFER,
    });
    const pid = Number.parseInt(stdout.trim().split("\n")[0] ?? "", 10);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

// ps etime formats: "mm:ss", "hh:mm:ss", "dd-hh:mm:ss".
export function parseProcessElapsedMs(etime: string): number | undefined {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(etime.trim());
  if (!match) {
    return undefined;
  }

  const [, days, hours, minutes, seconds] = match;
  const totalSeconds =
    Number.parseInt(days ?? "0", 10) * 24 * 60 * 60 +
    Number.parseInt(hours ?? "0", 10) * 60 * 60 +
    Number.parseInt(minutes, 10) * 60 +
    Number.parseInt(seconds, 10);
  return totalSeconds * 1000;
}

async function readProcessElapsedAndCommand(pid: number): Promise<{ elapsedMs: number; command: string } | undefined> {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "etime=,comm=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: SERVE_PROBE_TIMEOUT_MS,
      maxBuffer: SERVE_PROBE_MAX_BUFFER,
    });
    const line = stdout.trim().split("\n")[0]?.trim();
    const spaceIndex = line?.indexOf(" ") ?? -1;
    if (!line || spaceIndex < 0) {
      return undefined;
    }

    const elapsedMs = parseProcessElapsedMs(line.slice(0, spaceIndex));
    const command = line.slice(spaceIndex + 1).trim();
    if (elapsedMs === undefined || !command) {
      return undefined;
    }

    return { elapsedMs, command };
  } catch {
    return undefined;
  }
}

async function readCodexBarServeProcessIdentity(now = Date.now()): Promise<CodexBarServeProcessIdentity | undefined> {
  const pid = await findCodexBarServePid();
  if (pid === undefined) {
    return undefined;
  }

  const processInfo = await readProcessElapsedAndCommand(pid);
  if (!processInfo) {
    return undefined;
  }

  return {
    pid,
    command: processInfo.command,
    startedAtMs: now - processInfo.elapsedMs,
  };
}

function isRecognizableCodexBarServe(processIdentity: CodexBarServeProcessIdentity): boolean {
  return processIdentity.command.toLowerCase().includes("codexbar");
}

// ADR-0006: a serve daemon started before the CLI binary was last replaced keeps
// serving the old version's payload shapes until restarted.
async function isCodexBarServeStale(
  binary: ResolvedCodexBarBinary,
  processIdentity: CodexBarServeProcessIdentity,
): Promise<boolean> {
  try {
    // stat follows symlinks, so a Homebrew symlink into the app bundle reports
    // the real helper binary's mtime.
    const { mtimeMs } = await stat(binary.command);
    return mtimeMs > processIdentity.startedAtMs;
  } catch {
    return false;
  }
}

export async function isCodexBarServeAttested(binary: ResolvedCodexBarBinary): Promise<boolean> {
  if (!(await isCodexBarServeHealthy())) {
    clearCodexBarServeRuntime();
    return false;
  }

  const [record, processIdentity] = [readCodexBarServeRuntime(), await readCodexBarServeProcessIdentity()];
  if (!record || !processIdentity || !isRecognizableCodexBarServe(processIdentity)) {
    clearCodexBarServeRuntime();
    return false;
  }

  if (!codexBarServeRuntimeMatches(record, processIdentity, binary.keychainAccessPolicy)) {
    return false;
  }

  return true;
}

async function stopCodexBarServe(pid: number): Promise<boolean> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }

  const deadline = Date.now() + CODEXBAR_SERVE_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await findCodexBarServePid()) !== pid) {
      return true;
    }

    await sleep(CODEXBAR_SERVE_STARTUP_POLL_MS);
  }

  return (await findCodexBarServePid()) !== pid;
}

export async function ensureCodexBarServe(binary: ResolvedCodexBarBinary): Promise<boolean> {
  const healthy = await isCodexBarServeHealthy();
  const processIdentity = await readCodexBarServeProcessIdentity();

  if (processIdentity && !isRecognizableCodexBarServe(processIdentity)) {
    clearCodexBarServeRuntime();
    return false;
  }

  if (healthy && processIdentity) {
    const record = readCodexBarServeRuntime();
    const policyMatches =
      record !== undefined && codexBarServeRuntimeMatches(record, processIdentity, binary.keychainAccessPolicy);
    const stale = await isCodexBarServeStale(binary, processIdentity);
    if (policyMatches && !stale) {
      return true;
    }
  }

  if (processIdentity) {
    if (!(await stopCodexBarServe(processIdentity.pid))) {
      clearCodexBarServeRuntime();
      return false;
    }
    clearCodexBarServeRuntime();
  } else if (healthy) {
    // A healthy listener whose process identity cannot be verified is never
    // stopped or used. Foreground/background callers fall back to one-shot.
    clearCodexBarServeRuntime();
    return false;
  }

  let serveStartupFailed = false;
  let startedPid: number | undefined;
  try {
    startedPid = startCodexBarServe(binary, () => {
      serveStartupFailed = true;
    });
  } catch {
    return false;
  }
  if (startedPid === undefined) {
    return false;
  }

  const deadline = Date.now() + CODEXBAR_SERVE_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (serveStartupFailed) {
      return false;
    }

    if (await isCodexBarServeHealthy()) {
      const startedProcessIdentity = await readCodexBarServeProcessIdentity();
      if (
        !startedProcessIdentity ||
        startedProcessIdentity.pid !== startedPid ||
        !isRecognizableCodexBarServe(startedProcessIdentity)
      ) {
        return false;
      }

      recordCodexBarServeRuntime(startedProcessIdentity, binary.keychainAccessPolicy);
      return true;
    }

    await sleep(CODEXBAR_SERVE_STARTUP_POLL_MS);
  }

  return false;
}

async function executeCodexBarServe(
  binary: ResolvedCodexBarBinary,
  providerId: string,
  options?: ProviderFetchOptions,
): Promise<unknown> {
  if (!(await isCodexBarServeAttested(binary))) {
    throw new Error("CodexBar serve is not attested for the current Keychain access policy.");
  }

  const params = new URLSearchParams({ provider: providerId });
  if (binary.capabilities?.serveAppFetchProfile) {
    params.set("fetchProfile", "app");
  }
  if (binary.capabilities?.interactionModes) {
    params.set("interaction", options?.interaction ?? "background");
  }
  if (options?.mode === "force" && binary.capabilities?.serveForceRefresh) {
    params.set("refresh", "true");
  }
  return requestCodexBarServeJson(`/usage?${params.toString()}`, CODEXBAR_SERVE_REQUEST_TIMEOUT_SECONDS * 1000);
}

async function fetchProviderDetailPayload(
  binary: ResolvedCodexBarBinary,
  providerId: string,
  options?: ProviderFetchOptions,
): Promise<unknown> {
  const usageCommandArgs = buildProviderUsageCommandArgs(providerId, {
    source: options?.source,
    interaction: options?.interaction,
    capabilities: binary.capabilities,
  });

  // Older CLIs without serve force-refresh always use a fresh one-shot command for forced refreshes.
  if (options?.mode === "force" && !binary.capabilities?.serveForceRefresh) {
    return executeCodexBar(binary, usageCommandArgs);
  }

  try {
    return await executeCodexBarServe(binary, providerId, options);
  } catch {
    // Serve is unavailable, unattested, or this request failed; fall through
    // to a fresh policy-guarded one-shot command.
  }

  // Foreground never starts serve (ADR-0002). When serve is unavailable, a one-shot CLI command
  // bypasses serve's response TTL and remains the negotiated force-refresh fallback.
  return executeCodexBar(binary, usageCommandArgs);
}

export async function smokeTestCodexBar(binary: ResolvedCodexBarBinary): Promise<void> {
  try {
    await execFileAsync(binary.command, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 64 * 1024,
      env: buildCodexBarProcessEnv(binary.keychainAccessPolicy),
    });
  } catch (error) {
    throw classifyExecFailure(error);
  }
}

export async function getCodexBarAvailability(
  keychainAccessPolicy: KeychainAccessPolicy,
): Promise<CodexBarAvailability> {
  if (isCodexBarMockMode()) {
    return {
      status: "available",
      binary: {
        command: "codexbar-mock",
        source: "mock",
        keychainAccessPolicy,
      },
    };
  }

  try {
    const binary = await resolveCodexBarBinary(keychainAccessPolicy);
    await smokeTestCodexBar(binary);
    const capabilities = await detectCodexBarCapabilities(binary);

    return {
      status: "available",
      binary: capabilities ? { ...binary, capabilities } : binary,
    };
  } catch (error) {
    if (error instanceof CodexBarCliError && error.kind === "unavailable") {
      // The app is looked for only here, and only to pick which help view
      // renders: app presence never gates usage, so standalone CLI installs
      // (Homebrew formula, release tarball) stay first-class.
      const [helperPath, homebrewPrefix] = await Promise.all([findCodexBarApp(), detectHomebrew()]);
      return {
        status: "unavailable",
        install: buildInstallHelp({ helperPath, homebrewPrefix }),
        error,
      };
    }

    return {
      status: "error",
      error: error instanceof Error ? error : new Error("Unknown CodexBar availability error"),
    };
  }
}

export async function fetchProviderDetail(
  binary: ResolvedCodexBarBinary,
  providerId: string,
  options?: ProviderFetchOptions,
): Promise<ProviderDetailData> {
  const normalizedProviderId = assertFetchableProviderId(providerId);
  return withProviderFetchErrorHint(binary, async () => {
    if (binary.source === "mock" || isCodexBarMockMode()) {
      return withRequestMetadata(
        normalizeProviderDetailPayload(getMockProviderPayload(normalizedProviderId), normalizedProviderId),
        options?.source,
      );
    }

    const payload = await fetchProviderDetailPayload(binary, normalizedProviderId, options);
    // Graft remembered sections (ADR-0007): flaky upstream payloads must not drop meters.
    const detail = applyProviderUsageSectionMemory(
      normalizeProviderDetailResponse(payload, normalizedProviderId),
      binary.keychainAccessPolicy,
    );
    return withRequestMetadata(detail, options?.source);
  });
}

export async function fetchProviderDetailFromServe(
  binary: ResolvedCodexBarBinary,
  providerId: string,
  options?: ProviderFetchOptions,
): Promise<ProviderDetailData> {
  const normalizedProviderId = assertFetchableProviderId(providerId);
  return withProviderFetchErrorHint(binary, async () => {
    if (binary.source === "mock" || isCodexBarMockMode()) {
      return withRequestMetadata(
        normalizeProviderDetailPayload(getMockProviderPayload(normalizedProviderId), normalizedProviderId),
        options?.source,
      );
    }

    const payload = await executeCodexBarServe(binary, normalizedProviderId, options);
    const detail = applyProviderUsageSectionMemory(
      normalizeProviderDetailResponse(payload, normalizedProviderId),
      binary.keychainAccessPolicy,
    );
    return withRequestMetadata(detail, options?.source);
  });
}

export async function fetchProviderDetailFromUsageCommand(
  binary: ResolvedCodexBarBinary,
  providerId: string,
  options?: ProviderFetchOptions,
): Promise<ProviderDetailData> {
  const normalizedProviderId = assertFetchableProviderId(providerId);
  return withProviderFetchErrorHint(binary, async () => {
    if (binary.source === "mock" || isCodexBarMockMode()) {
      return withRequestMetadata(
        normalizeProviderDetailPayload(getMockProviderPayload(normalizedProviderId), normalizedProviderId),
        options?.source,
      );
    }

    const payload = await executeCodexBar(
      binary,
      buildProviderUsageCommandArgs(normalizedProviderId, {
        source: options?.source,
        interaction: options?.interaction,
        capabilities: binary.capabilities,
      }),
    );
    const detail = applyProviderUsageSectionMemory(
      normalizeProviderDetailResponse(payload, normalizedProviderId),
      binary.keychainAccessPolicy,
    );
    return withRequestMetadata(detail, options?.source);
  });
}

export type ProviderUsageWithStatus = {
  detail: ProviderDetailData;
  status?: ProviderStatus;
};

// One-shot usage+status. Used by background refresh when serve is cold.
export async function fetchProviderUsageWithStatus(
  binary: ResolvedCodexBarBinary,
  providerId: string,
  options?: ProviderFetchOptions,
): Promise<ProviderUsageWithStatus> {
  const normalizedProviderId = assertFetchableProviderId(providerId);
  return withProviderFetchErrorHint(binary, async () => {
    if (binary.source === "mock" || isCodexBarMockMode()) {
      const payload = getMockProviderPayload(normalizedProviderId);
      return {
        detail: withRequestMetadata(normalizeProviderDetailPayload(payload, normalizedProviderId), options?.source),
        status: extractProviderStatus(payload, normalizedProviderId),
      };
    }

    const payload = await executeCodexBar(
      binary,
      buildProviderUsageCommandArgs(normalizedProviderId, {
        includeStatus: true,
        source: options?.source,
        interaction: options?.interaction,
        capabilities: binary.capabilities,
      }),
    );
    const status = extractProviderStatus(payload, normalizedProviderId);
    const normalizedDetail = applyProviderUsageSectionMemory(
      normalizeProviderDetailResponse(payload, normalizedProviderId),
      binary.keychainAccessPolicy,
    );
    const detail = withRequestMetadata(normalizedDetail, options?.source);
    return { detail, status };
  });
}

function assertFetchableProviderId(providerId: string): string {
  const normalizedProviderId = providerId.trim();
  if (!normalizedProviderId || isProviderSelectorId(normalizedProviderId)) {
    throw new CodexBarCliError("execution", "Cannot fetch provider detail without an enabled provider id.");
  }

  return normalizedProviderId;
}

function normalizeProviderDetailResponse(payload: unknown, providerId: string): ProviderDetailData {
  const providerError = extractProviderErrorMessage(payload, providerId);
  if (providerError) {
    throw new CodexBarCliError("execution", providerError);
  }

  return normalizeProviderDetailPayload(payload, providerId);
}

function withRequestMetadata(detail: ProviderDetailData, requestedSource?: ProviderSourceMode): ProviderDetailData {
  return { ...detail, requestedSource: requestedSource ?? "auto" };
}

function buildProviderUsageCommandArgs(
  providerId: string,
  options?: {
    includeStatus?: boolean;
    source?: ProviderSourceMode;
    interaction?: ProviderInteractionMode;
    capabilities?: CodexBarCapabilities;
  },
): string[] {
  const capabilities = options?.capabilities;
  return [
    "usage",
    "--format",
    "json",
    "--json-only",
    "--json-output",
    "--web-timeout",
    `${CODEXBAR_WEB_TIMEOUT_MS / 1000}`,
    ...(options?.includeStatus ? ["--status"] : []),
    ...(capabilities?.appFetchProfile ? ["--fetch-profile", "app"] : []),
    ...(capabilities?.appFetchProfile && capabilities.interactionModes
      ? ["--interaction", options?.interaction ?? "background"]
      : []),
    "--provider",
    providerId,
    "--source",
    options?.source ?? "auto",
  ];
}
