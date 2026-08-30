import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { assertSafeUpstreamRef, encodeRefForUrl, isMainModule, readUpstreamLock } from "./upstream.mjs";

describe("assertSafeUpstreamRef", () => {
  it("accepts tags, SHAs, and slashed branch names", () => {
    expect(assertSafeUpstreamRef("v0.55.1")).toBe("v0.55.1");
    expect(assertSafeUpstreamRef("main")).toBe("main");
    expect(assertSafeUpstreamRef("feature/foo")).toBe("feature/foo");
  });

  it("rejects path walk and query/hash injection", () => {
    expect(() => assertSafeUpstreamRef("../../evil/repo/main")).toThrow(/Unsafe/);
    expect(() => assertSafeUpstreamRef("v0.55.1?foo=1")).toThrow(/Unsafe/);
    expect(() => assertSafeUpstreamRef("v0.55.1#x")).toThrow(/Unsafe/);
    expect(() => assertSafeUpstreamRef("https://example.com")).toThrow(/Unsafe/);
  });
});

describe("encodeRefForUrl", () => {
  it("encodes each path segment", () => {
    expect(encodeRefForUrl("v0.55.1")).toBe("v0.55.1");
    expect(encodeRefForUrl("feature/foo")).toBe("feature/foo");
  });
});

describe("isMainModule", () => {
  const moduleUrl = pathToFileURL(path.resolve("/tmp/scripts/check-upstream.mjs")).href;

  it("is true when argv1 resolves to the module URL", () => {
    expect(isMainModule(moduleUrl, "/tmp/scripts/check-upstream.mjs")).toBe(true);
  });

  it("is false when another script is the entry point", () => {
    expect(isMainModule(moduleUrl, "/tmp/scripts/bump-upstream.mjs")).toBe(false);
  });

  it("is false when argv1 is missing", () => {
    expect(isMainModule(moduleUrl, undefined)).toBe(false);
  });
});

describe("readUpstreamLock", () => {
  const valid = `{
  "repo": "steipete/CodexBar",
  "tag": "v0.55.1",
  "sha": "10587234b54eb6f00efc129566cc25ba744dcc32"
}`;

  it("reads tag and lowercase sha", () => {
    expect(readUpstreamLock(valid)).toEqual({
      repo: "steipete/CodexBar",
      tag: "v0.55.1",
      sha: "10587234b54eb6f00efc129566cc25ba744dcc32",
    });
  });

  it("throws on a missing lockfile-shaped payload", () => {
    expect(() => readUpstreamLock("{}")).toThrow(/repo must be/);
    expect(() => readUpstreamLock('{"repo":"steipete/CodexBar","tag":"v1","sha":"abc"}')).toThrow(/40-character/);
    expect(() => readUpstreamLock("not-json")).toThrow(/valid JSON/);
  });
});
