import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { homedir, userInfo } from "node:os";
import { delimiter, join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { getProviderMetadata, isKnownProviderId, isProviderSelectorId, resolveProviderId } from "../providers/registry";
import { extractProviderErrorMessage, normalizeProviderDetailPayload } from "../providers/normalize";
import type { ConfiguredProvider, ProviderDetailData } from "../providers/types";
import { getMockProviderPayload, isCodexBarMockMode } from "../mocks/codexbar";

const CODEXBAR_TIMEOUT_MS = 60_000;
const CODEXBAR_WEB_TIMEOUT_MS = 5_000;
const CODEXBAR_SERVE_HOST = "127.0.0.1";
const CODEXBAR_SERVE_PORT = 17_653;
const CODEXBAR_SERVE_REFRESH_INTERVAL_SECONDS = 60;
const CODEXBAR_SERVE_REQUEST_TIMEOUT_SECONDS = 30;
const CODEXBAR_SERVE_HEALTH_TIMEOUT_MS = 500;
const CODEXBAR_SERVE_STARTUP_TIMEOUT_MS = 1_500;
const CODEXBAR_SERVE_STARTUP_POLL_MS = 150;
const MAX_BUFFER_BYTES = 5 * 1024 * 1024;
const DEFAULT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const FALLBACK_PATHS = ["/opt/homebrew/bin/codexbar", "/usr/local/bin/codexbar"] as const;
const CONFIG_PATH = join(homedir(), ".codexbar", "config.json");
const HOMEBREW_INSTALL_COMMAND = "brew install steipete/tap/codexbar";

export type ResolvedCodexBarBinary = {
  command: string;
  source: "path" | "fallback" | "mock";
};

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

export type InstallHelpState = {
  markdown: string;
  title: string;
  docsUrl: string;
  releasesUrl: string;
  repositoryUrl: string;
  homebrewCommand?: string;
};

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

type CodexBarConfig = {
  providers?: CodexBarConfigProvider[] | Record<string, CodexBarConfigProvider>;
};

type CodexBarConfigProvider = {
  id?: string;
  enabled?: boolean;
};

export type ProviderMoveDirection = "up" | "down";

const INSTALL_HELP: InstallHelpState = {
  title: "Install CodexBar CLI",
  docsUrl: "https://github.com/steipete/CodexBar/blob/main/docs/cli.md",
  releasesUrl: "https://github.com/steipete/CodexBar/releases",
  repositoryUrl: "https://github.com/steipete/CodexBar",
  homebrewCommand: HOMEBREW_INSTALL_COMMAND,
  markdown: [
    "# Install CodexBar CLI",
    "",
    "CodexBar for Raycast expects the official `codexbar` CLI to already be installed and configured.",
    "",
    "## macOS",
    "",
    "1. Open the CodexBar app.",
    "2. Go to **Preferences -> Advanced -> Install CLI**.",
    "3. Reopen this command in Raycast.",
    "",
    "CodexBar can also be installed from the repo with `./bin/install-codexbar-cli.sh` or by symlinking `CodexBarCLI` manually.",
    "",
    "## Linux",
    "",
    `- Homebrew (Linux only): \`${HOMEBREW_INSTALL_COMMAND}\``,
    "- GitHub Releases: download the CodexBarCLI tarball for your architecture.",
    "",
    "## Links",
    "",
    "- [CLI docs](https://github.com/steipete/CodexBar/blob/main/docs/cli.md)",
    "- [GitHub Releases](https://github.com/steipete/CodexBar/releases)",
    "- [Repository](https://github.com/steipete/CodexBar)",
  ].join("\n"),
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

function buildCodexBarProcessEnv(): NodeJS.ProcessEnv {
  const currentUser = userInfo();
  const username = process.env.USER || process.env.LOGNAME || currentUser.username;

  return {
    ...process.env,
    HOME: process.env.HOME || currentUser.homedir || homedir(),
    USER: username,
    LOGNAME: process.env.LOGNAME || username,
    SHELL: process.env.SHELL || currentUser.shell || "/bin/zsh",
    PATH: process.env.PATH || DEFAULT_PATH,
  };
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

export async function resolveCodexBarBinary(): Promise<ResolvedCodexBarBinary> {
  const fromPath = await findInPath("codexbar");
  if (fromPath) {
    return {
      command: fromPath,
      source: "path",
    };
  }

  for (const fallbackPath of FALLBACK_PATHS) {
    if (await isExecutablePath(fallbackPath)) {
      return {
        command: fallbackPath,
        source: "fallback",
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

  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const directMessage =
    (typeof record.message === "string" && record.message) ||
    (typeof record.error === "string" && record.error) ||
    (typeof record.detail === "string" && record.detail);
  if (directMessage) {
    return directMessage;
  }

  const nestedError = record.error;
  if (nestedError && typeof nestedError === "object") {
    const nested = nestedError as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message) {
      return nested.message;
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

async function executeCodexBar(binary: ResolvedCodexBarBinary, args: string[]): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync(binary.command, args, {
      encoding: "utf8",
      timeout: CODEXBAR_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
      env: buildCodexBarProcessEnv(),
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
    return Boolean(payload && typeof payload === "object" && (payload as Record<string, unknown>).status === "ok");
  } catch {
    return false;
  }
}

function startCodexBarServe(binary: ResolvedCodexBarBinary, onError: (error: Error) => void): void {
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
      env: buildCodexBarProcessEnv(),
    },
  );
  child.once("error", onError);
  child.unref();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function ensureCodexBarServe(binary: ResolvedCodexBarBinary): Promise<boolean> {
  if (await isCodexBarServeHealthy()) {
    return true;
  }

  let serveStartupFailed = false;
  try {
    startCodexBarServe(binary, () => {
      serveStartupFailed = true;
    });
  } catch {
    return false;
  }

  const deadline = Date.now() + CODEXBAR_SERVE_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (serveStartupFailed) {
      return false;
    }

    if (await isCodexBarServeHealthy()) {
      return true;
    }

    await sleep(CODEXBAR_SERVE_STARTUP_POLL_MS);
  }

  return false;
}

async function executeCodexBarServe(providerId: string): Promise<unknown> {
  return requestCodexBarServeJson(
    `/usage?provider=${encodeURIComponent(providerId)}`,
    CODEXBAR_SERVE_REQUEST_TIMEOUT_SECONDS * 1000,
  );
}

async function fetchProviderDetailPayload(binary: ResolvedCodexBarBinary, providerId: string): Promise<unknown> {
  const usageCommandArgs = buildProviderUsageCommandArgs(providerId);

  if (await isCodexBarServeHealthy()) {
    try {
      return await executeCodexBarServe(providerId);
    } catch {
      return executeCodexBar(binary, usageCommandArgs);
    }
  }

  return executeCodexBar(binary, usageCommandArgs);
}

export async function smokeTestCodexBar(binary: ResolvedCodexBarBinary): Promise<void> {
  try {
    await execFileAsync(binary.command, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 64 * 1024,
      env: buildCodexBarProcessEnv(),
    });
  } catch (error) {
    throw classifyExecFailure(error);
  }
}

export async function getCodexBarAvailability(): Promise<CodexBarAvailability> {
  if (isCodexBarMockMode()) {
    return {
      status: "available",
      binary: {
        command: "codexbar-mock",
        source: "mock",
      },
    };
  }

  try {
    const binary = await resolveCodexBarBinary();
    await smokeTestCodexBar(binary);

    return {
      status: "available",
      binary,
    };
  } catch (error) {
    if (error instanceof CodexBarCliError && error.kind === "unavailable") {
      return {
        status: "unavailable",
        install: INSTALL_HELP,
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
): Promise<ProviderDetailData> {
  const normalizedProviderId = assertFetchableProviderId(providerId);

  if (binary.source === "mock" || isCodexBarMockMode()) {
    return normalizeProviderDetailPayload(getMockProviderPayload(normalizedProviderId), normalizedProviderId);
  }

  const payload = await fetchProviderDetailPayload(binary, normalizedProviderId);
  return normalizeProviderDetailResponse(payload, normalizedProviderId);
}

export async function fetchProviderDetailFromServe(
  binary: ResolvedCodexBarBinary,
  providerId: string,
): Promise<ProviderDetailData> {
  const normalizedProviderId = assertFetchableProviderId(providerId);

  if (binary.source === "mock" || isCodexBarMockMode()) {
    return normalizeProviderDetailPayload(getMockProviderPayload(normalizedProviderId), normalizedProviderId);
  }

  const payload = await executeCodexBarServe(normalizedProviderId);
  return normalizeProviderDetailResponse(payload, normalizedProviderId);
}

export async function fetchProviderDetailFromUsageCommand(
  binary: ResolvedCodexBarBinary,
  providerId: string,
): Promise<ProviderDetailData> {
  const normalizedProviderId = assertFetchableProviderId(providerId);

  if (binary.source === "mock" || isCodexBarMockMode()) {
    return normalizeProviderDetailPayload(getMockProviderPayload(normalizedProviderId), normalizedProviderId);
  }

  const payload = await executeCodexBar(binary, buildProviderUsageCommandArgs(normalizedProviderId));
  return normalizeProviderDetailResponse(payload, normalizedProviderId);
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

function buildProviderUsageCommandArgs(providerId: string): string[] {
  return [
    "usage",
    "--format",
    "json",
    "--json-only",
    "--json-output",
    "--web-timeout",
    `${CODEXBAR_WEB_TIMEOUT_MS / 1000}`,
    "--provider",
    providerId,
    "--source",
    "auto",
  ];
}

export async function readConfiguredProvidersFromConfig(): Promise<ConfiguredProvider[]> {
  try {
    const rawConfig = await readFile(CONFIG_PATH, "utf8");
    return extractConfiguredProvidersFromConfig(rawConfig);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      throw new Error(`CodexBar config was not found at ${CONFIG_PATH}.`);
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse CodexBar config at ${CONFIG_PATH}.`);
    }

    if (error instanceof Error) {
      throw new Error(`Failed to read CodexBar config at ${CONFIG_PATH}: ${error.message}`);
    }

    throw new Error(`Failed to read CodexBar config at ${CONFIG_PATH}.`);
  }
}

export async function moveConfiguredProviderInConfig(
  providerId: string,
  direction: ProviderMoveDirection,
): Promise<boolean> {
  try {
    const rawConfig = await readFile(CONFIG_PATH, "utf8");
    const updatedConfig = moveConfiguredProviderInRawConfig(rawConfig, providerId, direction);
    if (!updatedConfig) {
      return false;
    }

    await writeFile(CONFIG_PATH, updatedConfig, "utf8");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      throw new Error(`CodexBar config was not found at ${CONFIG_PATH}.`);
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse CodexBar config at ${CONFIG_PATH}.`);
    }

    if (error instanceof Error) {
      throw new Error(`Failed to update CodexBar config at ${CONFIG_PATH}: ${error.message}`);
    }

    throw new Error(`Failed to update CodexBar config at ${CONFIG_PATH}.`);
  }
}

export function moveConfiguredProviderInRawConfig(
  rawConfig: string,
  providerId: string,
  direction: ProviderMoveDirection,
): string | undefined {
  const parsedConfig = JSON.parse(rawConfig) as CodexBarConfig;
  const movedConfig = moveConfiguredProviderInParsedConfig(parsedConfig, providerId, direction);
  if (!movedConfig) {
    return undefined;
  }

  return `${JSON.stringify(movedConfig, null, 2)}\n`;
}

function extractConfiguredProvidersFromConfig(rawConfig: string): ConfiguredProvider[] {
  const parsedConfig = JSON.parse(rawConfig) as CodexBarConfig;
  const providers = normalizeConfiguredProviders(parsedConfig);

  const seenProviderIds = new Set<string>();

  return providers
    .filter(
      (provider): provider is { id: string; enabled: true } =>
        typeof provider.id === "string" && provider.id.trim().length > 0 && provider.enabled === true,
    )
    .map((provider) => provider.id.trim())
    .filter((providerId) => !isProviderSelectorId(providerId) && isKnownProviderId(providerId))
    .filter((providerId) => {
      const canonicalId = resolveProviderId(providerId);
      if (seenProviderIds.has(canonicalId)) {
        return false;
      }

      seenProviderIds.add(canonicalId);
      return true;
    })
    .map((providerId) => {
      const metadata = getProviderMetadata(providerId);
      return {
        id: metadata.id,
        name: metadata.name,
        icon: metadata.icon,
        keywords: [metadata.id],
      };
    });
}

function normalizeConfiguredProviders(config: CodexBarConfig): CodexBarConfigProvider[] {
  if (Array.isArray(config.providers)) {
    return config.providers;
  }

  if (!config.providers || typeof config.providers !== "object") {
    return [];
  }

  return Object.entries(config.providers).map(([providerId, provider]) => ({
    ...provider,
    id: typeof provider.id === "string" && provider.id.trim().length > 0 ? provider.id : providerId,
  }));
}

function moveConfiguredProviderInParsedConfig(
  config: CodexBarConfig,
  providerId: string,
  direction: ProviderMoveDirection,
): CodexBarConfig | undefined {
  const normalizedProviderId = providerId.trim();
  if (!normalizedProviderId) {
    return undefined;
  }

  if (Array.isArray(config.providers)) {
    const moveIndexes = findConfiguredProviderMoveIndexes(
      config.providers.map((provider) => ({ id: normalizeArrayProviderId(provider), provider })),
      normalizedProviderId,
      direction,
    );
    if (!moveIndexes) {
      return undefined;
    }

    return {
      ...config,
      providers: swapEntries(config.providers, moveIndexes.from, moveIndexes.to),
    };
  }

  if (!config.providers || typeof config.providers !== "object") {
    return undefined;
  }

  const providerEntries = Object.entries(config.providers);
  const moveIndexes = findConfiguredProviderMoveIndexes(
    providerEntries.map(([key, provider]) => ({
      id: normalizeObjectProviderId(key, provider),
      provider,
    })),
    normalizedProviderId,
    direction,
  );
  if (!moveIndexes) {
    return undefined;
  }

  return {
    ...config,
    providers: Object.fromEntries(swapEntries(providerEntries, moveIndexes.from, moveIndexes.to)),
  };
}

function findConfiguredProviderMoveIndexes(
  providers: Array<{ id?: string; provider?: CodexBarConfigProvider }>,
  providerId: string,
  direction: ProviderMoveDirection,
): { from: number; to: number } | undefined {
  const visibleProviders = providers.flatMap(({ id, provider }, index) => {
    if (!id || provider?.enabled !== true || isProviderSelectorId(id) || !isKnownProviderId(id)) {
      return [];
    }

    return [{ id, index }];
  });

  const currentVisibleIndex = visibleProviders.findIndex(
    (provider) => resolveProviderId(provider.id) === resolveProviderId(providerId),
  );
  if (currentVisibleIndex < 0) {
    return undefined;
  }

  const targetVisibleIndex = currentVisibleIndex + (direction === "up" ? -1 : 1);
  const targetProvider = visibleProviders[targetVisibleIndex];
  if (!targetProvider) {
    return undefined;
  }

  return {
    from: visibleProviders[currentVisibleIndex].index,
    to: targetProvider.index,
  };
}

function normalizeArrayProviderId(provider: CodexBarConfigProvider | undefined): string | undefined {
  return typeof provider?.id === "string" && provider.id.trim().length > 0 ? provider.id.trim() : undefined;
}

function normalizeObjectProviderId(providerId: string, provider: CodexBarConfigProvider | undefined): string {
  return typeof provider?.id === "string" && provider.id.trim().length > 0 ? provider.id.trim() : providerId;
}

function swapEntries<T>(entries: T[], from: number, to: number): T[] {
  const nextEntries = [...entries];
  const movedEntry = nextEntries[from];
  nextEntries[from] = nextEntries[to];
  nextEntries[to] = movedEntry;
  return nextEntries;
}
