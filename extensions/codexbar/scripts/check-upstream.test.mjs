import { describe, expect, it } from "vitest";
import { checkUpstream } from "./check-upstream.mjs";
import {
  compareProviders,
  parseDescriptorMetadata,
  parseDynamicOverrideProviders,
  providerColorToHex,
} from "./lib/upstream-metadata.mjs";
import {
  comparePaceCapabilities,
  expandCustomFingerprint,
  parseDescriptorPace,
  parseExtraRateWindowPaceProviders,
  parseSecondarySessionPaceProviders,
} from "./lib/upstream-pace.mjs";

const CATALOG_FIXTURE = {
  codex: {
    name: "Codex",
    iconSlug: "codex",
    brandColor: "#49A3B0",
    usageSectionLabels: { primary: "Session", secondary: "Weekly" },
    dashboardUrl: "https://chatgpt.com/codex/settings/usage",
    statusPageUrl: "https://status.openai.com/",
  },
  claude: {
    name: "Claude",
    iconSlug: "claude",
    brandColor: "#CC7C5E",
    usageSectionLabels: { primary: "Session", secondary: "Weekly", tertiary: "Sonnet" },
    dashboardUrl: "https://console.anthropic.com/settings/billing",
    subscriptionDashboardUrl: "https://claude.ai/settings/usage",
  },
  mistral: {
    name: "Mistral",
    iconSlug: "mistral",
    brandColor: "#FF500F",
    usageSectionLabels: { primary: "Balance" },
  },
};

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
  pace = "",
  extra = "",
} = {}) {
  const paceField = pace ? `,\n            pace: ${pace}` : "";
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
                color: ProviderColor(${color}))${paceField})
    }
    ${extra}
}
`;
}

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

  it("passes when catalog and upstream agree", () => {
    expect(compareProviders(CATALOG_FIXTURE, matchingUpstream, claudeAllowance)).toEqual([]);
  });

  it("throws when the catalog is empty", () => {
    expect(() => compareProviders({}, matchingUpstream)).toThrow(/empty/);
  });

  it("reports field mismatches, missing providers on both sides, and empty-vs-omitted equality", () => {
    const drifted = new Map(matchingUpstream);
    drifted.set("codex", { ...matchingUpstream.get("codex"), sessionLabel: "5-hour" });
    drifted.set("extra", { ...matchingUpstream.get("codex"), id: "extra" });
    drifted.delete("mistral");

    const problems = compareProviders(CATALOG_FIXTURE, drifted, claudeAllowance);
    expect(problems).toContainEqual(
      expect.stringContaining('codex: usageSectionLabels.primary "Session" != upstream "5-hour"'),
    );
    expect(problems).toContainEqual(expect.stringContaining("mistral: present in catalog.ts"));
    expect(problems).toContainEqual(expect.stringContaining("extra: upstream provider missing"));
    expect(problems).toHaveLength(3);
  });

  it("expires allowlist entries when either side moves", () => {
    const allowances = {
      ...claudeAllowance,
      codex: { dashboardUrl: { ours: "https://old.example", upstream: "https://other.example", reason: "fixture" } },
    };
    const problems = compareProviders(CATALOG_FIXTURE, matchingUpstream, allowances);
    expect(problems).toContainEqual(expect.stringContaining("codex: stale ALLOWED_DIVERGENCES entry for dashboardUrl"));
  });

  it("flags allowlist entries that match no comparison", () => {
    const allowances = {
      ...claudeAllowance,
      ghost: { dashboardUrl: { ours: "x", upstream: "y", reason: "fixture" } },
    };
    const problems = compareProviders(CATALOG_FIXTURE, matchingUpstream, allowances);
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
    const source = descriptorFixture({ pace: ".calendarMonthResetWindow" });
    expect(parseDescriptorPace(source, "Amp.swift").resetWindowPace).toEqual({
      type: "windowDuration",
      minutes: 43_200,
    });
  });

  it("parses Cursor windowDurationPresent and Grok custom fingerprints", () => {
    expect(
      parseDescriptorPace(
        descriptorFixture({ pace: "ProviderPaceCapability(resetWindowPace: .windowDurationPresent)" }),
        "Cursor.swift",
      ).resetWindowPace,
    ).toEqual({
      type: "windowDurationPresent",
    });

    const grok = `ProviderPaceCapability(
                resetWindowPace: .custom { window, now in
                    guard Self.primaryLabel(window: window, now: now) == "Weekly",
                          let resetsAt = window.resetsAt
                    else { return false }
                    let windowMinutes = window.windowMinutes ?? 7 * 24 * 60
                    let timeUntilReset = resetsAt.timeIntervalSince(now)
                    return windowMinutes > 0
                        && timeUntilReset > 0
                        && timeUntilReset <= TimeInterval(windowMinutes) * 60
                })`;
    const parsed = parseDescriptorPace(descriptorFixture({ pace: grok }), "Grok.swift");
    expect(parsed.resetWindowPace.type).toBe("custom");
    expect(parsed.resetWindowPace.fingerprint).toContain('primaryLabel(window: window, now: now) == "Weekly"');
  });

  it("ignores a pace: comment outside ProviderDescriptor", () => {
    const source = `// pace: .unsupported\n${descriptorFixture({ pace: ".calendarMonthResetWindow" })}`;
    expect(parseDescriptorPace(source, "Amp.swift").resetWindowPace).toEqual({
      type: "windowDuration",
      minutes: 43_200,
    });
  });

  it("expands Self.foo wrappers and Self constants in custom fingerprints", () => {
    const source = descriptorFixture({
      pace: `ProviderPaceCapability(
                resetWindowPace: .custom { window, _ in
                    Self.isMonthlyMCPWindow(window)
                },
                sessionPaceWindowRule: .custom { window, _ in
                    guard let minutes = window.windowMinutes else { return false }
                    return minutes <= Self.rollingWindowMaxMinutes
                })`,
      extra: `
    public static let rollingWindowMaxMinutes = 6 * 60
    private static func isMonthlyMCPWindow(_ window: RateWindow) -> Bool {
        window.windowMinutes == ProviderPaceCapability.monthlyWindowSentinelMinutes
            && window.resetDescription == "MCP"
    }
`,
    });
    const parsed = parseDescriptorPace(source, "Zai.swift");
    expect(parsed.resetWindowPace).toEqual({
      type: "custom",
      fingerprint: 'window.windowMinutes == 43200 && window.resetDescription == "MCP"',
    });
    expect(parsed.sessionPaceWindowRule.fingerprint).toContain("minutes <= 360");
  });

  it("throws on an unparseable pace value", () => {
    expect(() => parseDescriptorPace(descriptorFixture({ pace: ".mystery" }), "X.swift")).toThrow(/unparseable pace/);
  });
});

