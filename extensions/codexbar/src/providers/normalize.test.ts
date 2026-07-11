import { describe, expect, it } from "vitest";
import { extractSvgMarkup } from "../../test/svg-markdown";
import { buildProviderDetailMarkdown } from "./markdown";
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
  it("prefers canonical GUI presentation meters over legacy provider windows", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "claude",
        source: "oauth",
        presentation: {
          schemaVersion: 1,
          meters: [
            {
              id: "primary",
              kind: "primary",
              label: "Session",
              usedPercent: 15,
              remainingPercent: 85,
              windowMinutes: 300,
              resetsAt: "2026-03-23T12:00:00Z",
            },
            {
              id: "extra:claude-routines",
              kind: "supplemental",
              label: "Daily Routines",
              usedPercent: 30,
              remainingPercent: 70,
              windowMinutes: 10_080,
              resetsAt: "2026-03-30T10:30:00Z",
            },
          ],
        },
        usage: {
          primary: { usedPercent: 99 },
          secondary: { usedPercent: 99 },
        },
      },
      "claude",
      Date.parse("2026-03-23T10:30:00Z"),
    );

    expect(detail.source).toBe("oauth");
    expect(detail.presentationSchemaVersion).toBe(1);
    expect(detail.sections).toMatchObject([
      { kind: "usage", title: "Primary", displayTitle: "Session", remainingPercent: 85, resetsIn: "1h 30m" },
      { kind: "supplementalUsage", title: "Daily Routines", remainingPercent: 70, resetsIn: "7d" },
    ]);
    expect(detail.sections).toHaveLength(2);
  });

  it("treats an empty canonical meter list as authoritative", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "codex",
        presentation: { schemaVersion: 1, meters: [] },
        usage: { primary: { usedPercent: 20 } },
      },
      "codex",
    );

    expect(detail.sections).toEqual([]);
  });

  it("preserves fractional remaining percent through normalize", () => {
    const fromUsed = normalizeProviderDetailPayload(
      {
        provider: "codex",
        usage: {
          primary: { usedPercent: 99.5 },
          secondary: { usedPercent: 58 },
        },
      },
      "codex",
    );
    expect(fromUsed.sections[0]).toMatchObject({ kind: "usage", title: "Primary", remainingPercent: 0.5 });

    const fromExplicit = normalizeProviderDetailPayload(
      {
        provider: "claude",
        sessionPercentLeft: 0.4,
      },
      "claude",
    );
    expect(fromExplicit.sections[0]).toMatchObject({ kind: "usage", title: "Primary", remainingPercent: 0.4 });

    const fromFraction = normalizeProviderDetailPayload(
      {
        provider: "claude",
        remainingFraction: 0.004,
      },
      "claude",
    );
    expect(fromFraction.sections[0]).toMatchObject({ kind: "usage", title: "Primary", remainingPercent: 0.4 });
  });

  it("normalizes generic provider detail sections", () => {
    const now = Date.parse("2026-03-23T10:30:00Z");
    const detail = normalizeProviderDetailPayload(codexPayload, "codex", now);
    const markdown = buildProviderDetailMarkdown(detail, undefined, { now });
    const [detailSvg] = extractSvgMarkup(markdown);
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
    expect(markdown).toContain("data:image/svg+xml;base64,");
    expect(markdown).not.toContain("prefers-color-scheme");
    expect(detailSvg).not.toContain("dominant-baseline");
    expect(markdown).not.toContain("## Primary");
    expect(markdown).not.toContain("- **Remaining:**");
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
    const now = Date.parse("2026-03-23T10:30:00Z");
    const detail = normalizeProviderDetailPayload(
      {
        provider: "claude",
        sessionPercentLeft: 80,
        sessionResetsAt: "2026-03-23T11:00:00Z",
        weeklyPercentLeft: 55,
        weeklyResetsAt: "2026-03-24T12:00:00Z",
      },
      "claude",
      now,
    );
    const markdown = buildProviderDetailMarkdown(detail, undefined, { now });
    const [detailSvg] = extractSvgMarkup(markdown);

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
    expect(markdown).toContain("data:image/svg+xml;base64,");
    expect(detailSvg).toContain(">Session<");
    expect(detailSvg).toContain(">Weekly<");
    expect(detailSvg).toContain(">80% left<");
    expect(detailSvg).toContain(">55% left<");
    expect(detailSvg).toContain(">Resets in 1d 1h<");
  });

  it("relabels grok's primary bar by window length like the upstream GUI", () => {
    const now = Date.parse("2026-03-23T10:30:00Z");
    const usageTitles = (usage: Record<string, unknown>) =>
      normalizeProviderDetailPayload({ provider: "grok", usage }, "grok", now)
        .sections.filter((section) => section.kind === "usage")
        .map((section) => (section.kind === "usage" ? section.displayTitle : section.title));

    // Explicit weekly window wins over the static "Credits" label.
    expect(usageTitles({ primary: { windowMinutes: 10_080, usedPercent: 40 } })).toEqual(["Weekly"]);
    // Without windowMinutes, the distance to resetsAt decides: ~30 days → Monthly.
    expect(usageTitles({ primary: { usedPercent: 40, resetsAt: "2026-04-22T10:30:00Z" } })).toEqual(["Monthly"]);
    // Short or absent windows keep the static label.
    expect(usageTitles({ primary: { windowMinutes: 30, usedPercent: 40 } })).toEqual(["Credits"]);
    expect(usageTitles({ primary: { usedPercent: 40 } })).toEqual(["Credits"]);
    // In-between lengths (~2 weeks) match neither range and keep the static label.
    expect(usageTitles({ primary: { usedPercent: 40, resetsAt: "2026-04-06T10:30:00Z" } })).toEqual(["Credits"]);
  });

  it("relabels doubao's primary bar as Requests for windowless request-style payloads", () => {
    const now = Date.parse("2026-03-23T10:30:00Z");
    const usageTitles = (usage: Record<string, unknown>) =>
      normalizeProviderDetailPayload({ provider: "doubao", usage }, "doubao", now)
        .sections.filter((section) => section.kind === "usage")
        .map((section) => (section.kind === "usage" ? section.displayTitle : section.title));

    // No window + request-style reset detail → pay-as-you-go account.
    expect(usageTitles({ primary: { usedPercent: 40, resetDescription: "1,200 requests left" } })).toEqual([
      "Requests",
    ]);
    // An explicit window means the regular 5h plan window, whatever the detail says.
    expect(
      usageTitles({ primary: { windowMinutes: 300, usedPercent: 40, resetDescription: "1,200 requests left" } }),
    ).toEqual(["5-hour"]);
    expect(usageTitles({ primary: { usedPercent: 40 } })).toEqual(["5-hour"]);
  });

  it("relabels factory windows as 5-hour/Weekly/Monthly when a tertiary window is present", () => {
    const now = Date.parse("2026-03-23T10:30:00Z");
    const usageTitles = (usage: Record<string, unknown>) =>
      normalizeProviderDetailPayload({ provider: "factory", usage }, "factory", now)
        .sections.filter((section) => section.kind === "usage")
        .map((section) => (section.kind === "usage" ? section.displayTitle : section.title));

    expect(
      usageTitles({ primary: { usedPercent: 10 }, secondary: { usedPercent: 20 }, tertiary: { usedPercent: 30 } }),
    ).toEqual(["5-hour", "Weekly", "Monthly"]);
    expect(usageTitles({ primary: { usedPercent: 10 }, secondary: { usedPercent: 20 } })).toEqual([
      "Standard",
      "Premium",
    ]);
  });

  it("attaches raw usage pacing to supported weekly sections and renders GUI-style footers", () => {
    const now = Date.parse("2026-04-16T12:30:00Z");
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
      now,
    );
    const [detailSvg] = extractSvgMarkup(buildProviderDetailMarkdown(detail, undefined, { now }));

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
    expect(detailSvg).toContain(">40% in reserve<");
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
    expect(buildProviderDetailMarkdown(detail)).toBe("No data available");
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
    const markdown = buildProviderDetailMarkdown(detail);
    const [detailSvg] = extractSvgMarkup(markdown);

    expect(detail.sections).toEqual([]);
    expect(detail.accountEmail).toBe("dev@example.com");
    expect(detail.planText).toBe("Gcloud");
    expect(markdown).toContain("data:image/svg+xml;base64,");
    expect(detailSvg).toContain(">Vertex AI<");
    expect(detailSvg).toContain(">dev@example.com<");
    expect(detailSvg).toContain(">Gcloud<");
  });

  it("prefers Claude subscription plan fields over generic oauth login methods", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "claude",
        loginMethod: "oauth",
        plan: "max",
      },
      "claude",
    );
    const [detailSvg] = extractSvgMarkup(buildProviderDetailMarkdown(detail));

    expect(detail.planText).toBe("Max");
    expect(detailSvg).toContain(">Max<");
    expect(detailSvg).not.toContain(">OAuth<");
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
    const now = Date.parse("2026-03-23T10:30:00Z");
    const detail = normalizeProviderDetailPayload(
      {
        provider: "claude",
        usage: {
          primary: { usedPercent: 30, resetsAt: "2026-03-23T12:00:00Z", nextRegenPercent: 4 },
        },
      },
      "claude",
      now,
    );
    const [detailSvg] = extractSvgMarkup(buildProviderDetailMarkdown(detail, undefined, { now }));

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

  it("filters unavailable and expired Codex reset credits", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "codex",
        usage: {
          codexResetCredits: {
            credits: [
              {
                status: "available",
                reset_type: "weekly",
                granted_at: "2026-03-22T10:30:00Z",
                expires_at: "2026-03-24T10:30:00Z",
              },
              {
                status: "redeemed",
                reset_type: "weekly",
                granted_at: "2026-03-22T10:30:00Z",
                expires_at: "2026-03-25T10:30:00Z",
              },
              {
                status: "available",
                reset_type: "weekly",
                granted_at: "2026-03-22T10:30:00Z",
                expires_at: "2026-03-23T10:29:00Z",
              },
              {
                status: "unknown",
                reset_type: "weekly",
                granted_at: "2026-03-22T10:30:00Z",
                expires_at: "2026-03-26T10:30:00Z",
              },
            ],
          },
        },
      },
      "codex",
      Date.parse("2026-03-23T10:30:00Z"),
    );

    expect(detail.sections).toContainEqual({
      kind: "info",
      title: "Limit Reset Credits",
      items: [
        { label: "Available", value: "1 available" },
        { label: "Next expiry", value: "1d" },
      ],
    });
  });

  it("sorts Codex reset credits by expiry with no-expiry credits last", () => {
    const detail = normalizeProviderDetailPayload(
      {
        provider: "codex",
        usage: {
          codexResetCredits: {
            credits: [
              { status: "available" },
              { status: "available", expires_at: "2026-03-25T10:30:00Z" },
              { status: "available", expires_at: "2026-03-24T10:30:00Z" },
            ],
          },
        },
      },
      "codex",
      Date.parse("2026-03-23T10:30:00Z"),
    );

    expect(detail.sections).toContainEqual({
      kind: "info",
      title: "Limit Reset Credits",
      items: [
        { label: "Available", value: "3 available" },
        { label: "Next expiry", value: "1d" },
        { label: "Expiries", value: "1d, 2d, No expiry" },
      ],
    });
  });

  it("renders no Codex reset credit section when inventory is empty or non-Codex", () => {
    const emptyCodex = normalizeProviderDetailPayload(
      {
        provider: "codex",
        usage: {
          codexResetCredits: {
            credits: [
              { status: "redeemed", expires_at: "2026-03-24T10:30:00Z" },
              { status: "available", expires_at: "2026-03-23T10:29:00Z" },
            ],
          },
        },
      },
      "codex",
      Date.parse("2026-03-23T10:30:00Z"),
    );
    const claudeWithCredits = normalizeProviderDetailPayload(
      {
        provider: "claude",
        usage: {
          codexResetCredits: {
            credits: [{ status: "available", expires_at: "2026-03-24T10:30:00Z" }],
          },
        },
      },
      "claude",
      Date.parse("2026-03-23T10:30:00Z"),
    );

    expect(emptyCodex.sections.some((section) => section.title === "Limit Reset Credits")).toBe(false);
    expect(claudeWithCredits.sections.some((section) => section.title === "Limit Reset Credits")).toBe(false);
  });

  it("renders Codex reset credit info in the detail markdown", () => {
    const now = Date.parse("2026-03-23T10:30:00Z");
    const detail = normalizeProviderDetailPayload(
      {
        provider: "codex",
        usage: {
          primary: { usedPercent: 40 },
          codexResetCredits: {
            credits: [{ status: "available", expires_at: "2026-03-24T10:30:00Z" }],
          },
        },
      },
      "codex",
      now,
    );
    const [detailSvg] = extractSvgMarkup(buildProviderDetailMarkdown(detail, undefined, { now }));

    expect(detailSvg).toContain(">Limit Reset Credits<");
    expect(detailSvg).toContain(">Available<");
    expect(detailSvg).toContain(">1 available<");
    expect(detailSvg).toContain(">Next expiry<");
    expect(detailSvg).toContain(">1d<");
  });
});

