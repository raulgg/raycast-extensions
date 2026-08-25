import { describe, expect, it } from "vitest";
import {
  comparePaceCapabilities,
  compareProviders,
  parseDescriptorMetadata,
  parseDescriptorPace,
  parseDynamicOverrideProviders,
  parsePaceCapabilitiesTable,
  parseRegistryEntries,
  providerColorToHex,
} from "./lib/upstream-metadata.mjs";

const REGISTRY_FIXTURE = `
const PROVIDER_DEFINITIONS = {
  codex: {
    name: "Codex",
    icon: providerIcon("codex", Icon.Terminal),
    brandColor: "#49A3B0",
    usageSectionLabels: { primary: "Session", secondary: "Weekly" },
    dashboardUrl: "https://chatgpt.com/codex/settings/usage",
    statusPageUrl: "https://status.openai.com/",
  },
  claude: {
    name: "Claude",
    icon: providerIcon("claude", Icon.Bubble),
    brandColor: "#CC7C5E",
    usageSectionLabels: { primary: "Session", secondary: "Weekly", tertiary: "Sonnet" },
    dashboardUrl: "https://console.anthropic.com/settings/billing",
    subscriptionDashboardUrl: "https://claude.ai/settings/usage",
  },
  mistral: {
    name: "Mistral",
    icon: providerIcon("mistral", Icon.Bolt),
    brandColor: "#FF500F",
    usageSectionLabels: { primary: "Balance" },
  },
} satisfies Record<string, ProviderDefinition>;
`;

function descriptorFixture({
  id = "codex",
  displayName = "Codex",
  sessionLabel = "Session",
  weeklyLabel = "Weekly",
  opusLabel = "nil",
  dashboardURL = '"https://chatgpt.com/codex/settings/usage"',
  statusPageURL = '"https://status.openai.com/"',
  statusLinkURL = "nil",
  color = "red: 73 / 255, green: 163 / 255, blue: 176 / 255",
  extra = "",
} = {}) {
  return `
public enum FixtureProviderDescriptor {
    static func makeDescriptor() -> ProviderDescriptor {
        ProviderDescriptor(
            id: .${id},
            metadata: ProviderMetadata(
                id: .${id},
                displayName: "${displayName}",
                sessionLabel: "${sessionLabel}",
                weeklyLabel: "${weeklyLabel}",
                opusLabel: ${opusLabel},
                toggleTitle: "Show usage",
                cliName: "${id}",
                dashboardURL: ${dashboardURL},
                statusPageURL: ${statusPageURL},
                statusLinkURL: ${statusLinkURL}),
            branding: ProviderBranding(
                iconStyle: .monochrome,
                color: ProviderColor(${color})))
    }
    ${extra}
}
`;
}

describe("parseRegistryEntries", () => {
  it("parses every field of a provider entry", () => {
    const entries = parseRegistryEntries(REGISTRY_FIXTURE);
    expect(entries.size).toBe(3);
    expect(entries.get("claude")).toEqual({
      name: "Claude",
      icon: 'providerIcon("claude", Icon.Bubble)',
      brandColor: "#CC7C5E",
      dashboardUrl: "https://console.anthropic.com/settings/billing",
      subscriptionDashboardUrl: "https://claude.ai/settings/usage",
      statusPageUrl: undefined,
      labels: { primary: "Session", secondary: "Weekly", tertiary: "Sonnet" },
    });
    expect(entries.get("mistral").labels).toEqual({ primary: "Balance", secondary: undefined, tertiary: undefined });
  });

  it("throws when the definitions block or labels are unparseable", () => {
    expect(() => parseRegistryEntries("const SOMETHING_ELSE = {};")).toThrow(/PROVIDER_DEFINITIONS/);
    const withoutLabels = REGISTRY_FIXTURE.replace(/ *usageSectionLabels: \{ primary: "Balance" \},\n/, "");
    expect(() => parseRegistryEntries(withoutLabels)).toThrow(/mistral/);
  });

  it("throws when an entry block stops matching the expected shape", () => {
    // Reformatting an entry (here: extra indentation on its closing brace) must fail
    // the coverage guard rather than silently dropping the provider.
    const malformed = REGISTRY_FIXTURE.replace('usageSectionLabels: { primary: "Balance" },\n  },', "},");
    expect(() => parseRegistryEntries(malformed)).toThrow(/Parsed 2 of 3/);
  });
});

