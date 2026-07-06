import { describe, expect, it } from "vitest";
import {
  formatProviderStatusSummary,
  getProviderStatusLabel,
  isProviderStatusFresh,
  isRenderableProviderStatusIndicator,
  parseProviderStatus,
  PROVIDER_STATUS_TTL_MS,
} from "./status";

describe("parseProviderStatus", () => {
  it("parses each known indicator with its fields", () => {
    for (const indicator of ["none", "minor", "major", "critical", "maintenance", "unknown"] as const) {
      expect(
        parseProviderStatus({
          indicator,
          description: "Something happened",
          updatedAt: "2026-06-29T07:00:00Z",
          url: "https://status.openai.com/",
        }),
      ).toEqual({
        indicator,
        description: "Something happened",
        updatedAt: "2026-06-29T07:00:00Z",
        url: "https://status.openai.com/",
      });
    }
  });

  it("maps unrecognized indicator strings to unknown", () => {
    expect(parseProviderStatus({ indicator: "degraded_performance" })).toEqual({
      indicator: "unknown",
      description: undefined,
      updatedAt: undefined,
      url: undefined,
    });
  });

  it("normalizes indicator casing and whitespace", () => {
    expect(parseProviderStatus({ indicator: "  MINOR  " })?.indicator).toBe("minor");
  });

  it("keeps only present fields and drops blanks", () => {
    expect(parseProviderStatus({ indicator: "minor", description: "  ", url: "https://x" })).toEqual({
      indicator: "minor",
      description: undefined,
      updatedAt: undefined,
      url: "https://x",
    });
  });

  it("returns undefined for missing indicator or garbage", () => {
    expect(parseProviderStatus({ description: "no indicator" })).toBeUndefined();
    expect(parseProviderStatus(undefined)).toBeUndefined();
    expect(parseProviderStatus(null)).toBeUndefined();
    expect(parseProviderStatus("minor")).toBeUndefined();
    expect(parseProviderStatus(["minor"])).toBeUndefined();
  });

  it("treats a non-string indicator as unknown rather than dropping the status", () => {
    expect(parseProviderStatus({ indicator: 3 })?.indicator).toBe("unknown");
  });
});

describe("status presentation", () => {
  it("labels indicators with the upstream wording", () => {
    expect(getProviderStatusLabel("minor")).toBe("Partial outage");
    expect(getProviderStatusLabel("critical")).toBe("Critical issue");
    expect(getProviderStatusLabel("maintenance")).toBe("Maintenance");
  });

  it("only renders non-operational, known indicators", () => {
    expect(isRenderableProviderStatusIndicator("minor")).toBe(true);
    expect(isRenderableProviderStatusIndicator("none")).toBe(false);
    expect(isRenderableProviderStatusIndicator("unknown")).toBe(false);
  });

  it("joins label and description with an en dash", () => {
    expect(formatProviderStatusSummary({ indicator: "minor", description: "Partial System Degradation" })).toBe(
      "Partial outage – Partial System Degradation",
    );
    expect(formatProviderStatusSummary({ indicator: "major" })).toBe("Major outage");
  });
});

describe("isProviderStatusFresh", () => {
  const now = Date.parse("2026-07-06T12:00:00Z");

  it("is fresh within the TTL", () => {
    expect(isProviderStatusFresh(new Date(now - (PROVIDER_STATUS_TTL_MS - 1000)).toISOString(), now)).toBe(true);
  });

  it("is stale past the TTL", () => {
    expect(isProviderStatusFresh(new Date(now - (PROVIDER_STATUS_TTL_MS + 1000)).toISOString(), now)).toBe(false);
  });

  it("rejects unparseable timestamps", () => {
    expect(isProviderStatusFresh("not-a-date", now)).toBe(false);
  });
});
