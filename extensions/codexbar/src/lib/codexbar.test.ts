import { Cache, Color, Icon } from "@raycast/api";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { accessMock, readFileMock, writeFileMock, execFileMock, spawnMock, httpRequestMock } = vi.hoisted(() => {
  return {
    accessMock: vi.fn(),
    readFileMock: vi.fn(),
    writeFileMock: vi.fn(),
    execFileMock: vi.fn(),
    spawnMock: vi.fn(),
    httpRequestMock: vi.fn(),
  };
});

vi.mock("node:fs/promises", () => ({
  access: accessMock,
  readFile: readFileMock,
  writeFile: writeFileMock,
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
  fetchProviderDetail,
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
import { cacheProviderStatus, readProviderStatus } from "./providerStatusCache";
import { buildCachedProviderResults } from "./providerDetailCache";

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

function makeMockChildProcess() {
  return Object.assign(new EventEmitter(), { unref: vi.fn() });
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
    execFileMock.mockReset();
    spawnMock.mockReset();
    httpRequestMock.mockReset();
    new Cache({ namespace: "provider-details" }).clear();
    new Cache({ namespace: "provider-status" }).clear();
    readFileMock.mockRejectedValue(new Error("missing"));
    writeFileMock.mockResolvedValue(undefined);
    spawnMock.mockImplementation(() => {
      throw new Error("serve unavailable");
    });
    mockServeUnavailable();
  });

  it("resolves the CLI from PATH before fallback locations", async () => {
    vi.stubEnv("PATH", "/usr/local/bin:/bin");
    mockAccessForPaths(["/usr/local/bin/codexbar"]);

    await expect(resolveCodexBarBinary()).resolves.toEqual({
      command: "/usr/local/bin/codexbar",
      source: "path",
    });
  });

  it("falls back to official macOS install locations when PATH misses", async () => {
    vi.stubEnv("PATH", "/bin");
    mockAccessForPaths(["/opt/homebrew/bin/codexbar"]);

    await expect(resolveCodexBarBinary()).resolves.toEqual({
      command: "/opt/homebrew/bin/codexbar",
      source: "fallback",
    });
  });

  it("returns unavailable install help when the CLI cannot be resolved", async () => {
    vi.stubEnv("PATH", "/bin");
    mockAccessForPaths([]);

    const availability = await getCodexBarAvailability();

    expect(availability.status).toBe("unavailable");
    if (availability.status === "unavailable") {
      expect(availability.install.docsUrl).toContain("docs/cli.md");
      expect(availability.install.markdown).toContain("Install CodexBar CLI");
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

    const availability = await getCodexBarAvailability();

    expect(availability.status).toBe("available");
    if (availability.status === "available") {
      expect(availability.binary.command).toBe("/usr/local/bin/codexbar");
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

    await expect(getCodexBarAvailability()).resolves.toMatchObject({
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

    await expect(getCodexBarAvailability()).resolves.toMatchObject({
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
    mockServeResponses({ status: "ok" }, { provider: "codex", usage: { primary: { usedPercent: 20 } } });

    await expect(
      fetchProviderDetail({ command: "/usr/local/bin/codexbar", source: "path" }, "codex"),
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
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("falls back to one-shot usage without starting serve when foreground health check misses", async () => {
    mockExecSuccess('{"provider":"codex","usage":{"primary":{"usedPercent":20}}}');
    mockServeResponses(new Error("connect ECONNREFUSED"));

    await fetchProviderDetail({ command: "/usr/local/bin/codexbar", source: "path" }, "codex");

    expect(spawnMock).not.toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledWith(
      "/usr/local/bin/codexbar",
      expect.arrayContaining(["usage", "--provider", "codex", "--source", "auto"]),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("bypasses CodexBar serve for forced provider detail fetches", async () => {
    mockExecSuccess('{"provider":"codex","usage":{"primary":{"usedPercent":20}}}');
    mockServeResponses({ status: "ok" }, { provider: "codex", usage: { primary: { usedPercent: 99 } } });

    await expect(
      fetchProviderDetail({ command: "/usr/local/bin/codexbar", source: "path" }, "codex", { mode: "force" }),
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
      capabilities: {
        appFetchProfile: true,
        interactionModes: true,
        presentationSchemaVersions: [1],
        serveAppFetchProfile: true,
        serveForceRefresh: true,
      },
    };
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
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("falls back to a fresh one-shot CLI when forced serve refresh is unavailable", async () => {
    const binary: ResolvedCodexBarBinary = {
      command: "/usr/local/bin/codexbar",
      source: "path",
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
      capabilities: {
        appFetchProfile: false,
        interactionModes: false,
        presentationSchemaVersions: [],
        serveAppFetchProfile: false,
        serveForceRefresh: true,
      },
    };
    mockServeResponses({ status: "ok" }, new Error("CodexBar serve request timed out."));
    mockExecSuccess(JSON.stringify({ provider: "codex", usage: { primary: { usedPercent: 20 } } }));

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
      capabilities: {
        appFetchProfile: false,
        interactionModes: false,
        presentationSchemaVersions: [],
        serveAppFetchProfile: false,
        serveForceRefresh: true,
      },
    };
    mockServeResponses({ status: "ok" }, { provider: "codex", usage: { primary: { usedPercent: 20 } } });

    await fetchProviderDetail(binary, "codex", { mode: "force" });

    expect(httpRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/usage?provider=codex&refresh=true" }),
      expect.any(Function),
    );
  });

  it("starts CodexBar serve only when the background path explicitly ensures it", async () => {
    spawnMock.mockReturnValue(makeMockChildProcess());
    mockServeResponses(new Error("connect ECONNREFUSED"), { status: "ok" });

    await expect(ensureCodexBarServe({ command: "/usr/local/bin/codexbar", source: "path" })).resolves.toBe(true);

    expect(spawnMock).toHaveBeenCalledWith(
      "/usr/local/bin/codexbar",
      ["serve", "--port", "17653", "--refresh-interval", "600", "--request-timeout", "30"],
      expect.objectContaining({
        detached: true,
        stdio: "ignore",
      }),
    );
  });

  it("handles asynchronous CodexBar serve spawn errors", async () => {
    const child = makeMockChildProcess();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        child.emit("error", new Error("spawn codexbar ENOENT"));
      });
      return child;
    });

    await expect(ensureCodexBarServe({ command: "/usr/local/bin/codexbar", source: "path" })).resolves.toBe(false);

    expect(child.unref).toHaveBeenCalled();
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
    mockServeResponses(
      new Error("connect ECONNREFUSED"),
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
    expect(buildCachedProviderResults(["codex"])).toMatchObject({
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
    mockServeResponses(
      new Error("connect ECONNREFUSED"),
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

    expect(execFileMock).toHaveBeenCalledTimes(2);
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
    mockServeResponses(
      new Error("connect ECONNREFUSED"),
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

    expect(buildCachedProviderResults(["codex"])).toMatchObject({
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
      fetchProviderDetail({ command: "/usr/local/bin/codexbar", source: "path" }, "codex"),
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
      fetchProviderDetail({ command: "/usr/local/bin/codexbar", source: "path" }, "alibaba"),
    ).rejects.toThrow("No available fetch strategy for alibaba.");
  });

  it("fills USER for child processes when the host environment omits it", async () => {
    vi.stubEnv("USER", "");
    vi.stubEnv("LOGNAME", "");
    mockExecSuccess('{"provider":"codex","usage":{"primary":{"usedPercent":20}}}');

    await fetchProviderDetail({ command: "/usr/local/bin/codexbar", source: "path" }, "codex");

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
  const binary: ResolvedCodexBarBinary = { command: "codexbar", source: "path" };

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