describe("parseDescriptorMetadata", () => {
  it("parses string fields, nil fields, and colors", () => {
    const metadata = parseDescriptorMetadata(descriptorFixture());
    expect(metadata).toMatchObject({
      id: "codex",
      displayName: "Codex",
      sessionLabel: "Session",
      weeklyLabel: "Weekly",
      opusLabel: undefined,
      dashboardURL: "https://chatgpt.com/codex/settings/usage",
      statusPageURL: "https://status.openai.com/",
      statusLinkURL: undefined,
      brandColorHex: "#49A3B0",
      definesDynamicPrimaryLabel: false,
    });
  });

  it("surfaces non-literal URL values as expr: sentinels", () => {
    const metadata = parseDescriptorMetadata(
      descriptorFixture({ dashboardURL: "ZaiAPIRegion.global.dashboardURL.absoluteString" }),
    );
    expect(metadata.dashboardURL).toBe("expr:ZaiAPIRegion.global.dashboardURL.absoluteString");
  });

  it("reads displayName from the ProviderMetadata literal, not an earlier displayName", () => {
    const metadata = parseDescriptorMetadata(
      `enum Fixture {
            static let credentials = ProviderCredentialAdapter.regionValidator(displayName: "Alibaba Coding Plan")
            ${descriptorFixture({ displayName: "Alibaba" })}
        }`,
    );
    expect(metadata.displayName).toBe("Alibaba");
  });

  it("parses ProviderColor(hex:) branding colors", () => {
    const metadata = parseDescriptorMetadata(
      descriptorFixture().replace(
        "color: ProviderColor(red: 73 / 255, green: 163 / 255, blue: 176 / 255)",
        "color: ProviderColor(hex: 0xA04DFD)",
      ),
    );
    expect(metadata.brandColorHex).toBe("#A04DFD");
  });

  it("treats trailing-paren nil values as absent", () => {
    const metadata = parseDescriptorMetadata(descriptorFixture({ statusPageURL: "nil", statusLinkURL: "nil" }));
    expect(metadata.statusPageURL).toBeUndefined();
    expect(metadata.statusLinkURL).toBeUndefined();
  });

  it("detects descriptor-level dynamic primary labels", () => {
    const metadata = parseDescriptorMetadata(
      descriptorFixture({ extra: "public static func primaryLabel(window: RateWindow?) -> String? { nil }" }),
    );
    expect(metadata.definesDynamicPrimaryLabel).toBe(true);
  });

  it("rejects files without exactly one ProviderMetadata literal", () => {
    expect(() => parseDescriptorMetadata("struct Nothing {}", "Nothing.swift")).toThrow(/expected exactly 1/);
    expect(() => parseDescriptorMetadata(descriptorFixture() + descriptorFixture(), "Double.swift")).toThrow(
      /expected exactly 1/,
    );
  });
});

describe("providerColorToHex", () => {
  it("handles /255 fractions, bare fractions, and bare integers", () => {
    expect(providerColorToHex("16 / 255", "163 / 255", "127 / 255")).toBe("#10A37F");
    expect(providerColorToHex("0.06", "0.51", "0.43")).toBe("#0F826E");
    expect(providerColorToHex("1", "0.6", "0")).toBe("#FF9900");
  });

  it("throws on expressions it cannot evaluate", () => {
    expect(() => providerColorToHex("Color.red", "0", "0")).toThrow(/Unrecognized/);
  });
});