describe("usage pacing gating", () => {
  const NOW = Date.parse("2026-03-23T10:30:00Z");
  // Session window resets 2.5h out (inside the 5h session cadence).
  const SESSION_RESETS_AT = "2026-03-23T13:00:00Z";
  // Weekly window resets 5d out (inside the 7d weekly cadence).
  const WEEKLY_RESETS_AT = "2026-03-28T10:30:00Z";

  function pace(provider: string, usage: Record<string, unknown>) {
    return normalizeProviderDetailPayload({ provider, usage }, provider, NOW).sections;
  }

  it("paces the codex/claude session window with the 300-min default when windowMinutes is absent", () => {
    for (const provider of ["codex", "claude"] as const) {
      const [primary] = pace(provider, { primary: { usedPercent: 60, resetsAt: SESSION_RESETS_AT } });
      expect(primary, provider).toMatchObject({
        title: "Primary",
        usagePacing: { stage: "over", context: "session" },
      });
    }
  });

  it("only paces the ollama session window when the payload carries an explicit windowMinutes", () => {
    const [withoutWindow] = pace("ollama", { primary: { usedPercent: 60, resetsAt: SESSION_RESETS_AT } });
    expect(withoutWindow.usagePacing).toBeUndefined();

    const [withWindow] = pace("ollama", {
      primary: { windowMinutes: 300, usedPercent: 60, resetsAt: SESSION_RESETS_AT },
    });
    expect(withWindow.usagePacing).toMatchObject({ context: "session" });
  });

  it("paces the antigravity session window when windowMinutes is omitted or exactly 300", () => {
    const [withoutWindow] = pace("antigravity", { primary: { usedPercent: 60, resetsAt: SESSION_RESETS_AT } });
    expect(withoutWindow.usagePacing).toMatchObject({ stage: "over", context: "session" });

    const [withSessionWindow] = pace("antigravity", {
      primary: { windowMinutes: 300, usedPercent: 60, resetsAt: SESSION_RESETS_AT },
    });
    expect(withSessionWindow.usagePacing).toMatchObject({ stage: "over", context: "session" });
  });

  it("does not pace the antigravity session window when windowMinutes is present and not 300", () => {
    const [primary] = pace("antigravity", {
      primary: { windowMinutes: 10_080, usedPercent: 60, resetsAt: SESSION_RESETS_AT },
    });
    expect(primary.usagePacing).toBeUndefined();
  });

  it("never paces the session window for providers outside the whitelist", () => {
    const [primary] = pace("cursor", {
      primary: { windowMinutes: 300, usedPercent: 60, resetsAt: SESSION_RESETS_AT },
    });
    expect(primary.usagePacing).toBeUndefined();
  });

  it("paces the codex secondary window with the 10080-min default when windowMinutes is absent", () => {
    const [secondary] = pace("codex", { secondary: { usedPercent: 50, resetsAt: WEEKLY_RESETS_AT } });
    expect(secondary).toMatchObject({
      title: "Secondary",
      usagePacing: { stage: "farOver", context: "window" },
    });
  });

  it("does not extend the codex default-window fallback to the tertiary slot", () => {
    const [tertiary] = pace("codex", { tertiary: { usedPercent: 50, resetsAt: WEEKLY_RESETS_AT } });
    expect(tertiary.usagePacing).toBeUndefined();
  });

  it("only paces a generic provider's weekly window when windowMinutes is explicit", () => {
    const [withoutWindow] = pace("factory", { secondary: { usedPercent: 50, resetsAt: WEEKLY_RESETS_AT } });
    expect(withoutWindow.usagePacing).toBeUndefined();

    const [withWindow] = pace("factory", {
      secondary: { windowMinutes: 10_080, usedPercent: 50, resetsAt: WEEKLY_RESETS_AT },
    });
    expect(withWindow.usagePacing).toMatchObject({ context: "window" });
  });

  it("paces cursor billing-cycle windows that carry windowMinutes via the generic rule", () => {
    const [secondary] = pace("cursor", {
      secondary: { windowMinutes: 10_080, usedPercent: 50, resetsAt: WEEKLY_RESETS_AT },
    });
    expect(secondary.usagePacing).toMatchObject({ context: "window" });
  });

  it("paces named extra rate windows only when they carry windowMinutes", () => {
    const withoutWindow = pace("codex", {
      primary: { usedPercent: 40, resetsAt: SESSION_RESETS_AT },
      extraRateWindows: [
        { id: "codex-spark", title: "Codex Spark", window: { usedPercent: 60, resetsAt: SESSION_RESETS_AT } },
      ],
    });
    expect(withoutWindow.find((section) => section.title === "Codex Spark")?.usagePacing).toBeUndefined();

    const withWindow = pace("codex", {
      primary: { usedPercent: 40, resetsAt: SESSION_RESETS_AT },
      extraRateWindows: [
        {
          id: "codex-spark",
          title: "Codex Spark",
          window: { windowMinutes: 300, usedPercent: 60, resetsAt: SESSION_RESETS_AT },
        },
      ],
    });
    expect(withWindow.find((section) => section.title === "Codex Spark")?.usagePacing).toMatchObject({
      context: "window",
    });
  });
});
