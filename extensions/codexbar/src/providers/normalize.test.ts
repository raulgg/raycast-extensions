import { describe, expect, it } from "vitest";
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
    accountEmail: "dev@example.com",
    loginMethod: "pro",
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
    const expectedHeaderUpdated = "1h ago";

    expect(detail.id).toBe("codex");
    expect(detail.name).toBe("Codex");
    expect(detail.updatedAt).toBe("2026-03-23T09:00:00Z");
    expect(detail.accountEmail).toBe("dev@example.com");
    expect(detail.planText).toBe("Pro");
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
    ]);
    expect(detail.markdown).toContain("data:image/svg+xml;base64,");
    expect(detail.markdown).not.toContain("prefers-color-scheme");
    expect(detailSvg).not.toContain("dominant-baseline");
    expect(detail.markdown).not.toContain("## Primary");
    expect(detail.markdown).not.toContain("- **Remaining:**");
    expect(detailSvg).toContain("<title>Codex detail</title>");
    expect(detailSvg).toContain(">Codex<");
    expect(detailSvg).toContain(">dev@example.com<");
    expect(detailSvg).toContain(">Pro<");
    expect(detailSvg).toContain(`>Updated ${expectedHeaderUpdated}<`);
    expect(detailSvg).toContain(">Session<");
    expect(detailSvg).toContain(">Weekly<");
    expect(detailSvg).toContain(">53% left<");
    expect(detailSvg).toContain(">Resets in 1h 30m");
    expect(detailSvg).toContain(">Code review<");
    expect(detailSvg).toContain(">78% left<");
    // Credits, Cost, and General are no longer surfaced — usage meters only.
    expect(detailSvg).not.toContain(">Credits<");
    expect(detailSvg).not.toContain(">General<");
    expect(detailSvg.match(/<line /g)).toHaveLength(1);
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

  it("attaches raw usage pacing to supported weekly sections and renders GUI-style footers", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "codex",
        usage: {
          secondary: {
            windowMinutes: 10_080,
            usedPercent: 53,
            resetsAt: "2026-04-17T00:17:00Z",
          },
        },
      },
      "codex",
      Date.parse("2026-04-16T12:30:00Z"),
    );
    const [detailSvg] = extractSvgMarkup(detail.markdown);

    expect(detail.sections).toMatchObject([
      {
        kind: "usage",
        title: "Secondary",
        displayTitle: "Weekly",
        remainingPercent: 47,
        resetsIn: "11h 47m",
        usagePacing: {
          stage: "farUnder",
          actualUsedPercent: 53,
          lastsUntilReset: true,
          computedAt: "2026-04-16T12:30:00.000Z",
        },
      },
    ]);
    expect(detailSvg).toContain(">47% left<");
    expect(detailSvg).toContain(">Resets in 11h 47m<");
    expect(detailSvg).toContain(">40% behind<");
    expect(detailSvg).toContain(">Lasts until reset<");
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

  it("keeps sparse payloads as minimal details instead of throwing", () => {
    const detail = normalizeProviderDetailPayload({ provider: "warp" }, "warp");

    expect(detail.id).toBe("warp");
    expect(detail.sections).toEqual([]);
    expect(detail.markdown).toBe("No data available");
  });

  it("renders header-only details when account metadata exists without usage sections", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "vertexai",
        usage: {
          accountEmail: "dev@example.com",
          loginMethod: "gcloud",
        },
      },
      "vertexai",
    );
    const [detailSvg] = extractSvgMarkup(detail.markdown);

    expect(detail.sections).toEqual([]);
    expect(detail.accountEmail).toBe("dev@example.com");
    expect(detail.planText).toBe("Gcloud");
    expect(detail.markdown).toContain("data:image/svg+xml;base64,");
    expect(detailSvg).toContain(">Vertex AI<");
    expect(detailSvg).toContain(">dev@example.com<");
    expect(detailSvg).toContain(">Gcloud<");
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

  it("renders named extra rate windows after the slot sections", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "codex",
        usage: {
          primary: { usedPercent: 40, resetsAt: "2026-03-23T12:00:00Z" },
          extraRateWindows: [
            {
              id: "codex-spark",
              title: "Codex Spark",
              window: { usedPercent: 25, resetsAt: "2026-03-23T15:30:00Z", nextRegenPercent: 5 },
            },
          ],
        },
      },
      "codex",
      Date.parse("2026-03-23T10:30:00Z"),
    );

    expect(detail.sections).toMatchObject([
      { kind: "usage", title: "Primary", remainingPercent: 60 },
      {
        kind: "supplementalUsage",
        title: "Codex Spark",
        remainingPercent: 75,
        resetsIn: "5h",
        nextRegenPercent: 5,
      },
    ]);
  });

  it("passes nextRegenPercent through slot windows and renders the regen footer", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "claude",
        usage: {
          primary: { usedPercent: 30, resetsAt: "2026-03-23T12:00:00Z", nextRegenPercent: 4 },
        },
      },
      "claude",
      Date.parse("2026-03-23T10:30:00Z"),
    );
    const [detailSvg] = extractSvgMarkup(detail.markdown);

    expect(detail.sections[0]).toMatchObject({ kind: "usage", nextRegenPercent: 4 });
    expect(detailSvg).toContain(">Regenerates 4% next tick<");
  });

  it("maps openRouterUsage into supplemental and info sections", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "openrouter",
        usage: {
          openRouterUsage: {
            usedPercent: 49,
            balance: 25.5,
            keyUsage: 47,
            keyLimit: 100,
          },
        },
      },
      "openrouter",
      Date.parse("2026-03-23T10:30:00Z"),
    );

    expect(detail.sections).toMatchObject([
      { kind: "supplementalUsage", title: "Credits used", remainingPercent: 51 },
      {
        kind: "info",
        title: "OpenRouter",
        items: [
          { label: "Balance", value: "$25.50" },
          { label: "Key usage", value: "$47 / $100" },
        ],
      },
    ]);
  });
});
