import { expect, onTestFinished, vi, test } from "vitest";
import { fetchLatestGithubRelease } from "./latest-release";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockFetch(implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(implementation));
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
}

test("returns the GitHub tag when the latest release is available", async () => {
  // Given
  const fetchMock = vi.fn(async () => jsonResponse({ tag_name: "v0.5.0" }));
  mockFetch(fetchMock);
  // When
  const result = await fetchLatestGithubRelease();
  // Then
  expect(result).toEqual({ version: "0.5.0", source: "github", liveCheckFailed: false });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.github.com/repos/raulgg/airpods-control/releases/latest",
    expect.objectContaining({
      signal: expect.any(AbortSignal),
      headers: expect.objectContaining({
        Accept: "application/vnd.github+json",
        "User-Agent": "airpods-control-raycast-extension",
      }),
    }),
  );
});

test("leaves latest unknown when GitHub is unavailable", async () => {
  // Given
  mockFetch(async () => {
    throw new Error("network down");
  });
  // When
  const result = await fetchLatestGithubRelease();
  // Then
  expect(result).toEqual({ version: null, source: null, liveCheckFailed: true });
});

test("leaves latest unknown when GitHub returns a non-success status", async () => {
  // Given
  mockFetch(async () => jsonResponse({ message: "API rate limit exceeded" }, 403));
  // When
  const result = await fetchLatestGithubRelease();
  // Then
  expect(result).toEqual({ version: null, source: null, liveCheckFailed: true });
});

test("leaves latest unknown when the release payload has no tag", async () => {
  // Given
  mockFetch(async () => jsonResponse({ name: "0.5.0" }));
  // When
  const result = await fetchLatestGithubRelease();
  // Then
  expect(result).toEqual({ version: null, source: null, liveCheckFailed: true });
});

test("leaves latest unknown when the release tag is not a version", async () => {
  // Given
  mockFetch(async () => jsonResponse({ tag_name: "latest" }));
  // When
  const result = await fetchLatestGithubRelease();
  // Then
  expect(result).toEqual({ version: null, source: null, liveCheckFailed: true });
});
