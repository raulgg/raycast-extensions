import { Color, Icon, type Image } from "@raycast/api";

export type ProviderProgressPalette = {
  lightFill: string;
  darkFill: string;
};

export type ProviderUsageSectionLabels = {
  primary: string;
  secondary: string;
  tertiary?: string;
};

export type ProviderUsagePacingSlot = "primary" | "secondary" | "tertiary";

export type ProviderRegistryEntry = {
  id: string;
  name: string;
  icon: Image.ImageLike;
  brandColor: string;
  progressPalette: ProviderProgressPalette;
  usageSectionLabels: ProviderUsageSectionLabels;
  usagePacingSlot?: ProviderUsagePacingSlot;
};

type ProviderDefinition = Omit<ProviderRegistryEntry, "id" | "progressPalette">;

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

const PROVIDER_DEFINITIONS = {
  codex: {
    name: "Codex",
    icon: providerIcon("codex", Icon.Terminal),
    brandColor: "#49A3B0",
    usageSectionLabels: { primary: "Session", secondary: "Weekly" },
    usagePacingSlot: "secondary",
  },
  claude: {
    name: "Claude",
    icon: providerIcon("claude", Icon.Bubble),
    brandColor: "#CC7C5E",
    usageSectionLabels: { primary: "Session", secondary: "Weekly", tertiary: "Sonnet" },
    usagePacingSlot: "secondary",
  },
  cursor: {
    name: "Cursor",
    icon: providerIcon("cursor", Icon.ArrowRightCircle),
    brandColor: "#00BFA5",
    usageSectionLabels: { primary: "Total", secondary: "Auto", tertiary: "API" },
  },
  opencode: {
    name: "OpenCode",
    icon: providerIcon("opencode", Icon.Code),
    brandColor: "#3B82F6",
    usageSectionLabels: { primary: "5-hour", secondary: "Weekly" },
    usagePacingSlot: "secondary",
  },
  opencodego: {
    name: "OpenCode Go",
    icon: providerIcon("opencodego", Icon.Code),
    brandColor: "#3B82F6",
    usageSectionLabels: { primary: "5-hour", secondary: "Weekly", tertiary: "Monthly" },
  },
  alibaba: {
    name: "Alibaba",
    icon: providerIcon("alibaba"),
    brandColor: "#FF6A00",
    usageSectionLabels: { primary: "5-hour", secondary: "Weekly", tertiary: "Monthly" },
  },
  factory: {
    name: "Factory",
    icon: providerIcon("factory"),
    brandColor: "#FF6B35",
    usageSectionLabels: { primary: "Standard", secondary: "Premium" },
  },
  gemini: {
    name: "Gemini",
    icon: providerIcon("gemini", Icon.Bolt),
    brandColor: "#AB87EA",
    usageSectionLabels: { primary: "Pro", secondary: "Flash", tertiary: "Flash Lite" },
  },
  antigravity: {
    name: "Antigravity",
    icon: providerIcon("antigravity"),
    brandColor: "#60BA7E",
    usageSectionLabels: { primary: "Claude", secondary: "Gemini Pro", tertiary: "Gemini Flash" },
  },
  copilot: {
    name: "GitHub Copilot",
    icon: providerIcon("copilot", Icon.Person),
    brandColor: "#A855F7",
    usageSectionLabels: { primary: "Premium", secondary: "Chat" },
  },
  zai: {
    name: "Z.ai",
    icon: providerIcon("zai", Icon.Globe),
    brandColor: "#E85A6A",
    usageSectionLabels: { primary: "Tokens", secondary: "MCP", tertiary: "5-hour" },
  },
  minimax: {
    name: "MiniMax",
    icon: providerIcon("minimax"),
    brandColor: "#FE603C",
    usageSectionLabels: { primary: "Prompts", secondary: "Window" },
  },
  kimi: {
    name: "Kimi",
    icon: providerIcon("kimi"),
    brandColor: "#FE603C",
    usageSectionLabels: { primary: "Weekly", secondary: "Rate Limit" },
  },
  kilo: {
    name: "Kilo",
    icon: providerIcon("kilo", Icon.BarChart),
    brandColor: "#F27027",
    usageSectionLabels: { primary: "Credits", secondary: "Kilo Pass" },
  },
  kiro: {
    name: "Kiro",
    icon: providerIcon("kiro"),
    brandColor: "#FF9900",
    usageSectionLabels: { primary: "Credits", secondary: "Bonus" },
  },
  vertexai: {
    name: "Vertex AI",
    icon: providerIcon("vertexai", Icon.Globe),
    brandColor: "#4285F4",
    usageSectionLabels: { primary: "Requests", secondary: "Tokens" },
  },
  augment: {
    name: "Augment",
    icon: providerIcon("augment", Icon.Bolt),
    brandColor: "#6366F1",
    usageSectionLabels: { primary: "Credits", secondary: "Usage" },
  },
  jetbrains: {
    name: "JetBrains",
    icon: providerIcon("jetbrains", Icon.AppWindow),
    brandColor: "#FF3399",
    usageSectionLabels: { primary: "Current", secondary: "Refill" },
  },
  kimik2: {
    name: "Kimi K2",
    icon: Icon.Circle,
    brandColor: "#4C00FF",
    usageSectionLabels: { primary: "Credits", secondary: "Credits" },
  },
  amp: {
    name: "Amp",
    icon: providerIcon("amp", Icon.Bolt),
    brandColor: "#DC2626",
    usageSectionLabels: { primary: "Amp Free", secondary: "Balance" },
  },
  ollama: {
    name: "Ollama",
    icon: providerIcon("ollama", Icon.Box),
    brandColor: "#888888",
    usageSectionLabels: { primary: "Session", secondary: "Weekly" },
  },
  synthetic: {
    name: "Synthetic",
    icon: providerIcon("synthetic"),
    brandColor: "#141414",
    usageSectionLabels: { primary: "Quota", secondary: "Usage" },
  },
  warp: {
    name: "Warp",
    icon: providerIcon("warp", Icon.ArrowRightCircle),
    brandColor: "#938BB4",
    usageSectionLabels: { primary: "Credits", secondary: "Add-on credits" },
  },
  openrouter: {
    name: "OpenRouter",
    icon: providerIcon("openrouter", Icon.TwoPeople),
    brandColor: "#6467F2",
    usageSectionLabels: { primary: "Credits", secondary: "Usage" },
  },
  perplexity: {
    name: "Perplexity",
    icon: providerIcon("perplexity", Icon.Globe),
    brandColor: "#20B2AA",
    usageSectionLabels: { primary: "Credits", secondary: "Bonus credits", tertiary: "Purchased" },
  },
} satisfies Record<string, ProviderDefinition>;

