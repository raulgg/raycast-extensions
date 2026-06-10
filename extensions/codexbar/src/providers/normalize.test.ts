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
    const expectedUpdated = formatLocalDateTime("2026-03-23T09:00:00Z");
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
    expect(detailSvg).toContain(">dev@example.com<");
    expect(detailSvg).toContain(">Pro<");
    expect(detailSvg).toContain(`>Updated ${expectedHeaderUpdated}<`);
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

  it("surfaces source, version, account, organization, and subscription dates in General", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "claude",
        source: "openai-web",
        version: "2.1.170",
        account: "work",
        usage: {
          primary: { usedPercent: 10, resetsAt: "2026-03-23T12:00:00Z" },
          subscriptionRenewsAt: "2026-04-01T00:00:00Z",
          subscriptionExpiresAt: "2026-05-01T00:00:00Z",
          identity: { accountOrganization: "Example Labs" },
          updatedAt: "2026-03-23T09:00:00Z",
        },
      },
      "claude",
      Date.parse("2026-03-23T10:30:00Z"),
    );

    expect(detail.source).toBe("OpenAI Web");
    expect(detail.cliVersion).toBe("2.1.170");
    expect(detail.accountLabel).toBe("work");
    expect(detail.accountOrganization).toBe("Example Labs");

    const generalSection = detail.sections.find((section) => section.kind === "info" && section.title === "General");
    expect(generalSection).toMatchObject({
      kind: "info",
      title: "General",
      items: [
        { label: "Last Updated", value: formatLocalDateTime("2026-03-23T09:00:00Z") },
        { label: "Source", value: "OpenAI Web" },
        { label: "Version", value: "2.1.170" },
        { label: "Account", value: "work", personal: true },
        { label: "Organization", value: "Example Labs", personal: true },
        { label: "Renews", value: formatLocalDateTime("2026-04-01T00:00:00Z") },
        { label: "Expires", value: formatLocalDateTime("2026-05-01T00:00:00Z") },
      ],
    });
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

  it("lists recent credit events newest first and caps them at three", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "codex",
        credits: {
          remaining: 10,
          events: [
            { id: "1", date: "2026-03-20T10:00:00Z", service: "Codex", creditsUsed: 1.5 },
            { id: "2", date: "2026-03-23T10:00:00Z", service: "Code Review", creditsUsed: 2 },
            { id: "3", date: "2026-03-21T10:00:00Z", service: "Codex", creditsUsed: 0.5 },
            { id: "4", date: "2026-03-19T10:00:00Z", service: "Codex", creditsUsed: 4 },
          ],
        },
      },
      "codex",
      Date.parse("2026-03-23T10:30:00Z"),
    );

    const eventsSection = detail.sections.find(
      (section) => section.kind === "info" && section.title === "Recent credit activity",
    );
    expect(eventsSection).toMatchObject({
      items: [
        { label: "Mar 23 · Code Review", value: "2 credits" },
        { label: "Mar 21 · Codex", value: "0.5 credits" },
        { label: "Mar 20 · Codex", value: "1.5 credits" },
      ],
    });
  });

  it("summarizes the OpenAI dashboard daily credit spend", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "codex",
        openaiDashboard: {
          usageBreakdown: [
            { day: "2026-03-22", totalCreditsUsed: 3.5, services: [{ service: "CLI", creditsUsed: 3.5 }] },
            { day: "2026-03-23", totalCreditsUsed: 1.25, services: [{ service: "Code Review", creditsUsed: 1.25 }] },
          ],
        },
      },
      "codex",
      Date.parse("2026-03-23T10:30:00Z"),
    );

    const spendSection = detail.sections.find(
      (section) => section.kind === "info" && section.title === "Daily credit spend",
    );
    expect(spendSection).toMatchObject({
      items: [
        { label: "Mar 23", value: "1.3 credits" },
        { label: "Mar 22", value: "3.5 credits" },
      ],
    });
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
