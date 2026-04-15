import { beforeEach, describe, expect, it, vi } from "vitest";

const { useCachedPromiseMock } = vi.hoisted(() => {
  return {
    useCachedPromiseMock: vi.fn(),
  };
});

vi.mock("@raycast/utils", () => ({
  useCachedPromise: useCachedPromiseMock,
}));

import { useProviderDetail } from "./useProviderDetail";

describe("useProviderDetail", () => {
  beforeEach(() => {
    useCachedPromiseMock.mockReset();
  });

  it("hides errors when active provider has fresh cached detail", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T00:00:00Z"));

    useCachedPromiseMock.mockReturnValue({
      data: {
        id: "codex",
        name: "Codex",
        raw: {},
        fetchedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        sections: [],
        markdown: "# Codex",
      },
      error: new Error("Timed out"),
      isLoading: false,
      revalidate: vi.fn(),
    });

    const result = useProviderDetail({ command: "/usr/local/bin/codexbar", source: "path" }, "codex");

    expect(result.detail).toMatchObject({ id: "codex", name: "Codex" });
    expect(result.error).toBeUndefined();

    vi.useRealTimers();
  });

  it("shows errors when cached detail is stale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T00:00:00Z"));

    useCachedPromiseMock.mockReturnValue({
      data: {
        id: "codex",
        name: "Codex",
        raw: {},
        fetchedAt: new Date(Date.now() - 5 * 60 * 1000 - 1).toISOString(),
        sections: [],
        markdown: "# Codex",
      },
      error: new Error("Timed out"),
      isLoading: false,
      revalidate: vi.fn(),
    });

    const result = useProviderDetail({ command: "/usr/local/bin/codexbar", source: "path" }, "codex");

    expect(result.detail).toBeUndefined();
    expect(result.error).toMatchObject({ message: "Timed out" });

    vi.useRealTimers();
  });

  it("drops cached detail from a previous provider selection", () => {
    useCachedPromiseMock.mockReturnValue({
      data: {
        id: "claude",
        name: "Claude",
        raw: {},
        fetchedAt: new Date().toISOString(),
        sections: [],
        markdown: "# Claude",
      },
      error: undefined,
      isLoading: true,
      revalidate: vi.fn(),
    });

    const result = useProviderDetail({ command: "/usr/local/bin/codexbar", source: "path" }, "codex");

    expect(result.detail).toBeUndefined();
  });

  it("hides stale errors from a different provider selection", () => {
    const error = new Error("No available fetch strategy for perplexity.");
    Object.defineProperty(error, "providerId", {
      value: "perplexity",
      configurable: true,
      enumerable: false,
      writable: true,
    });

    useCachedPromiseMock.mockReturnValue({
      data: undefined,
      error,
      isLoading: false,
      revalidate: vi.fn(),
    });

    const result = useProviderDetail({ command: "/usr/local/bin/codexbar", source: "path" }, "claude");

    expect(result.error).toBeUndefined();
  });

  it("keeps errors for active provider selection", () => {
    const error = new Error("CodexBar timed out while fetching usage data.");
    Object.defineProperty(error, "providerId", {
      value: "claude",
      configurable: true,
      enumerable: false,
      writable: true,
    });

    useCachedPromiseMock.mockReturnValue({
      data: undefined,
      error,
      isLoading: false,
      revalidate: vi.fn(),
    });

    const result = useProviderDetail({ command: "/usr/local/bin/codexbar", source: "path" }, "claude");

    expect(result.error).toMatchObject({ message: "CodexBar timed out while fetching usage data." });
  });

  it("keeps detail for the active provider", () => {
    useCachedPromiseMock.mockReturnValue({
      data: {
        id: "codex",
        name: "Codex",
        raw: {},
        fetchedAt: new Date().toISOString(),
        sections: [],
        markdown: "# Codex",
      },
      error: undefined,
      isLoading: false,
      revalidate: vi.fn(),
    });

    const result = useProviderDetail({ command: "/usr/local/bin/codexbar", source: "path" }, "codex");

    expect(result.detail).toMatchObject({ id: "codex", name: "Codex" });
  });

  it("drops cached detail that uses the previous untyped section schema", () => {
    useCachedPromiseMock.mockReturnValue({
      data: {
        id: "claude",
        name: "Claude",
        raw: {},
        fetchedAt: new Date().toISOString(),
        sections: [
          {
            title: "Primary",
            displayTitle: "Session",
            progressPercent: 80,
            items: [],
          },
        ],
        markdown: "# Claude",
      },
      error: undefined,
      isLoading: true,
      revalidate: vi.fn(),
    });

    const result = useProviderDetail({ command: "/usr/local/bin/codexbar", source: "path" }, "claude");

    expect(result.detail).toBeUndefined();
  });
});
