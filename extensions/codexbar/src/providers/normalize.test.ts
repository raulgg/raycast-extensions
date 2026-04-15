import { describe, expect, it } from "vitest";
import { formatLocalDateTime } from "../lib/presentation";
import { extractSvgMarkup } from "../../test/svg-markdown";
import { extractProviderErrorMessage, normalizeProviderDetailPayload } from "./normalize";

const codexPayload = {
  provider: "codex",
  usage: {
    primary: {
      windowMinutes: 300,
      usedPercent: 47,
      resetsAt: "2026-03-23T12:00:00Z",
    },
    secondary: {
      windowMinutes: 10080,
      usedPercent: 12,
      resetsAt: "2026-03-30T08:00:00Z",
    },
  },
  credits: {
    remaining: 112.4,
  },
  openaiDashboard: {
    updatedAt: "2026-03-23T09:00:00Z",
    codeReviewRemainingPercent: 78,
  },
} as const;

describe("provider normalization", () => {
  it("normalizes generic provider detail sections", () => {
    const detail = normalizeProviderDetailPayload(codexPayload, "codex", Date.parse("2026-03-23T10:30:00Z"));
    const [detailSvg] = extractSvgMarkup(detail.markdown);
    const expectedUpdated = formatLocalDateTime("2026-03-23T09:00:00Z");

    expect(detail.id).toBe("codex");
    expect(detail.name).toBe("Codex");
    expect(detail.updatedAt).toBe("2026-03-23T09:00:00Z");
    expect(detail.sections).toMatchObject([
      {
        kind: "usage",
        title: "Primary",
        displayTitle: "Session",
        remainingPercent: 53,
        resetsIn: "1h 30m",
      },
      {
        kind: "usage",
        title: "Secondary",
        displayTitle: "Weekly",
        remainingPercent: 88,
        resetsIn: "6d 21h",
      },
      {
        kind: "supplementalUsage",
        title: "Code review",
        remainingPercent: 78,
      },
      {
        kind: "credits",
        title: "Credits",
        remaining: "112.4",
        remainingPercent: 11,
        scaleLabel: "1K tokens",
      },
      {
        kind: "info",
        title: "General",
        items: [{ label: "Last Updated", value: expectedUpdated }],
      },
    ]);
    expect(detail.markdown).toContain("data:image/svg+xml;base64,");
    expect(detail.markdown).not.toContain("prefers-color-scheme");
    expect(detailSvg).not.toContain("dominant-baseline");
    expect(detail.markdown).not.toContain("## Primary");
    expect(detail.markdown).not.toContain("- **Remaining:**");
    expect(detailSvg).toContain("<title>Codex detail</title>");
    expect(detailSvg).toContain(">Codex<");
    expect(detailSvg).toContain(`>Updated ${expectedUpdated}<`);
    expect(detailSvg).toContain(">Session<");
    expect(detailSvg).toContain(">Weekly<");
    expect(detailSvg).toContain(">53% left<");
    expect(detailSvg).toContain(">Resets in 1h 30m");
    expect(detailSvg).toContain(">Code review<");
    expect(detailSvg).toContain(">78% left<");
    expect(detailSvg).toContain(">Credits<");
    expect(detailSvg).toContain(">112.4<");
    expect(detailSvg).toContain(">1K tokens<");
    expect(detailSvg).not.toContain(">General<");
    expect(detailSvg.match(/<line /g)).toHaveLength(2);
    expect(detailSvg).toContain('width="440"');
  });

  it("falls back to session and weekly fields when usage windows are absent", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "claude",
        sessionPercentLeft: 80,
        sessionResetsAt: "2026-03-23T11:00:00Z",
        weeklyPercentLeft: 55,
        weeklyResetsAt: "2026-03-24T12:00:00Z",
      },
      "claude",
      Date.parse("2026-03-23T10:30:00Z"),
    );
    const [detailSvg] = extractSvgMarkup(detail.markdown);

    expect(detail.sections).toMatchObject([
      {
        kind: "usage",
        title: "Primary",
        displayTitle: "Session",
        remainingPercent: 80,
        resetsIn: "30m",
      },
      {
        kind: "usage",
        title: "Secondary",
        displayTitle: "Weekly",
        remainingPercent: 55,
        resetsIn: "1d 1h",
      },
    ]);
    expect(detail.markdown).toContain("data:image/svg+xml;base64,");
    expect(detailSvg).toContain(">Session<");
    expect(detailSvg).toContain(">Weekly<");
    expect(detailSvg).toContain(">80% left<");
    expect(detailSvg).toContain(">55% left<");
    expect(detailSvg).toContain(">Resets in 1d 1h<");
  });

  it("omits zero-value countdown units", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "claude",
        sessionPercentLeft: 80,
        sessionResetsAt: "2026-03-23T11:00:00Z",
        weeklyPercentLeft: 55,
        weeklyResetsAt: "2026-03-28T10:30:00Z",
      },
      "claude",
      Date.parse("2026-03-23T10:30:00Z"),
    );

    expect(detail.sections[0]).toMatchObject({ resetsIn: "30m" });
    expect(detail.sections[1]).toMatchObject({ resetsIn: "5d" });
  });

  it("keeps sub-day countdowns in hours even when minute rounding reaches 24h", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "claude",
        sessionPercentLeft: 80,
        sessionResetsAt: "2026-03-24T10:29:01Z",
      },
      "claude",
      Date.parse("2026-03-23T10:30:00Z"),
    );

    expect(detail.sections[0]).toMatchObject({ resetsIn: "24h" });
  });

  it("switches to day formatting at an exact 24h boundary", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "claude",
        sessionPercentLeft: 80,
        sessionResetsAt: "2026-03-24T10:30:00Z",
      },
      "claude",
      Date.parse("2026-03-23T10:30:00Z"),
    );

    expect(detail.sections[0]).toMatchObject({ resetsIn: "1d" });
  });

  it("rounds up sub-hour countdowns to the next minute boundary", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "claude",
        sessionPercentLeft: 80,
        sessionResetsAt: "2026-03-23T11:29:01Z",
      },
      "claude",
      Date.parse("2026-03-23T10:30:00Z"),
    );

    expect(detail.sections[0]).toMatchObject({ resetsIn: "1h" });
  });

  it("normalizes provider cost as a typed progress section", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "claude",
        usage: {
          providerCost: {
            used: 1.42,
            limit: 20,
            currencyCode: "USD",
            period: "monthly",
          },
        },
      },
      "claude",
      Date.parse("2026-03-23T10:30:00Z"),
    );
    const [detailSvg] = extractSvgMarkup(detail.markdown);

    expect(detail.sections).toMatchObject([
      {
        kind: "providerCost",
        title: "Extra usage",
        usedPercent: 7,
        spendLine: "monthly: $1.42 / $20",
      },
    ]);
    expect(detailSvg).toContain(">Extra usage<");
    expect(detailSvg).toContain(">monthly: $1.42 / $20<");
    expect(detailSvg).toContain(">7% used<");
  });

  it("keeps sparse payloads as minimal details instead of throwing", () => {
    const detail = normalizeProviderDetailPayload({ provider: "warp" }, "warp");

    expect(detail.id).toBe("warp");
    expect(detail.sections).toEqual([]);
    expect(detail.markdown).toBe("No data available");
  });

  it("extracts provider-specific errors from CLI payload arrays", () => {
    const message = extractProviderErrorMessage(
      [
        { provider: "alibaba", error: { message: "No available fetch strategy for alibaba." } },
        { provider: "cli", error: { message: "Error" } },
      ],
      "alibaba",
    );

    expect(message).toBe("No available fetch strategy for alibaba.");
  });
});
