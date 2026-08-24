import { Cache } from "@raycast/api";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { accessMock, readFileMock, writeFileMock, statMock, execFileMock, spawnMock, httpRequestMock } = vi.hoisted(
  () => ({
    accessMock: vi.fn(),
    readFileMock: vi.fn(),
    writeFileMock: vi.fn(),
    statMock: vi.fn(),
    execFileMock: vi.fn(),
    spawnMock: vi.fn(),
    httpRequestMock: vi.fn(),
  }),
);

vi.mock("node:fs/promises", () => ({
  access: accessMock,
  readFile: readFileMock,
  writeFile: writeFileMock,
  stat: statMock,
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

import { refreshUsageCache } from "./backgroundRefresh";
import { buildCachedProviderResults } from "./providerDetailCache";
import { cacheProviderStatus, readProviderStatus } from "./providerStatusCache";

const SERVE_FORCE_REFRESH_CAPABILITIES = JSON.stringify({
  serve: { forceRefresh: true },
});

function mockAccessForPaths(paths: string[]) {
  accessMock.mockImplementation((targetPath: string) => {
    if (paths.includes(targetPath)) {
      return Promise.resolve(undefined);
    }

    return Promise.reject(new Error("missing"));
  });
}

function mockBackgroundCli(options?: { capabilities?: string; usagePayload?: unknown; usageError?: Error }) {
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
      if (args[0] === "capabilities") {
        callback(null, options?.capabilities ?? SERVE_FORCE_REFRESH_CAPABILITIES, "");
        return;
      }
      if (options?.usageError) {
        callback(options.usageError, "", options.usageError.message);
        return;
      }
      callback(
        null,
        JSON.stringify(
          options?.usagePayload ?? {
            provider: "codex",
            usage: { primary: { usedPercent: 99 } },
            status: { indicator: "major", description: "Major outage" },
          },
        ),
        "",
      );
    },
  );
}

function serveUsageRequestPaths(): string[] {
  return httpRequestMock.mock.calls
    .map(([requestOptions]) => (requestOptions as { path?: string } | undefined)?.path)
    .filter((path): path is string => typeof path === "string" && path.startsWith("/usage"));
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

describe("refreshUsageCache", () => {
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
    mockServeResponses(new Error("connect ECONNREFUSED"));
  });

  it("refreshes the provider detail cache from the background path after starting serve", async () => {
    vi.stubEnv("PATH", "/usr/local/bin");
    mockAccessForPaths(["/usr/local/bin/codexbar"]);
    mockBackgroundCli();
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
    expect(serveUsageRequestPaths()).toEqual(["/usage?provider=codex&refresh=true"]);
  });

  it("skips status one-shot when serve supplies detail and status cache is still fresh", async () => {
    vi.stubEnv("PATH", "/usr/local/bin");
    mockAccessForPaths(["/usr/local/bin/codexbar"]);
    mockBackgroundCli();
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
    expect(readProviderStatus("codex")).toMatchObject({
      indicator: "minor",
      description: "Partial outage",
    });
    expect(serveUsageRequestPaths()).toEqual(["/usage?provider=codex&refresh=true"]);
  });

  it("keeps serve detail when a status one-shot fails after serve success", async () => {
    vi.stubEnv("PATH", "/usr/local/bin");
    mockAccessForPaths(["/usr/local/bin/codexbar"]);
    mockBackgroundCli({ usageError: new Error("status one-shot failed") });
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
    expect(serveUsageRequestPaths()).toEqual(["/usage?provider=codex&refresh=true"]);
  });

  it("uses a one-shot usage command when serve cannot force-refresh", async () => {
    vi.stubEnv("PATH", "/usr/local/bin");
    mockAccessForPaths(["/usr/local/bin/codexbar"]);
    mockBackgroundCli({ capabilities: JSON.stringify({ serve: { fetchProfile: true } }) });
    readFileMock.mockResolvedValue(JSON.stringify({ providers: [{ id: "codex", enabled: true }] }));
    spawnMock.mockReturnValue(makeMockChildProcess());
    mockServeProcessProbes({ pid: ["", "6000\n"], etimeAndComm: "00:01 /usr/local/bin/codexbar\n" });
    mockServeResponses(new Error("connect ECONNREFUSED"), { status: "ok" }, { status: "ok" });

    await expect(refreshUsageCache()).resolves.toMatchObject({
      status: "completed",
      refreshedCount: 1,
      usedServe: false,
    });

    expect(buildCachedProviderResults(["codex"], "default")).toMatchObject({
      codex: {
        detail: {
          sections: [{ remainingPercent: 1 }],
        },
      },
    });
    expect(execFileMock).toHaveBeenCalledWith(
      "/usr/local/bin/codexbar",
      expect.arrayContaining(["usage", "--status", "--provider", "codex"]),
      expect.any(Object),
      expect.any(Function),
    );
    expect(serveUsageRequestPaths()).toEqual([]);
  });

  it("refreshes usage and status with one combined one-shot when background serve is unavailable", async () => {
    vi.stubEnv("PATH", "/usr/local/bin");
    mockAccessForPaths(["/usr/local/bin/codexbar"]);
    readFileMock.mockResolvedValue(JSON.stringify({ providers: [{ id: "codex", enabled: true }] }));
    mockBackgroundCli({
      capabilities: JSON.stringify({}),
      usagePayload: {
        provider: "codex",
        usage: { primary: { usedPercent: 20 } },
        status: { indicator: "major", description: "Major outage" },
      },
    });

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
});