describe("parseDynamicOverrideProviders", () => {
  it("collects descriptor primaryLabel calls and rateWindowLabels conditionals", () => {
    const rendererFixture = `
    private static func rateWindowLabels(provider: UsageProvider) -> Labels {
        if provider == .factory, snapshot.tertiary != nil { return factoryLabels }
        let primaryLabel = if provider == .cursor, snapshot.cursorRequests != nil {
            "Requests"
        } else if provider == .grok {
            GrokProviderDescriptor.primaryLabel(window: snapshot.primary) ?? metadata.sessionLabel
        } else {
            metadata.sessionLabel
        }
    }

    private static func unrelated(provider: UsageProvider) {
        if provider == .codex { }
    }
`;
    const widgetFixture = `
    let title = DoubaoProviderDescriptor.primaryLabel(window: snapshot.primary) ?? "Session"
`;
    const providers = parseDynamicOverrideProviders([
      { path: "MenuDescriptor.swift", content: rendererFixture },
      { path: "Widget.swift", content: widgetFixture },
    ]);
    expect([...providers].sort()).toEqual(["cursor", "doubao", "factory", "grok"]);
  });

  it("throws when a renderer no longer contains any known label site", () => {
    expect(() => parseDynamicOverrideProviders([{ path: "Gone.swift", content: "// nothing here" }])).toThrow(
      /Gone.swift/,
    );
  });

  it("accepts CLI renderers that delegate to presentation.rateWindowLabels", () => {
    const providers = parseDynamicOverrideProviders([
      {
        path: "CLIRenderer.swift",
        content: "let labels = descriptor.presentation.rateWindowLabels(metadata: meta, snapshot: snap)",
      },
    ]);
    expect(providers.size).toBe(0);
  });
});

describe("compareProviders", () => {
  const registry = parseRegistryEntries(REGISTRY_FIXTURE);
  const matchingUpstream = new Map(
    [
      parseDescriptorMetadata(descriptorFixture()),
      parseDescriptorMetadata(
        descriptorFixture({
          id: "claude",
          displayName: "Claude",
          opusLabel: '"Sonnet"',
          dashboardURL: '"https://console.anthropic.com/settings/billing"',
          statusPageURL: "nil",
          color: "red: 204 / 255, green: 124 / 255, blue: 94 / 255",
          extra: 'static let subscription = "x"',
        }),
      ),
      parseDescriptorMetadata(
        descriptorFixture({
          id: "mistral",
          displayName: "Mistral",
          sessionLabel: "Balance",
          weeklyLabel: "",
          dashboardURL: "nil",
          statusPageURL: "nil",
          color: "red: 1.0, green: 80 / 255, blue: 15 / 255",
        }),
      ),
    ].map((metadata) => [metadata.id, metadata]),
  );

  // The claude fixture omits subscriptionDashboardURL, which the registry fixture has.
  const claudeAllowance = {
    claude: {
      subscriptionDashboardUrl: {
        ours: "https://claude.ai/settings/usage",
        upstream: undefined,
        reason: "fixture",
      },
    },
  };

  it("passes when registry and upstream agree", () => {
    expect(compareProviders(registry, matchingUpstream, claudeAllowance)).toEqual([]);
  });

  it("reports field mismatches, missing providers on both sides, and empty-vs-omitted equality", () => {
    const drifted = new Map(matchingUpstream);
    drifted.set("codex", { ...matchingUpstream.get("codex"), sessionLabel: "5-hour" });
    drifted.set("extra", { ...matchingUpstream.get("codex"), id: "extra" });
    drifted.delete("mistral");

    const problems = compareProviders(registry, drifted, claudeAllowance);
    expect(problems).toContainEqual(expect.stringContaining('codex: labels.primary "Session" != upstream "5-hour"'));
    expect(problems).toContainEqual(expect.stringContaining("mistral: present in registry.ts"));
    expect(problems).toContainEqual(expect.stringContaining("extra: upstream provider missing"));
    expect(problems).toHaveLength(3);
  });

  it("expires allowlist entries when either side moves", () => {
    const allowances = {
      ...claudeAllowance,
      codex: { dashboardUrl: { ours: "https://old.example", upstream: "https://other.example", reason: "fixture" } },
    };
    const problems = compareProviders(registry, matchingUpstream, allowances);
    expect(problems).toContainEqual(expect.stringContaining("codex: stale ALLOWED_DIVERGENCES entry for dashboardUrl"));
  });

  it("flags allowlist entries that match no comparison", () => {
    const allowances = {
      ...claudeAllowance,
      ghost: { dashboardUrl: { ours: "x", upstream: "y", reason: "fixture" } },
    };
    const problems = compareProviders(registry, matchingUpstream, allowances);
    expect(problems).toContainEqual(expect.stringContaining("ghost: ALLOWED_DIVERGENCES entry"));
  });
});

