import { Cache, Color, Icon } from "@raycast/api";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { accessMock, readFileMock, writeFileMock, statMock, execFileMock, spawnMock, httpRequestMock } = vi.hoisted(
  () => {
    return {
      accessMock: vi.fn(),
      readFileMock: vi.fn(),
      writeFileMock: vi.fn(),
      statMock: vi.fn(),
      execFileMock: vi.fn(),
      spawnMock: vi.fn(),
      httpRequestMock: vi.fn(),
    };
  },
);

vi.mock("node:fs/promises", () => ({
  access: accessMock,
  readFile: readFileMock,
  writeFile: writeFileMock,
  stat: statMock,
  // Imported by cliInstall.ts; only exercised there (against real temp dirs).
  readlink: vi.fn(),
  symlink: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}));

vi.mock("node:http", () => ({
  request: httpRequestMock,
}));

import {
  classifyExecFailure,
  CodexBarCliError,
  ensureCodexBarServe,
  extractJsonPayload,
  parseProcessElapsedMs,
  fetchProviderDetail,
  fetchProviderDetailFromServe,
  fetchProviderUsageWithStatus,
  getCodexBarAvailability,
  resolveCodexBarBinary,
  type ResolvedCodexBarBinary,
} from "./codexbar";
import {
  listAvailableProviders,
  moveConfiguredProviderInConfig,
  moveConfiguredProviderInRawConfig,
  normalizeAvailableProviders,
  orderEnabledProvidersByConfig,
  readConfiguredProvidersFromConfig,
  setProviderEnabled,
} from "./providerConfig";
import { refreshUsageCache } from "./backgroundRefresh";
import { SECTION_MEMORY_TTL_MS } from "./providerShapeMemory";
import { cacheProviderStatus, readProviderStatus } from "./providerStatusCache";
import { buildCachedProviderResults } from "./providerDetailCache";
import { recordCodexBarServeRuntime } from "./codexBarServeState";
import { CODEXBAR_DISABLE_KEYCHAIN_ACCESS_ENV } from "./keychainAccessPolicy";

function mockAccessForPaths(paths: string[]) {
  accessMock.mockImplementation((targetPath: string) => {
    if (paths.includes(targetPath)) {
      return Promise.resolve(undefined);
    }

    return Promise.reject(new Error("missing"));
  });
}

function mockExecSuccess(stdout = "CodexBar", stderr = "") {
  execFileMock.mockImplementation(
    (
      _command: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, stdout, stderr);
    },
  );
}

function makeMockChildProcess(pid = 6000) {
  return Object.assign(new EventEmitter(), { pid, unref: vi.fn() });
}

function mockServeProcessProbes(options: { pid?: string | string[]; etimeAndComm?: string | string[] }) {
  const fallback = execFileMock.getMockImplementation();
  const pids = Array.isArray(options.pid) ? [...options.pid] : [options.pid ?? ""];
  const processInfos = Array.isArray(options.etimeAndComm) ? [...options.etimeAndComm] : [options.etimeAndComm ?? ""];
  const next = (values: string[]) => (values.length > 1 ? values.shift() : values[0]) ?? "";

  execFileMock.mockImplementation(
    (
      command: string,
      args: string[],
      execOptions: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      if (command === "lsof") {
        callback(null, next(pids), "");
        return;
      }

      if (command === "ps") {
        callback(null, next(processInfos), "");
        return;
      }

      if (fallback) {
        fallback(command, args, execOptions, callback);
        return;
      }

      callback(new Error(`unexpected command: ${command}`), "", "");
    },
  );
}

function attestServeProcess(
  policy: "default" | "disabled" = "default",
  options: { pid?: number; command?: string; elapsedMs?: number } = {},
) {
  const pid = options.pid ?? 4968;
  const command = options.command ?? "/usr/local/bin/codexbar";
  const elapsedMs = options.elapsedMs ?? 5_000;
  const elapsedSeconds = Math.floor(elapsedMs / 1_000);
  const hours = Math.floor(elapsedSeconds / 3_600);
  const minutes = Math.floor((elapsedSeconds % 3_600) / 60);
  const seconds = elapsedSeconds % 60;
  const elapsed =
    hours > 0
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  recordCodexBarServeRuntime({ pid, command, startedAtMs: Date.now() - elapsedMs }, policy);
  mockServeProcessProbes({ pid: `${pid}\n`, etimeAndComm: `${elapsed} ${command}\n` });
}

function mockServeUnavailable() {
  httpRequestMock.mockImplementation(() => {
    const req = {
      destroy: vi.fn(),
      end: vi.fn(),
      on: vi.fn((event: string, handler: (error: Error) => void) => {
        if (event === "error") {
          queueMicrotask(() => handler(new Error("connect ECONNREFUSED")));
        }
        return req;
      }),
    };

    return req;
  });
}

function mockServeResponses(...responses: Array<unknown | Error>) {
  const pendingResponses = [...responses];
  httpRequestMock.mockImplementation(
    (_options: unknown, callback: (response: EventEmitter & { statusCode: number }) => void) => {
      const response = pendingResponses.shift();
      const req = {
        destroy: vi.fn(),
        end: vi.fn(),
        on: vi.fn((event: string, handler: (error: Error) => void) => {
          if (event === "error" && response instanceof Error) {
            queueMicrotask(() => handler(response));
          }
          return req;
        }),
      };

      if (!(response instanceof Error)) {
        const res = Object.assign(new EventEmitter(), { statusCode: 200 });
        queueMicrotask(() => {
          callback(res);
          res.emit("data", Buffer.from(JSON.stringify(response)));
          res.emit("end");
        });
      }

      return req;
    },
  );
}

