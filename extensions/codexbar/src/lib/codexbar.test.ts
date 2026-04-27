import { Color, Icon } from "@raycast/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { accessMock, readFileMock, writeFileMock, execFileMock } = vi.hoisted(() => {
  return {
    accessMock: vi.fn(),
    readFileMock: vi.fn(),
    writeFileMock: vi.fn(),
    execFileMock: vi.fn(),
  };
});

vi.mock("node:fs/promises", () => ({
  access: accessMock,
  readFile: readFileMock,
  writeFile: writeFileMock,
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

import {
  classifyExecFailure,
  CodexBarCliError,
  extractJsonPayload,
  fetchProviderDetail,
  getCodexBarAvailability,
  moveConfiguredProviderInConfig,
  moveConfiguredProviderInRawConfig,
  readConfiguredProvidersFromConfig,
  resolveCodexBarBinary,
} from "./codexbar";

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
      return {} as never;
    },
  );
}

describe("codexbar runtime helpers", () => {
  beforeEach(() => {
    accessMock.mockReset();
    readFileMock.mockReset();
    writeFileMock.mockReset();
    execFileMock.mockReset();
    readFileMock.mockRejectedValue(new Error("missing"));
    writeFileMock.mockResolvedValue(undefined);
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

  it("uses json-only and json-output flags for provider detail fetches", async () => {
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
      ["usage", "--format", "json", "--json-only", "--json-output", "--web-timeout", "5", "--provider", "codex"],
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
