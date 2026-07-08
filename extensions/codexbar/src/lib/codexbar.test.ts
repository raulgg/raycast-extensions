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
  listAvailableProviders,
  moveConfiguredProviderInConfig,
  moveConfiguredProviderInRawConfig,
  normalizeAvailableProviders,
  readConfiguredProvidersFromConfig,
  resolveCodexBarBinary,
  setProviderEnabled,
  type ResolvedCodexBarBinary,
} from "./codexbar";
import { refreshUsageCache } from "./backgroundRefresh";
import { buildCachedProviderResults } from "../hooks/useProviderDetails";

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

  it("starts CodexBar serve only when the background path explicitly ensures it", async () => {
    spawnMock.mockReturnValue(makeMockChildProcess());
    mockServeResponses(new Error("connect ECONNREFUSED"), { status: "ok" });

    await expect(ensureCodexBarServe({ command: "/usr/local/bin/codexbar", source: "path" })).resolves.toBe(true);

    expect(spawnMock).toHaveBeenCalledWith(
      "/usr/local/bin/codexbar",
      ["serve", "--port", "17653", "--refresh-interval", "60", "--request-timeout", "30"],
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
    mockExecSuccess("CodexBar\n");
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
  });

  it("falls back to json-only and json-output one-shot usage when CodexBar serve is unavailable", async () => {
    mockExecSuccess('{"provider":"codex","usage":{"primary":{"usedPercent":20}}}');

    await expect(
      fetchProviderDetail({ command: "/usr/local/bin/codexbar", source: "path" }, "codex"),
    ).resolves.toMatchObject({
      id: "codex",
      sections: [{ kind: "usage", title: "Primary", displayTitle: "Session", remainingPercent: 80 }],
      markdown: expect.stringContaining("![Codex detail]"),
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
          codex: { enabled: true },
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
  });

  it("normalizes `config providers` output, joining the registry and resolving aliases", () => {
    const providers = normalizeAvailableProviders([
      { provider: "claude", displayName: "Claude", enabled: true, defaultEnabled: false },
      { provider: "codex", displayName: "Codex", enabled: false, defaultEnabled: true },
      { provider: "groqcloud", displayName: "Groq", enabled: false, defaultEnabled: false },
    ]);

    expect(providers).toEqual([
      expect.objectContaining({ id: "claude", cliProvider: "claude", name: "Claude", enabled: true }),
      expect.objectContaining({ id: "codex", cliProvider: "codex", enabled: false, defaultEnabled: true }),
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
    mockExecSuccess(JSON.stringify([{ provider: "codex", displayName: "Codex", enabled: true, defaultEnabled: true }]));

    const providers = await listAvailableProviders(binary);

    expect(providers).toEqual([
      expect.objectContaining({ id: "codex", cliProvider: "codex", enabled: true, defaultEnabled: true }),
    ]);
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
});