describe("codexbar runtime helpers", () => {
  beforeEach(() => {
    accessMock.mockReset();
    readFileMock.mockReset();
    writeFileMock.mockReset();
    statMock.mockReset();
    execFileMock.mockReset();
    spawnMock.mockReset();
    httpRequestMock.mockReset();
    new Cache({ namespace: "provider-details" }).clear();
    new Cache({ namespace: "provider-status" }).clear();
    new Cache({ namespace: "provider-shape-memory" }).clear();
    new Cache({ namespace: "codexbar-serve-runtime" }).clear();
    readFileMock.mockRejectedValue(new Error("missing"));
    writeFileMock.mockResolvedValue(undefined);
    statMock.mockRejectedValue(new Error("missing"));
    spawnMock.mockImplementation(() => {
      throw new Error("serve unavailable");
    });
    execFileMock.mockImplementation(
      (
        command: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => callback(new Error(`unmocked command: ${command}`), "", ""),
    );
    mockServeUnavailable();
  });

  it("resolves the CLI from PATH before fallback locations", async () => {
    vi.stubEnv("PATH", "/usr/local/bin:/bin");
    mockAccessForPaths(["/usr/local/bin/codexbar"]);

    await expect(resolveCodexBarBinary("default")).resolves.toEqual({
      command: "/usr/local/bin/codexbar",
      source: "path",
      keychainAccessPolicy: "default",
    });
  });

  it("falls back to official macOS install locations when PATH misses", async () => {
    vi.stubEnv("PATH", "/bin");
    mockAccessForPaths(["/opt/homebrew/bin/codexbar"]);

    await expect(resolveCodexBarBinary("default")).resolves.toEqual({
      command: "/opt/homebrew/bin/codexbar",
      source: "fallback",
      keychainAccessPolicy: "default",
    });
  });

  it("returns app-missing install help when neither the CLI nor the CodexBar app is found", async () => {
    vi.stubEnv("PATH", "/bin");
    mockAccessForPaths([]);

    const availability = await getCodexBarAvailability("default");

    expect(availability.status).toBe("unavailable");
    if (availability.status === "unavailable") {
      expect(availability.install.kind).toBe("app-missing");
      expect(availability.install.docsUrl).toContain("docs/cli.md");
      expect(availability.install.markdown).toContain("Install CodexBar CLI");
      if (availability.install.kind === "app-missing") {
        // No Homebrew on this machine, so no copyable brew commands.
        expect(availability.install.homebrewCommands).toBeUndefined();
      }
    }
  });

  it("includes both Homebrew commands in app-missing install help when brew is present", async () => {
    vi.stubEnv("PATH", "/bin");
    mockAccessForPaths(["/opt/homebrew/bin/brew"]);

    const availability = await getCodexBarAvailability("default");

    expect(availability.status).toBe("unavailable");
    if (availability.status === "unavailable") {
      expect(availability.install.kind).toBe("app-missing");
      if (availability.install.kind === "app-missing") {
        expect(availability.install.homebrewCommands).toEqual({
          appAndCli: "brew install --cask steipete/tap/codexbar",
          cliOnly: "brew install --formula steipete/tap/codexbar",
        });
      }
    }
  });

  it("returns cli-missing install help offering extension-run setup when the CodexBar app is installed", async () => {
    vi.stubEnv("PATH", "/bin");
    mockAccessForPaths(["/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI"]);

    const availability = await getCodexBarAvailability("default");

    expect(availability.status).toBe("unavailable");
    if (availability.status === "unavailable") {
      expect(availability.install.kind).toBe("cli-missing");
      if (availability.install.kind === "cli-missing") {
        expect(availability.install.helperPath).toBe("/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI");
        // Paths never surface in UI copy — only in the Copy Details payload.
        expect(availability.install.markdown).not.toContain("/Applications");
      }
    }
  });

  it("classifies spawn failures as unavailable", () => {
    const error = Object.assign(new Error("spawn codexbar ENOENT"), {
      code: "ENOENT",
      stderr: "",
      stdout: "",
    });

    const classified = classifyExecFailure(error);

    expect(classified).toBeInstanceOf(CodexBarCliError);
    expect(classified.kind).toBe("unavailable");
  });

  it("classifies killed executions as timeout", () => {
    const error = Object.assign(new Error("timed out"), {
      killed: true,
      stdout: "",
      stderr: "slow provider",
    });

    expect(classifyExecFailure(error).kind).toBe("timeout");
  });

  it("reports available status when the binary resolves and smoke test passes", async () => {
    vi.stubEnv("PATH", "/usr/local/bin");
    mockAccessForPaths(["/usr/local/bin/codexbar"]);
    mockExecSuccess("CodexBar\n");

    const availability = await getCodexBarAvailability("default");

    expect(availability.status).toBe("available");
    if (availability.status === "available") {
      expect(availability.binary.command).toBe("/usr/local/bin/codexbar");
    }
  });

  it("guards every availability probe when Keychain access is disabled", async () => {
    vi.stubEnv("PATH", "/usr/local/bin");
    mockAccessForPaths(["/usr/local/bin/codexbar"]);
    mockExecSuccess("CodexBar\n");

    await expect(getCodexBarAvailability("disabled")).resolves.toMatchObject({ status: "available" });

    for (const call of execFileMock.mock.calls) {
      expect(call[2]).toMatchObject({
        env: expect.objectContaining({ [CODEXBAR_DISABLE_KEYCHAIN_ACCESS_ENV]: "1" }),
      });
    }
  });

  it("discovers serve-only capabilities from a supporting CLI", async () => {
    vi.stubEnv("PATH", "/usr/local/bin");
    mockAccessForPaths(["/usr/local/bin/codexbar"]);
    execFileMock.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (args[0] === "--version") {
          callback(null, "CodexBar 0.42.0\n", "");
          return;
        }
        callback(
          null,
          JSON.stringify({
            fetchProfiles: ["cli"],
            serve: { fetchProfile: true, forceRefresh: true },
          }),
          "",
        );
      },
    );

    await expect(getCodexBarAvailability("default")).resolves.toMatchObject({
      status: "available",
      binary: {
        capabilities: {
          appFetchProfile: false,
          interactionModes: false,
          presentationSchemaVersions: [],
          serveAppFetchProfile: true,
          serveForceRefresh: true,
        },
      },
    });
  });

  it("discovers GUI-parity capabilities from a supporting CLI", async () => {
    vi.stubEnv("PATH", "/usr/local/bin");
    mockAccessForPaths(["/usr/local/bin/codexbar"]);
    execFileMock.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (args[0] === "--version") {
          callback(null, "CodexBar 0.42.0\n", "");
          return;
        }
        callback(
          null,
          JSON.stringify({
            fetchProfiles: ["cli", "app"],
            interactionModes: ["background", "user"],
            presentationSchemaVersions: [1],
            serve: { fetchProfile: true, forceRefresh: true },
          }),
          "",
        );
      },
    );

    await expect(getCodexBarAvailability("default")).resolves.toMatchObject({
      status: "available",
      binary: {
        capabilities: {
          appFetchProfile: true,
          interactionModes: true,
          presentationSchemaVersions: [1],
          serveAppFetchProfile: true,
          serveForceRefresh: true,
        },
      },
    });
  });

  it("prefers CodexBar serve for provider detail fetches when available", async () => {
    attestServeProcess();
    mockServeResponses({ status: "ok" }, { provider: "codex", usage: { primary: { usedPercent: 20 } } });

    await expect(
      fetchProviderDetail(
        { command: "/usr/local/bin/codexbar", source: "path", keychainAccessPolicy: "default" },
        "codex",
      ),
    ).resolves.toMatchObject({
      id: "codex",
      sections: [{ kind: "usage", title: "Primary", displayTitle: "Session", remainingPercent: 80 }],
    });

    expect(httpRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "127.0.0.1", path: "/health", port: 17653 }),
      expect.any(Function),
    );
    expect(httpRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "127.0.0.1", path: "/usage?provider=codex", port: 17653 }),
      expect.any(Function),
    );
    expect(spawnMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalledWith(
      "/usr/local/bin/codexbar",
      expect.any(Array),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("falls back to one-shot usage without starting serve when foreground health check misses", async () => {
    mockExecSuccess('{"provider":"codex","usage":{"primary":{"usedPercent":20}}}');
    mockServeResponses(new Error("connect ECONNREFUSED"));

    await fetchProviderDetail(
      { command: "/usr/local/bin/codexbar", source: "path", keychainAccessPolicy: "default" },
      "codex",
    );

    expect(spawnMock).not.toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledWith(
      "/usr/local/bin/codexbar",
      expect.arrayContaining(["usage", "--provider", "codex", "--source", "auto"]),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("guards one-shot provider fetches and appends the strict-policy authentication hint", async () => {
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => callback(new Error("provider failed"), '{"error":"No usable credentials."}', "provider failed"),
    );

    const fetch = fetchProviderDetail(
      { command: "/usr/local/bin/codexbar", source: "path", keychainAccessPolicy: "disabled" },
      "claude",
      { mode: "force" },
    );

    await expect(fetch).rejects.toThrow(
      "No usable credentials.\n\nKeychain access is disabled. This Provider may require another authentication source.\n\nConfigure it in the CodexBar app or allow Keychain access and retry.",
    );
    expect(execFileMock.mock.calls[0]?.[2]).toMatchObject({
      env: expect.objectContaining({ [CODEXBAR_DISABLE_KEYCHAIN_ACCESS_ENV]: "1" }),
    });
  });

  it("bypasses CodexBar serve for forced provider detail fetches", async () => {
    mockExecSuccess('{"provider":"codex","usage":{"primary":{"usedPercent":20}}}');
    mockServeResponses({ status: "ok" }, { provider: "codex", usage: { primary: { usedPercent: 99 } } });

    await expect(
      fetchProviderDetail(
        { command: "/usr/local/bin/codexbar", source: "path", keychainAccessPolicy: "default" },
        "codex",
        { mode: "force" },
      ),
    ).resolves.toMatchObject({
      id: "codex",
      sections: [{ kind: "usage", title: "Primary", displayTitle: "Session", remainingPercent: 80 }],
    });

    expect(httpRequestMock).not.toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledWith(
      "/usr/local/bin/codexbar",
      expect.arrayContaining(["usage", "--provider", "codex", "--source", "auto"]),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("uses GUI profile, configured source, and forced serve refresh when supported", async () => {
    const binary: ResolvedCodexBarBinary = {
      command: "/usr/local/bin/codexbar",
      source: "path",
      keychainAccessPolicy: "default",
      capabilities: {
        appFetchProfile: true,
        interactionModes: true,
        presentationSchemaVersions: [1],
        serveAppFetchProfile: true,
        serveForceRefresh: true,
      },
    };
    attestServeProcess();
    mockServeResponses(
      { status: "ok" },
      { provider: "claude", source: "oauth", presentation: { schemaVersion: 1, meters: [] } },
    );

    await expect(
      fetchProviderDetail(binary, "claude", { mode: "force", source: "web", interaction: "user" }),
    ).resolves.toMatchObject({
      id: "claude",
      source: "oauth",
      requestedSource: "web",
      presentationSchemaVersion: 1,
      sections: [],
    });

    expect(httpRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/usage?provider=claude&fetchProfile=app&interaction=user&refresh=true",
      }),
      expect.any(Function),
    );
    expect(execFileMock).not.toHaveBeenCalledWith(
      "/usr/local/bin/codexbar",
      expect.any(Array),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("falls back to a fresh one-shot CLI when forced serve refresh is unavailable", async () => {
    const binary: ResolvedCodexBarBinary = {
      command: "/usr/local/bin/codexbar",
      source: "path",
      keychainAccessPolicy: "default",
      capabilities: {
        appFetchProfile: true,
        interactionModes: true,
        presentationSchemaVersions: [1],
        serveAppFetchProfile: true,
        serveForceRefresh: true,
      },
    };
    mockExecSuccess(JSON.stringify({ provider: "codex", usage: { primary: { usedPercent: 20 } } }));

    await fetchProviderDetail(binary, "codex", { mode: "force", interaction: "user" });

    expect(httpRequestMock).toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledWith(
      "/usr/local/bin/codexbar",
      expect.arrayContaining(["usage", "--fetch-profile", "app", "--interaction", "user", "--provider", "codex"]),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("falls back to one-shot CLI when a forced serve refresh request fails", async () => {
    const binary: ResolvedCodexBarBinary = {
      command: "/usr/local/bin/codexbar",
      source: "path",
      keychainAccessPolicy: "default",
      capabilities: {
        appFetchProfile: false,
        interactionModes: false,
        presentationSchemaVersions: [],
        serveAppFetchProfile: false,
        serveForceRefresh: true,
      },
    };
    mockExecSuccess(JSON.stringify({ provider: "codex", usage: { primary: { usedPercent: 20 } } }));
    attestServeProcess();
    mockServeResponses({ status: "ok" }, new Error("CodexBar serve request timed out."));

    await fetchProviderDetail(binary, "codex", { mode: "force" });

    expect(execFileMock).toHaveBeenCalledWith(
      "/usr/local/bin/codexbar",
      expect.arrayContaining(["usage", "--provider", "codex"]),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("requests a forced serve refresh independently of app-profile support", async () => {
    const binary: ResolvedCodexBarBinary = {
      command: "/usr/local/bin/codexbar",
      source: "path",
      keychainAccessPolicy: "default",
      capabilities: {
        appFetchProfile: false,
        interactionModes: false,
        presentationSchemaVersions: [],
        serveAppFetchProfile: false,
        serveForceRefresh: true,
      },
    };
    attestServeProcess();
    mockServeResponses({ status: "ok" }, { provider: "codex", usage: { primary: { usedPercent: 20 } } });

    await fetchProviderDetail(binary, "codex", { mode: "force" });

    expect(httpRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/usage?provider=codex&refresh=true" }),
      expect.any(Function),
    );
  });

  it("starts CodexBar serve only when the background path explicitly ensures it", async () => {
    spawnMock.mockReturnValue(makeMockChildProcess());
    mockServeProcessProbes({ pid: ["", "6000\n"], etimeAndComm: "00:01 /usr/local/bin/codexbar\n" });
    mockServeResponses(new Error("connect ECONNREFUSED"), { status: "ok" });

    await expect(
      ensureCodexBarServe({ command: "/usr/local/bin/codexbar", source: "path", keychainAccessPolicy: "default" }),
    ).resolves.toBe(true);

    expect(spawnMock).toHaveBeenCalledWith(
      "/usr/local/bin/codexbar",
      ["serve", "--port", "17653", "--refresh-interval", "600", "--request-timeout", "30"],
      expect.objectContaining({
        detached: true,
        stdio: "ignore",
      }),
    );
  });

  it("restarts an attested daemon when the Keychain policy changes", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const startedAtMs = Date.now() - 5_000;
      recordCodexBarServeRuntime({ pid: 4968, command: "/usr/local/bin/codexbar", startedAtMs }, "default");
      mockServeProcessProbes({
        pid: ["4968\n", "", "6000\n"],
        etimeAndComm: ["00:05 /usr/local/bin/codexbar\n", "00:01 /usr/local/bin/codexbar\n"],
      });
      statMock.mockResolvedValue({ mtimeMs: Date.now() - 60_000 });
      spawnMock.mockReturnValue(makeMockChildProcess());
      mockServeResponses({ status: "ok" }, { status: "ok" });

      await expect(
        ensureCodexBarServe({
          command: "/usr/local/bin/codexbar",
          source: "path",
          keychainAccessPolicy: "disabled",
        }),
      ).resolves.toBe(true);

      expect(killSpy).toHaveBeenCalledWith(4968, "SIGTERM");
      expect(spawnMock).toHaveBeenCalledWith(
        "/usr/local/bin/codexbar",
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({ [CODEXBAR_DISABLE_KEYCHAIN_ACCESS_ENV]: "1" }),
        }),
      );
    } finally {
      killSpy.mockRestore();
    }
  });

  it("leaves a recognizable daemon in place when it refuses graceful shutdown", async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      recordCodexBarServeRuntime(
        { pid: 4968, command: "/usr/local/bin/codexbar", startedAtMs: Date.now() - 5_000 },
        "default",
      );
      mockServeProcessProbes({ pid: "4968\n", etimeAndComm: "00:05 /usr/local/bin/codexbar\n" });
      statMock.mockResolvedValue({ mtimeMs: Date.now() - 60_000 });
      mockServeResponses({ status: "ok" });

      const result = ensureCodexBarServe({
        command: "/usr/local/bin/codexbar",
        source: "path",
        keychainAccessPolicy: "disabled",
      });
      await vi.runAllTimersAsync();

      await expect(result).resolves.toBe(false);
      expect(killSpy).toHaveBeenCalledWith(4968, "SIGTERM");
      expect(killSpy).not.toHaveBeenCalledWith(4968, "SIGKILL");
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      killSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("handles asynchronous CodexBar serve spawn errors", async () => {
    const child = makeMockChildProcess();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        child.emit("error", new Error("spawn codexbar ENOENT"));
      });
      return child;
    });
    mockServeProcessProbes({ pid: "" });

    await expect(
      ensureCodexBarServe({ command: "/usr/local/bin/codexbar", source: "path", keychainAccessPolicy: "default" }),
    ).resolves.toBe(false);

    expect(child.unref).toHaveBeenCalled();
  });

  it("restarts a serve daemon older than the CLI binary (ADR-0006)", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      mockServeProcessProbes({
        pid: ["4968\n", "", "6000\n"],
        etimeAndComm: ["   07-17:04:26 /opt/homebrew/bin/codexbar\n", "00:01 /opt/homebrew/bin/codexbar\n"],
      });
      statMock.mockResolvedValue({ mtimeMs: Date.now() - 1_000 });
      spawnMock.mockReturnValue(makeMockChildProcess());
      mockServeResponses({ status: "ok" }, { status: "ok" });

      await expect(
        ensureCodexBarServe({ command: "/opt/homebrew/bin/codexbar", source: "path", keychainAccessPolicy: "default" }),
      ).resolves.toBe(true);

      expect(killSpy).toHaveBeenCalledWith(4968, "SIGTERM");
      expect(spawnMock).toHaveBeenCalledWith(
        "/opt/homebrew/bin/codexbar",
        ["serve", "--port", "17653", "--refresh-interval", "600", "--request-timeout", "30"],
        expect.objectContaining({ detached: true, stdio: "ignore" }),
      );
    } finally {
      killSpy.mockRestore();
    }
  });

  it("keeps a serve daemon newer than the CLI binary", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      attestServeProcess("default", {
        pid: 4968,
        command: "/opt/homebrew/bin/codexbar",
        elapsedMs: (5 * 60 + 42) * 1000,
      });
      statMock.mockResolvedValue({ mtimeMs: Date.now() - 60 * 60 * 1000 });
      mockServeResponses({ status: "ok" });

      await expect(
        ensureCodexBarServe({ command: "/opt/homebrew/bin/codexbar", source: "path", keychainAccessPolicy: "default" }),
      ).resolves.toBe(true);

      expect(killSpy).not.toHaveBeenCalled();
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      killSpy.mockRestore();
    }
  });

  it("never kills a non-CodexBar process listening on the serve port", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      mockServeProcessProbes({ pid: "4968\n", etimeAndComm: "   07-17:04:26 /usr/bin/python3\n" });
      statMock.mockResolvedValue({ mtimeMs: Date.now() - 1_000 });
      mockServeResponses({ status: "ok" });

      await expect(
        ensureCodexBarServe({ command: "/opt/homebrew/bin/codexbar", source: "path", keychainAccessPolicy: "default" }),
      ).resolves.toBe(false);

      expect(killSpy).not.toHaveBeenCalled();
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      killSpy.mockRestore();
    }
  });

  it("parses ps etime output across its short and long forms", () => {
    expect(parseProcessElapsedMs("05:42")).toBe((5 * 60 + 42) * 1000);
    expect(parseProcessElapsedMs("01:02:03")).toBe((1 * 60 * 60 + 2 * 60 + 3) * 1000);
    expect(parseProcessElapsedMs("07-17:04:26")).toBe(((7 * 24 + 17) * 60 * 60 + 4 * 60 + 26) * 1000);
    expect(parseProcessElapsedMs("garbage")).toBeUndefined();
  });

  const FULL_CLAUDE_PAYLOAD = {
    provider: "claude",
    usage: {
      primary: { usedPercent: 25 },
      extraRateWindows: [{ id: "claude-weekly-scoped-fable", title: "Fable only", window: { usedPercent: 21 } }],
    },
  };
  const POOR_CLAUDE_PAYLOAD = { provider: "claude", usage: { primary: { usedPercent: 25 } } };
  const hasFableSection = (detail: { sections: Array<{ kind: string; title: string }> }) =>
    detail.sections.some((section) => section.kind === "supplementalUsage" && section.title === "Fable only");

  it("grafts remembered usage sections into a one-shot payload that omits them (ADR-0007)", async () => {
    const binary: ResolvedCodexBarBinary = {
      command: "/usr/local/bin/codexbar",
      source: "path",
      keychainAccessPolicy: "default",
    };
    mockExecSuccess(JSON.stringify(FULL_CLAUDE_PAYLOAD));
    const rich = await fetchProviderDetail(binary, "claude", { mode: "force" });
    expect(hasFableSection(rich)).toBe(true);

    // The upstream API nondeterministically drops the window from the next fetch.
    mockExecSuccess(JSON.stringify(POOR_CLAUDE_PAYLOAD));
    const poor = await fetchProviderDetail(binary, "claude", { mode: "force" });
    expect(hasFableSection(poor)).toBe(true);
  });

  it("grafts remembered usage sections into a serve payload without falling back to one-shot (ADR-0007)", async () => {
    const binary: ResolvedCodexBarBinary = {
      command: "/usr/local/bin/codexbar",
      source: "path",
      keychainAccessPolicy: "default",
    };
    mockExecSuccess(JSON.stringify(FULL_CLAUDE_PAYLOAD));
    await fetchProviderUsageWithStatus(binary, "claude");
    const oneShotCallsBeforeServe = execFileMock.mock.calls.filter(([command]) => command === binary.command).length;

    attestServeProcess();
    mockServeResponses({ status: "ok" }, [POOR_CLAUDE_PAYLOAD]);
    const detail = await fetchProviderDetailFromServe(binary, "claude");
    expect(hasFableSection(detail)).toBe(true);
    expect(execFileMock.mock.calls.filter(([command]) => command === binary.command)).toHaveLength(
      oneShotCallsBeforeServe,
    );
  });

  it("drops remembered usage sections once they have not been seen within the memory TTL (ADR-0007)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const binary: ResolvedCodexBarBinary = {
        command: "/usr/local/bin/codexbar",
        source: "path",
        keychainAccessPolicy: "default",
      };
      const start = Date.now();
      mockExecSuccess(JSON.stringify(FULL_CLAUDE_PAYLOAD));
      await fetchProviderDetail(binary, "claude", { mode: "force" });

      // Halfway through the TTL a poor payload is still repaired by the graft…
      vi.setSystemTime(start + SECTION_MEMORY_TTL_MS / 2);
      mockExecSuccess(JSON.stringify(POOR_CLAUDE_PAYLOAD));
      const grafted = await fetchProviderDetail(binary, "claude", { mode: "force" });
      expect(hasFableSection(grafted)).toBe(true);

      // …but grafting does not refresh the timestamp: past the TTL from the
      // last genuine sighting, the window is treated as legitimately gone.
      vi.setSystemTime(start + SECTION_MEMORY_TTL_MS + 1);
      mockExecSuccess(JSON.stringify(POOR_CLAUDE_PAYLOAD));
      const expired = await fetchProviderDetail(binary, "claude", { mode: "force" });
      expect(hasFableSection(expired)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not restore remembered usage sections across a different account identity (ADR-0007)", async () => {
    const binary: ResolvedCodexBarBinary = {
      command: "/usr/local/bin/codexbar",
      source: "path",
      keychainAccessPolicy: "default",
    };
    mockExecSuccess(JSON.stringify({ ...FULL_CLAUDE_PAYLOAD, accountEmail: "first@example.com" }));
    const rich = await fetchProviderDetail(binary, "claude", { mode: "force" });
    expect(hasFableSection(rich)).toBe(true);

    mockExecSuccess(JSON.stringify({ ...POOR_CLAUDE_PAYLOAD, accountEmail: "second@example.com" }));
    const otherAccount = await fetchProviderDetail(binary, "claude", { mode: "force" });
    expect(hasFableSection(otherAccount)).toBe(false);
  });

  it("does not remember info sections carrying mutable inventory such as reset credits (ADR-0007)", async () => {
    const binary: ResolvedCodexBarBinary = {
      command: "/usr/local/bin/codexbar",
      source: "path",
      keychainAccessPolicy: "default",
    };
    const withCredits = {
      provider: "codex",
      usage: {
        primary: { usedPercent: 10 },
        codexResetCredits: { credits: [{ status: "available" }] },
      },
    };
    mockExecSuccess(JSON.stringify(withCredits));
    const rich = await fetchProviderDetail(binary, "codex", { mode: "force" });
    expect(rich.sections.some((section) => section.title === "Limit Reset Credits")).toBe(true);

    // The credit was redeemed upstream; the next payload legitimately omits it.
    mockExecSuccess(JSON.stringify({ provider: "codex", usage: { primary: { usedPercent: 10 } } }));
    const redeemed = await fetchProviderDetail(binary, "codex", { mode: "force" });
    expect(redeemed.sections.some((section) => section.title === "Limit Reset Credits")).toBe(false);
  });

  it("refreshes the provider detail cache from the background path after starting serve", async () => {
    vi.stubEnv("PATH", "/usr/local/bin");
    mockAccessForPaths(["/usr/local/bin/codexbar"]);
    execFileMock.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (args[0] === "--version") {
          callback(null, "CodexBar\n", "");
          return;
        }

        callback(
          null,
          JSON.stringify({
            provider: "codex",
            usage: { primary: { usedPercent: 99 } },
            status: { indicator: "major", description: "Major outage" },
          }),
          "",
        );
      },
    );
    readFileMock.mockResolvedValue(JSON.stringify({ providers: [{ id: "codex", enabled: true }] }));
    spawnMock.mockReturnValue(makeMockChildProcess());
    mockServeProcessProbes({ pid: ["", "6000\n"], etimeAndComm: "00:01 /usr/local/bin/codexbar\n" });
    mockServeResponses(
      new Error("connect ECONNREFUSED"),
      { status: "ok" },
      { status: "ok" },
      { provider: "codex", usage: { primary: { usedPercent: 20 } } },
    );

    await expect(refreshUsageCache()).resolves.toMatchObject({
      status: "completed",
      providerCount: 1,
      refreshedCount: 1,
      errorCount: 0,
      usedServe: true,
    });

    // Serve-sourced detail stays primary even when a status one-shot also runs.
    expect(buildCachedProviderResults(["codex"], "default")).toMatchObject({
      codex: {
        detail: {
          id: "codex",
          sections: [{ kind: "usage", title: "Primary", displayTitle: "Session", remainingPercent: 80 }],
        },
        cacheStatus: "fresh",
        isLoading: false,
      },
    });
    expect(execFileMock).toHaveBeenCalledWith(
      "/usr/local/bin/codexbar",
      ["--version"],
      expect.any(Object),
      expect.any(Function),
    );
    expect(execFileMock).toHaveBeenCalledWith(
      "/usr/local/bin/codexbar",
      expect.arrayContaining(["usage", "--status", "--provider", "codex"]),
      expect.any(Object),
      expect.any(Function),
    );
    expect(readProviderStatus("codex")).toMatchObject({
      indicator: "major",
      description: "Major outage",
    });
  });

  it("skips status one-shot when serve supplies detail and status cache is still fresh", async () => {
    vi.stubEnv("PATH", "/usr/local/bin");
    mockAccessForPaths(["/usr/local/bin/codexbar"]);
    mockExecSuccess("CodexBar\n");
    readFileMock.mockResolvedValue(JSON.stringify({ providers: [{ id: "codex", enabled: true }] }));
    spawnMock.mockReturnValue(makeMockChildProcess());
    cacheProviderStatus("codex", { indicator: "minor", description: "Partial outage" });
    mockServeProcessProbes({ pid: ["", "6000\n"], etimeAndComm: "00:01 /usr/local/bin/codexbar\n" });
    mockServeResponses(
      new Error("connect ECONNREFUSED"),
      { status: "ok" },
      { status: "ok" },
      { provider: "codex", usage: { primary: { usedPercent: 20 } } },
    );

    await expect(refreshUsageCache()).resolves.toMatchObject({
      status: "completed",
      providerCount: 1,
      refreshedCount: 1,
      errorCount: 0,
      usedServe: true,
    });

    expect(execFileMock.mock.calls.filter(([command]) => command === "/usr/local/bin/codexbar")).toHaveLength(2);
    expect(execFileMock).toHaveBeenCalledWith(
      "/usr/local/bin/codexbar",
      ["--version"],
      expect.any(Object),
      expect.any(Function),
    );
    expect(execFileMock).toHaveBeenCalledWith(
      "/usr/local/bin/codexbar",
      ["capabilities", "--format", "json", "--json-only"],
      expect.any(Object),
      expect.any(Function),
    );
    expect(readProviderStatus("codex")).toMatchObject({
      indicator: "minor",
      description: "Partial outage",
    });
  });

  it("keeps serve detail when a status one-shot fails after serve success", async () => {
    vi.stubEnv("PATH", "/usr/local/bin");
    mockAccessForPaths(["/usr/local/bin/codexbar"]);
    execFileMock.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (args[0] === "--version") {
          callback(null, "CodexBar\n", "");
          return;
        }

        callback(new Error("status one-shot failed"), "", "status one-shot failed");
      },
    );
    readFileMock.mockResolvedValue(JSON.stringify({ providers: [{ id: "codex", enabled: true }] }));
    spawnMock.mockReturnValue(makeMockChildProcess());
    mockServeProcessProbes({ pid: ["", "6000\n"], etimeAndComm: "00:01 /usr/local/bin/codexbar\n" });
    mockServeResponses(
      new Error("connect ECONNREFUSED"),
      { status: "ok" },
      { status: "ok" },
      { provider: "codex", usage: { primary: { usedPercent: 20 } } },
    );

    await expect(refreshUsageCache()).resolves.toMatchObject({
      status: "completed",
      providerCount: 1,
      refreshedCount: 1,
      errorCount: 0,
      usedServe: true,
    });

    expect(buildCachedProviderResults(["codex"], "default")).toMatchObject({
      codex: {
        detail: {
          id: "codex",
          sections: [{ kind: "usage", title: "Primary", displayTitle: "Session", remainingPercent: 80 }],
        },
        cacheStatus: "fresh",
        isLoading: false,
      },
    });
    expect(readProviderStatus("codex")).toBeUndefined();
  });

  it("refreshes usage and status with one combined one-shot when background serve is unavailable", async () => {
    vi.stubEnv("PATH", "/usr/local/bin");
    mockAccessForPaths(["/usr/local/bin/codexbar"]);
    readFileMock.mockResolvedValue(JSON.stringify({ providers: [{ id: "codex", enabled: true }] }));
    execFileMock.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (args[0] === "--version") {
          callback(null, "CodexBar\n", "");
          return;
        }

        callback(
          null,
          JSON.stringify({
            provider: "codex",
            usage: { primary: { usedPercent: 20 } },
            status: { indicator: "major", description: "Major outage" },
          }),
          "",
        );
      },
    );

    await expect(refreshUsageCache()).resolves.toMatchObject({
      status: "completed",
      providerCount: 1,
      refreshedCount: 1,
      errorCount: 0,
      usedServe: false,
    });

    expect(execFileMock).toHaveBeenCalledWith(
      "/usr/local/bin/codexbar",
      expect.arrayContaining(["usage", "--status", "--provider", "codex"]),
      expect.any(Object),
      expect.any(Function),
    );
    expect(readProviderStatus("codex")).toMatchObject({
      indicator: "major",
      description: "Major outage",
    });
  });

  it("falls back to json-only and json-output one-shot usage when CodexBar serve is unavailable", async () => {
    mockExecSuccess('{"provider":"codex","usage":{"primary":{"usedPercent":20}}}');

    await expect(
      fetchProviderDetail(
        { command: "/usr/local/bin/codexbar", source: "path", keychainAccessPolicy: "default" },
        "codex",
      ),
    ).resolves.toMatchObject({
      id: "codex",
      sections: [{ kind: "usage", title: "Primary", displayTitle: "Session", remainingPercent: 80 }],
    });

    expect(execFileMock).toHaveBeenCalledWith(
      "/usr/local/bin/codexbar",
      [
        "usage",
        "--format",
        "json",
        "--json-only",
        "--json-output",
        "--web-timeout",
        "5",
        "--provider",
        "codex",
        "--source",
        "auto",
      ],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("throws provider-specific CLI errors instead of normalizing them as detail data", async () => {
    mockExecSuccess('[{"provider":"alibaba","error":{"message":"No available fetch strategy for alibaba."}}]');

    await expect(
      fetchProviderDetail(
        { command: "/usr/local/bin/codexbar", source: "path", keychainAccessPolicy: "default" },
        "alibaba",
      ),
    ).rejects.toThrow("No available fetch strategy for alibaba.");
  });

  it("fills USER for child processes when the host environment omits it", async () => {
    vi.stubEnv("USER", "");
    vi.stubEnv("LOGNAME", "");
    mockExecSuccess('{"provider":"codex","usage":{"primary":{"usedPercent":20}}}');

    await fetchProviderDetail(
      { command: "/usr/local/bin/codexbar", source: "path", keychainAccessPolicy: "default" },
      "codex",
    );

    const execOptions = execFileMock.mock.calls[0][2] as { env?: NodeJS.ProcessEnv };
    expect(execOptions.env?.USER).toEqual(expect.any(String));
    expect(execOptions.env?.USER).not.toHaveLength(0);
  });

  it("reads supported enabled providers from object-shaped config in file order", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        providers: {
          codex: { enabled: true, source: "oauth" },
          unknown: { enabled: true },
          perplexity: { enabled: true },
          all: { enabled: true },
          warp: { enabled: false },
        },
      }),
    );

    await expect(readConfiguredProvidersFromConfig()).resolves.toEqual([
      {
        id: "codex",
        name: "Codex",
        icon: {
          source: "provider-icons/codex.svg",
          fallback: Icon.Terminal,
          tintColor: Color.PrimaryText,
        },
        keywords: ["codex"],
        source: "oauth",
      },
      {
        id: "perplexity",
        name: "Perplexity",
        icon: {
          source: "provider-icons/perplexity.svg",
          fallback: Icon.Globe,
          tintColor: Color.PrimaryText,
        },
        keywords: ["perplexity"],
      },
    ]);
  });

  it("resolves alias provider ids and dedupes them against the canonical id", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        providers: [
          { id: "alibaba-coding-plan", enabled: true },
          { id: "alibaba", enabled: true },
          { id: "groqcloud", enabled: true },
        ],
      }),
    );

    const providers = await readConfiguredProvidersFromConfig();

    expect(providers.map((provider) => provider.id)).toEqual(["alibaba", "groq"]);
    expect(providers[1].name).toBe("Groq");
  });

  it("throws when the config file is missing", async () => {
    readFileMock.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));

    await expect(readConfiguredProvidersFromConfig()).rejects.toThrow(/config was not found/i);
  });

  it("throws when the config file contains invalid JSON", async () => {
    readFileMock.mockResolvedValue("{");

    await expect(readConfiguredProvidersFromConfig()).rejects.toThrow(/Failed to parse CodexBar config/);
  });

  it("rewrites object-shaped configs when moving a provider down", () => {
    expect(
      moveConfiguredProviderInRawConfig(
        JSON.stringify({
          providers: {
            codex: { enabled: true },
            unknown: { enabled: true },
            perplexity: { enabled: true },
            warp: { enabled: false },
          },
        }),
        "codex",
        "down",
      ),
    ).toBe(
      `${JSON.stringify(
        {
          providers: {
            perplexity: { enabled: true },
            unknown: { enabled: true },
            codex: { enabled: true },
            warp: { enabled: false },
          },
        },
        null,
        2,
      )}\n`,
    );
  });

  it("rewrites array-shaped configs when moving a provider up", () => {
    expect(
      moveConfiguredProviderInRawConfig(
        JSON.stringify({
          providers: [
            { id: "codex", enabled: true },
            { id: "cursor", enabled: true },
            { id: "perplexity", enabled: true },
          ],
        }),
        "perplexity",
        "up",
      ),
    ).toBe(
      `${JSON.stringify(
        {
          providers: [
            { id: "codex", enabled: true },
            { id: "perplexity", enabled: true },
            { id: "cursor", enabled: true },
          ],
        },
        null,
        2,
      )}\n`,
    );
  });

  it("persists reordered providers back to the CodexBar config file", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        providers: {
          codex: { enabled: true },
          perplexity: { enabled: true },
        },
      }),
    );

    await expect(moveConfiguredProviderInConfig("codex", "down")).resolves.toBe(true);

    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining(".codexbar/config.json"),
      `${JSON.stringify(
        {
          providers: {
            perplexity: { enabled: true },
            codex: { enabled: true },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  });

  it("extracts plain JSON payloads", () => {
    expect(extractJsonPayload('{"provider":"codex"}')).toEqual({ provider: "codex" });
  });

  it("extracts a JSON object from noisy stdout", () => {
    const payload = extractJsonPayload('warning: noisy output\n{"provider":"codex","ok":true}\ntrailing');

    expect(payload).toEqual({ provider: "codex", ok: true });
  });

  it("rejects invalid stdout as invalid-json", () => {
    expect(() => extractJsonPayload("not json at all")).toThrowError(CodexBarCliError);

    let thrownError: unknown;
    try {
      extractJsonPayload("not json at all");
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(CodexBarCliError);
    expect(thrownError).toMatchObject({ kind: "invalid-json" });
  });
});

describe("available providers", () => {
  const binary: ResolvedCodexBarBinary = { command: "codexbar", source: "path", keychainAccessPolicy: "default" };

  beforeEach(() => {
    execFileMock.mockReset();
    readFileMock.mockReset();
  });

  it("normalizes `config providers` output, joining the registry and resolving aliases", () => {
    const providers = normalizeAvailableProviders([
      { provider: "claude", displayName: "Claude", enabled: true },
      { provider: "codex", displayName: "Codex", enabled: false },
      { provider: "groqcloud", displayName: "Groq", enabled: false },
    ]);

    expect(providers).toEqual([
      expect.objectContaining({ id: "claude", cliProvider: "claude", name: "Claude", enabled: true }),
      expect.objectContaining({ id: "codex", cliProvider: "codex", enabled: false }),
      // `groqcloud` resolves to the canonical `groq` registry id for display.
      expect.objectContaining({ id: "groq", cliProvider: "groqcloud", name: "Groq", enabled: false }),
    ]);
  });

  it("falls back to the CLI displayName for providers the registry does not know", () => {
    const providers = normalizeAvailableProviders([
      { provider: "someunknownprovider", displayName: "Some New Provider", enabled: false },
    ]);

    expect(providers[0].name).toBe("Some New Provider");
  });

  it("skips selector ids, malformed entries, and alias duplicates", () => {
    const providers = normalizeAvailableProviders([
      { provider: "all", enabled: true },
      { provider: "  ", enabled: true },
      null,
      { provider: "groq", enabled: true },
      { provider: "groqcloud", enabled: false },
    ]);

    expect(providers.map((provider) => provider.id)).toEqual(["groq"]);
  });

  it("lists available providers from the CLI", async () => {
    mockExecSuccess(JSON.stringify([{ provider: "codex", displayName: "Codex", enabled: true }]));

    const providers = await listAvailableProviders(binary);

    expect(providers).toEqual([expect.objectContaining({ id: "codex", cliProvider: "codex", enabled: true })]);
    expect(execFileMock).toHaveBeenCalledWith(
      "codexbar",
      ["config", "providers", "--format", "json", "--json-only"],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("enables and disables a provider through the CLI", async () => {
    mockExecSuccess(JSON.stringify({ provider: "grok", enabled: true }));
    await setProviderEnabled(binary, "grok", true);
    expect(execFileMock).toHaveBeenLastCalledWith(
      "codexbar",
      ["config", "enable", "--provider", "grok", "--format", "json", "--json-only"],
      expect.anything(),
      expect.any(Function),
    );

    mockExecSuccess(JSON.stringify({ provider: "grok", enabled: false }));
    await setProviderEnabled(binary, "grok", false);
    expect(execFileMock).toHaveBeenLastCalledWith(
      "codexbar",
      ["config", "disable", "--provider", "grok", "--format", "json", "--json-only"],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("throws when `config providers` output is not an array", () => {
    let thrownError: unknown;
    try {
      normalizeAvailableProviders({ providers: [] });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toMatchObject({ kind: "invalid-json" });
  });

  it("refuses to toggle a provider without an id and never spawns the CLI", async () => {
    await expect(setProviderEnabled(binary, "  ", true)).rejects.toMatchObject({ kind: "execution" });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("marks providers the registry does not know as unsupported", () => {
    const providers = normalizeAvailableProviders([
      { provider: "codex", enabled: true },
      { provider: "someunknownprovider", displayName: "New", enabled: true },
    ]);

    expect(providers.find((provider) => provider.id === "codex")?.supported).toBe(true);
    expect(providers.find((provider) => provider.cliProvider === "someunknownprovider")?.supported).toBe(false);
  });

  it("orders enabled providers by config order and keeps disabled ones after", () => {
    const providers = normalizeAvailableProviders([
      { provider: "codex", enabled: true },
      { provider: "claude", enabled: true },
      { provider: "grok", enabled: false },
    ]);

    const ordered = orderEnabledProvidersByConfig(providers, ["claude", "codex"]);

    expect(ordered.map((provider) => provider.id)).toEqual(["claude", "codex", "grok"]);
  });

  it("keeps registry-unknown enabled providers after the config-ordered ones", () => {
    const providers = normalizeAvailableProviders([
      { provider: "someunknownprovider", displayName: "New", enabled: true },
      { provider: "codex", enabled: true },
    ]);

    const ordered = orderEnabledProvidersByConfig(providers, ["codex"]);

    expect(ordered.map((provider) => provider.cliProvider)).toEqual(["codex", "someunknownprovider"]);
  });

  it("orders the enabled roster from the CLI to match the config file order", async () => {
    mockExecSuccess(
      JSON.stringify([
        { provider: "codex", enabled: true },
        { provider: "claude", enabled: true },
      ]),
    );
    readFileMock.mockResolvedValue(
      JSON.stringify({
        providers: [
          { id: "claude", enabled: true },
          { id: "codex", enabled: true },
        ],
      }),
    );

    const providers = await listAvailableProviders(binary);

    expect(providers.map((provider) => provider.id)).toEqual(["claude", "codex"]);
  });
});
