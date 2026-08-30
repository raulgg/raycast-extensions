import { Color, Icon, type Image } from "@raycast/api";
import {
  PROVIDER_CATALOG,
  PROVIDER_ID_ALIASES,
  type ProviderCatalogEntry,
  type ProviderIconFallback,
  type ProviderUsageSectionLabels,
} from "./catalog";

export type { ProviderUsageSectionLabels };

export type ProviderProgressPalette = {
  lightFill: string;
  darkFill: string;
};

export type ProviderRegistryEntry = {
  id: string;
  name: string;
  icon: Image.ImageLike;
  brandColor: string;
  progressPalette: ProviderProgressPalette;
  usageSectionLabels: ProviderUsageSectionLabels;
  dashboardUrl?: string;
  subscriptionDashboardUrl?: string;
  statusPageUrl?: string;
};

const DEFAULT_PROGRESS_PALETTE: ProviderProgressPalette = {
  lightFill: "#22B8CF",
  darkFill: "#4EC8DD",
};

function providerIcon(slug: string, fallback: Icon = Icon.Circle): Image.ImageLike {
  return {
    source: `provider-icons/${slug}.svg`,
    fallback,
    tintColor: Color.PrimaryText,
  };
}

function iconFromFallback(name: ProviderIconFallback | undefined): Icon {
  if (!name) {
    return Icon.Circle;
  }

  const value = (Icon as unknown as Record<string, Icon | undefined>)[name];
  if (value === undefined) {
    throw new Error(`Unknown icon fallback "${name}"`);
  }

  return value;
}

export function resolveProviderId(id: string): string {
  return PROVIDER_ID_ALIASES[id] ?? id;
}

export const PROVIDER_IDS = Object.keys(PROVIDER_CATALOG) as Array<keyof typeof PROVIDER_CATALOG>;
export const PROVIDER_SELECTOR_IDS = ["all", "both"] as const;
const PROVIDER_SELECTOR_ID_SET = new Set<string>(PROVIDER_SELECTOR_IDS);

function clampColorChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizeHexColor(value: string): string {
  const normalized = value.trim().toUpperCase();
  return normalized.startsWith("#") ? normalized : `#${normalized}`;
}