describe("parseDescriptorPace", () => {
  it("defaults to unsupported when pace is omitted", () => {
    expect(parseDescriptorPace(descriptorFixture(), "Codex.swift")).toEqual({
      resetWindowPace: { type: "unsupported" },
      inferredMonthlyDuration: { type: "unsupported" },
      sessionPaceWindowRule: { type: "unsupported" },
    });
  });

  it("expands .calendarMonthResetWindow", () => {
    const source = descriptorFixture({ extra: "pace: .calendarMonthResetWindow," });
    expect(parseDescriptorPace(source, "Amp.swift").resetWindowPace).toEqual({
      type: "windowDuration",
      minutes: 43_200,
    });
  });

  it("parses Cursor windowDurationPresent and Grok custom fingerprints", () => {
    const cursor = `
            pace: ProviderPaceCapability(resetWindowPace: .windowDurationPresent),
    `;
    expect(parseDescriptorPace(descriptorFixture({ extra: cursor }), "Cursor.swift").resetWindowPace).toEqual({
      type: "windowDurationPresent",
    });

    const grok = `
            pace: ProviderPaceCapability(
                resetWindowPace: .custom { window, now in
                    guard Self.primaryLabel(window: window, now: now) == "Weekly",
                          let resetsAt = window.resetsAt
                    else { return false }
                    let windowMinutes = window.windowMinutes ?? 7 * 24 * 60
                    let timeUntilReset = resetsAt.timeIntervalSince(now)
                    return windowMinutes > 0
                        && timeUntilReset > 0
                        && timeUntilReset <= TimeInterval(windowMinutes) * 60
                }),
    `;
    const parsed = parseDescriptorPace(descriptorFixture({ extra: grok }), "Grok.swift");
    expect(parsed.resetWindowPace.type).toBe("custom");
    expect(parsed.resetWindowPace.fingerprint).toContain('primaryLabel(window: window, now: now) == "Weekly"');
  });

  it("throws on an unparseable pace value", () => {
    expect(() => parseDescriptorPace(descriptorFixture({ extra: "pace: .mystery," }), "X.swift")).toThrow(
      /unparseable pace/,
    );
  });
});

describe("parsePaceCapabilitiesTable", () => {
  it("parses custom ids and sentinel minutes", () => {
    const source = `
export const PACE_CAPABILITIES = {
  grok: {
    resetWindowPace: { type: "custom", id: "grokWeeklyCredits" },
    inferredMonthlyDuration: { type: "unsupported" },
    sessionPaceWindowRule: { type: "unsupported" },
  },
  alibaba: {
    resetWindowPace: { type: "windowDuration", minutes: MONTHLY_WINDOW_SENTINEL_MINUTES },
    inferredMonthlyDuration: { type: "windowDuration", minutes: MONTHLY_WINDOW_SENTINEL_MINUTES },
    sessionPaceWindowRule: { type: "unsupported" },
  },
} satisfies Record<string, PaceCapability>;
`;
    const entries = parsePaceCapabilitiesTable(source);
    expect(entries.get("grok").resetWindowPace).toEqual({ type: "custom", id: "grokWeeklyCredits" });
    expect(entries.get("alibaba").resetWindowPace).toEqual({ type: "windowDuration", minutes: 43_200 });
  });
});

describe("comparePaceCapabilities", () => {
  it("maps matching custom fingerprints onto ids", () => {
    const ours = parsePaceCapabilitiesTable(`
export const PACE_CAPABILITIES = {
  grok: {
    resetWindowPace: { type: "custom", id: "grokWeeklyCredits" },
    inferredMonthlyDuration: { type: "unsupported" },
    sessionPaceWindowRule: { type: "unsupported" },
  },
} satisfies Record<string, PaceCapability>;
`);
    const grok = parseDescriptorPace(
      descriptorFixture({
        extra: `
            pace: ProviderPaceCapability(
                resetWindowPace: .custom { window, now in
                    guard Self.primaryLabel(window: window, now: now) == "Weekly"
                    else { return false }
                }),
    `,
      }),
      "Grok.swift",
    );
    const { problems } = comparePaceCapabilities(ours, new Map([["grok", { pace: grok }]]), {
      "grok.resetWindowPace": {
        id: "grokWeeklyCredits",
        fingerprint: grok.resetWindowPace.fingerprint,
      },
    });
    expect(problems).toEqual([]);
  });
});