describe("expandCustomFingerprint", () => {
  it("inlines a Self.helper call body", () => {
    const source = `
    private static func isMonthlyMCPWindow(_ window: RateWindow) -> Bool {
        window.resetDescription == "MCP"
    }
`;
    expect(expandCustomFingerprint(source, "window, _ in Self.isMonthlyMCPWindow(window)")).toBe(
      'window.resetDescription == "MCP"',
    );
  });
});

describe("parseSecondarySessionPaceProviders", () => {
  it("collects provider == next to sessionPaceDetail inside secondaryMetric", () => {
    const secondary = `
    private static func secondaryMetric(input: Input) -> Metric {
        var paceDetail = if input.provider == .kimi {
            Self.sessionPaceDetail(provider: input.provider, window: weekly)
        }
        return Metric()
    }
`;
    const extras = `
    private static func extraRateWindowPaceDetail(provider: UsageProvider) {
        if provider == .codex {
            return self.sessionPaceDetail(provider: provider, window: window)
        }
    }
`;
    expect([...parseSecondarySessionPaceProviders([{ path: "a.swift", content: secondary }])]).toEqual(["kimi"]);
    expect([...parseSecondarySessionPaceProviders([{ path: "b.swift", content: extras }])]).toEqual([]);
  });
});

describe("parseExtraRateWindowPaceProviders", () => {
  it("collects provider == inside extraRateWindowPaceDetail", () => {
    const content = `
    private static func extraRateWindowPaceDetail(provider: UsageProvider) -> PaceDetail? {
        if provider == .claude, window.windowMinutes != 10080 { return nil }
        guard provider == .codex || provider == .claude || provider == .antigravity else { return nil }
        return nil
    }
`;
    expect([...parseExtraRateWindowPaceProviders([{ path: "a.swift", content }])].sort()).toEqual([
      "antigravity",
      "claude",
      "codex",
    ]);
  });

  it("throws when the helper is missing", () => {
    expect(() => parseExtraRateWindowPaceProviders([{ path: "Gone.swift", content: "// nothing" }])).toThrow(
      /extraRateWindowPaceDetail/,
    );
  });
});