export const PROVIDER_IDS = Object.keys(PROVIDER_DEFINITIONS);
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

function buildProviderEntry(id: string, definition: ProviderDefinition): ProviderRegistryEntry {
  return {
    id,
    ...definition,
    brandColor: normalizeHexColor(definition.brandColor),
    progressPalette: buildProgressPalette(definition.brandColor),
  };
}

const PROVIDER_ENTRIES = PROVIDER_IDS.map((id) => buildProviderEntry(id, PROVIDER_DEFINITIONS[id]));

const PROVIDER_REGISTRY = new Map<string, ProviderRegistryEntry>(PROVIDER_ENTRIES.map((entry) => [entry.id, entry]));

function fallbackName(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function isKnownProviderId(id: string): boolean {
  return PROVIDER_REGISTRY.has(id);
}

export function isProviderSelectorId(id: string): boolean {
  return PROVIDER_SELECTOR_ID_SET.has(id);
}

export function getProviderMetadata(id: string): ProviderRegistryEntry {
  const entry = PROVIDER_REGISTRY.get(id);
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

export function getProviderUsageSectionDisplayTitle(providerId: string, sectionTitle: string): string {
  const labels = getProviderMetadata(providerId).usageSectionLabels;

  if (sectionTitle === "Primary") {
    return labels.primary;
  }

  if (sectionTitle === "Secondary") {
    return labels.secondary;
  }

  if (sectionTitle === "Tertiary") {
    return labels.tertiary ?? sectionTitle;
  }

  return sectionTitle;
}