function parseHexColor(value: string): [number, number, number] {
  const normalized = normalizeHexColor(value).slice(1);
  if (!/^[0-9A-F]{6}$/.test(normalized)) {
    throw new Error(`Invalid hex color: ${value}`);
  }

  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function formatHexColor(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((channel) => clampColorChannel(channel).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function mixHexColors(baseColor: string, targetColor: string, ratio: number): string {
  const [baseRed, baseGreen, baseBlue] = parseHexColor(baseColor);
  const [targetRed, targetGreen, targetBlue] = parseHexColor(targetColor);

  return formatHexColor(
    baseRed + (targetRed - baseRed) * ratio,
    baseGreen + (targetGreen - baseGreen) * ratio,
    baseBlue + (targetBlue - baseBlue) * ratio,
  );
}

function buildProgressPalette(brandColor: string): ProviderProgressPalette {
  const lightFill = normalizeHexColor(brandColor);
  return {
    lightFill,
    darkFill: mixHexColors(lightFill, "#FFFFFF", 0.2),
  };
}

function registryEntryFromCatalog(id: string, entry: ProviderCatalogEntry): ProviderRegistryEntry {
  const brandColor = normalizeHexColor(entry.brandColor);
  return {
    id,
    name: entry.name,
    icon: providerIcon(entry.iconSlug, iconFromFallback(entry.iconFallback)),
    brandColor,
    progressPalette: buildProgressPalette(brandColor),
    usageSectionLabels: entry.usageSectionLabels,
    dashboardUrl: entry.dashboardUrl,
    subscriptionDashboardUrl: entry.subscriptionDashboardUrl,
    statusPageUrl: entry.statusPageUrl,
  };
}

const PROVIDER_ENTRIES = PROVIDER_IDS.map((id) => registryEntryFromCatalog(id, PROVIDER_CATALOG[id]));

const PROVIDER_REGISTRY = new Map<string, ProviderRegistryEntry>(PROVIDER_ENTRIES.map((entry) => [entry.id, entry]));

function fallbackName(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function isKnownProviderId(id: string): boolean {
  return PROVIDER_REGISTRY.has(resolveProviderId(id));
}

export function isProviderSelectorId(id: string): boolean {
  return PROVIDER_SELECTOR_ID_SET.has(id);
}

export function getProviderMetadata(id: string): ProviderRegistryEntry {
  const entry = PROVIDER_REGISTRY.get(resolveProviderId(id));
  if (entry) {
    return entry;
  }

  return {
    id,
    name: fallbackName(id),
    icon: Icon.Circle,
    brandColor: DEFAULT_PROGRESS_PALETTE.lightFill,
    progressPalette: DEFAULT_PROGRESS_PALETTE,
    usageSectionLabels: { primary: "Primary", secondary: "Secondary", tertiary: "Tertiary" },
  };
}

export function getProviderProgressPalette(id: string): ProviderProgressPalette {
  return getProviderMetadata(id).progressPalette;
}

// Ports CodexBarCore/Providers/Claude/ClaudePlan.swift. `fromCompatibilityLoginMethod`
// splits the login-method / plan string into alphanumeric words and matches the
// first plan keyword in priority order. `isSubscriptionLoginMethod` then treats
// Max, Pro, Team, and Ultra as subscriptions while Enterprise is not.
type ClaudePlan = "max" | "pro" | "team" | "enterprise" | "ultra";

const CLAUDE_SUBSCRIPTION_PLANS = new Set<ClaudePlan>(["max", "pro", "team", "ultra"]);

function normalizedPlanWords(text: string | undefined): string[] {
  return (text ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function claudePlanFromLoginMethod(text: string | undefined): ClaudePlan | undefined {
  const words = normalizedPlanWords(text);
  if (words.length === 0) {
    return undefined;
  }
  if (words.includes("max") || words.some((word) => word.includes("claudemax"))) {
    return "max";
  }
  if (words.includes("pro") || words.includes("claudepro")) {
    return "pro";
  }
  if (words.includes("team") || words.includes("claudeteam")) {
    return "team";
  }
  if (words.includes("enterprise") || words.includes("claudeenterprise")) {
    return "enterprise";
  }
  if (words.includes("ultra") || words.includes("claudeultra")) {
    return "ultra";
  }
  return undefined;
}

// Mirrors ClaudePlan.isSubscriptionLoginMethod: true only for Max/Pro/Team/Ultra
// login methods (case-insensitive, whether the text is a slug like "max" or a
// prettified label like "Claude Max"). API-key/OAuth/Enterprise/undefined → false.
export function isClaudeSubscriptionLoginMethod(text: string | undefined): boolean {
  const plan = claudePlanFromLoginMethod(text);
  return plan === undefined ? false : CLAUDE_SUBSCRIPTION_PLANS.has(plan);
}

// Picks the "Open Usage Dashboard" target.
export function resolveDashboardUrl(providerId: string, planText?: string): string | undefined {
  const metadata = getProviderMetadata(providerId);
  // Claude serves two audiences: API accounts get the console billing page, subscription
  // plans get claude.ai usage (upstream StatusItemController+Actions.swift:273-277 plan switch).
  if (resolveProviderId(providerId) === "claude") {
    return isClaudeSubscriptionLoginMethod(planText)
      ? (metadata.subscriptionDashboardUrl ?? metadata.dashboardUrl)
      : metadata.dashboardUrl;
  }
  // Other dual-URL providers have no plan detection, and the usage this extension meters
  // is their subscription usage — so the subscription dashboard is the better target when
  // upstream provides one. Deliberate divergence from upstream, which only plan-switches Claude.
  return metadata.subscriptionDashboardUrl ?? metadata.dashboardUrl;
}

export function getProviderUsageSectionDisplayTitle(providerId: string, sectionTitle: string): string {
  const labels = getProviderMetadata(providerId).usageSectionLabels;

  if (sectionTitle === "Primary") {
    return labels.primary;
  }

  if (sectionTitle === "Secondary") {
    return labels.secondary ?? sectionTitle;
  }

  if (sectionTitle === "Tertiary") {
    return labels.tertiary ?? sectionTitle;
  }

  return sectionTitle;
}
