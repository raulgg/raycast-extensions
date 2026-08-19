import { Cache } from "@raycast/api";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCodexBarServeRuntime,
  codexBarServeRuntimeMatches,
  readCodexBarServeRuntime,
  recordCodexBarServeRuntime,
} from "./codexBarServeState";

describe("CodexBar serve runtime state", () => {
  beforeEach(() => {
    new Cache({ namespace: "codexbar-serve-runtime" }).clear();
  });

  it("records the process identity and Keychain policy", () => {
    recordCodexBarServeRuntime(
      { pid: 42, command: "/opt/homebrew/bin/codexbar", startedAtMs: 1_000 },
      "disabled",
      2_000,
    );

    expect(readCodexBarServeRuntime()).toEqual({
      pid: 42,
      command: "/opt/homebrew/bin/codexbar",
      startedAtMs: 1_000,
      keychainAccessPolicy: "disabled",
      recordedAtMs: 2_000,
    });
  });

  it("matches PID, command, process start identity, and policy", () => {
    const record = {
      pid: 42,
      command: "/opt/homebrew/bin/codexbar",
      startedAtMs: 10_000,
      keychainAccessPolicy: "disabled" as const,
      recordedAtMs: 20_000,
    };

    expect(
      codexBarServeRuntimeMatches(
        record,
        { pid: 42, command: "/opt/homebrew/bin/codexbar", startedAtMs: 11_500 },
        "disabled",
      ),
    ).toBe(true);
    expect(
      codexBarServeRuntimeMatches(
        record,
        { pid: 42, command: "/opt/homebrew/bin/codexbar", startedAtMs: 11_500 },
        "default",
      ),
    ).toBe(false);
    expect(
      codexBarServeRuntimeMatches(
        record,
        { pid: 42, command: "/opt/homebrew/bin/codexbar", startedAtMs: 13_000 },
        "disabled",
      ),
    ).toBe(false);
  });

  it("removes malformed and explicitly cleared records", () => {
    const cache = new Cache({ namespace: "codexbar-serve-runtime" });
    cache.set("serve-runtime-v1", JSON.stringify({ pid: "wrong" }));
    expect(readCodexBarServeRuntime()).toBeUndefined();
    expect(cache.get("serve-runtime-v1")).toBeUndefined();

    recordCodexBarServeRuntime({ pid: 42, command: "codexbar", startedAtMs: 1_000 }, "default");
    clearCodexBarServeRuntime();
    expect(readCodexBarServeRuntime()).toBeUndefined();
  });
});