describe("comparePaceCapabilities", () => {
  const grokOurs = new Map([
    [
      "grok",
      {
        resetWindowPace: { type: "custom", id: "grokWeeklyCredits" },
        inferredMonthlyDuration: { type: "unsupported" },
        sessionPaceWindowRule: { type: "unsupported" },
      },
    ],
  ]);

  it("maps matching custom fingerprints onto ids", () => {
    const grok = parseDescriptorPace(
      descriptorFixture({
        pace: `ProviderPaceCapability(
                resetWindowPace: .custom { window, now in
                    guard Self.primaryLabel(window: window, now: now) == "Weekly"
                    else { return false }
                })`,
      }),
      "Grok.swift",
    );
    const { problems } = comparePaceCapabilities(grokOurs, new Map([["grok", { pace: grok }]]), {
      "grok.resetWindowPace": {
        id: "grokWeeklyCredits",
        fingerprint: grok.resetWindowPace.fingerprint,
      },
    });
    expect(problems).toEqual([]);
  });

  it("prints the field that diverged", () => {
    const grok = parseDescriptorPace(
      descriptorFixture({
        pace: "ProviderPaceCapability(resetWindowPace: .windowDurationPresent)",
      }),
      "Grok.swift",
    );
    const { problems } = comparePaceCapabilities(grokOurs, new Map([["grok", { pace: grok }]]), {});
    expect(problems).toEqual([
      'grok: resetWindowPace {"type":"custom","id":"grokWeeklyCredits"} != upstream {"type":"windowDurationPresent"}',
    ]);
  });
});

function fakeSource(files) {
  return {
    label: "fixture tree",
    listFiles: async (prefix, suffix) =>
      Object.keys(files).filter((filePath) => filePath.startsWith(prefix) && filePath.endsWith(suffix)),
    readFile: async (filePath) => {
      if (!(filePath in files)) {
        throw new Error(`missing ${filePath}`);
      }
      return files[filePath];
    },
  };
}

const TOY_CATALOG = {
  toy: {
    name: "Codex",
    iconSlug: "toy",
    brandColor: "#49A3B0",
    usageSectionLabels: { primary: "Session", secondary: "Weekly" },
    dashboardUrl: "https://chatgpt.com/codex/settings/usage",
    statusPageUrl: "https://status.openai.com/",
  },
};

const TOY_PACE = {
  toy: {
    resetWindowPace: { type: "unsupported" },
    inferredMonthlyDuration: { type: "unsupported" },
    sessionPaceWindowRule: { type: "unsupported" },
  },
};

const LABEL_RENDERER = "let labels = descriptor.presentation.rateWindowLabels(metadata: meta, snapshot: snap)\n";
const PACE_RENDERER = "func extraRateWindowPaceDetail(provider: UsageProvider) -> PaceDetail? { return nil }\n";

const TOY_POLICY = {
  catalog: TOY_CATALOG,
  paceCapabilities: TOY_PACE,
  extraWindowIds: new Set(),
  implementedTitles: new Set(),
  unportableTitles: {},
  customPaceRules: {},
  allowedDivergences: {},
  unportableHeadroom: {},
  unportablePresentation: {},
  rendererPaths: ["Sources/CodexBar/MenuDescriptor.swift"],
  paceRendererPaths: ["Sources/CodexBar/MenuCardView.swift"],
};

describe("checkUpstream", () => {
  it("passes a matching one-provider fixture tree", async () => {
    const result = await checkUpstream(
      fakeSource({
        "Sources/CodexBarCore/Providers/Toy/ToyProviderDescriptor.swift": descriptorFixture({ id: "toy" }),
        "Sources/CodexBar/MenuDescriptor.swift": LABEL_RENDERER,
        "Sources/CodexBar/MenuCardView.swift": PACE_RENDERER,
      }),
      TOY_POLICY,
    );
    expect(result.problems).toEqual([]);
  });

  it("fails when the catalog omits an upstream provider", async () => {
    const result = await checkUpstream(
      fakeSource({
        "Sources/CodexBarCore/Providers/Toy/ToyProviderDescriptor.swift": descriptorFixture({ id: "toy" }),
        "Sources/CodexBar/MenuDescriptor.swift": LABEL_RENDERER,
        "Sources/CodexBar/MenuCardView.swift": PACE_RENDERER,
      }),
      { ...TOY_POLICY, catalog: { other: TOY_CATALOG.toy } },
    );
    expect(result.problems.some((problem) => problem.includes("toy: upstream provider missing"))).toBe(true);
  });

  it("fails when descriptor pace: drifts from the imported table", async () => {
    const result = await checkUpstream(
      fakeSource({
        "Sources/CodexBarCore/Providers/Toy/ToyProviderDescriptor.swift": descriptorFixture({
          id: "toy",
          pace: "ProviderPaceCapability(resetWindowPace: .windowDurationPresent)",
        }),
        "Sources/CodexBar/MenuDescriptor.swift": LABEL_RENDERER,
        "Sources/CodexBar/MenuCardView.swift": PACE_RENDERER,
      }),
      TOY_POLICY,
    );
    expect(result.problems.some((problem) => problem.includes("toy: resetWindowPace"))).toBe(true);
  });
});

