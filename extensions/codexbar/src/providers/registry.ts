import { Color, Icon, type ImageLike } from "@raycast/api";

export type ProviderProgressPalette = {
  lightFill: string;
  darkFill: string;
};

export type ProviderRegistryEntry = {
  id: string;
  name: string;
  icon: ImageLike;
  brandColor: string;
  progressPalette: ProviderProgressPalette;
};

type ProviderDefinition = Omit<ProviderRegistryEntry, "id" | "progressPalette">;

const DEFAULT_PROGRESS_PALETTE: ProviderProgressPalette = {
  lightFill: "#22B8CF",
  darkFill: "#4EC8DD",
};

function providerIcon(slug: string, fallback: Icon = Icon.Circle): ImageLike {
  return {
    source: `providers/ProviderIcon-${slug}.svg`,
    fallback,
    tintColor: Color.PrimaryText,
  };
}

const PROVIDER_DEFINITIONS = {
  codex: { name: "Codex", icon: providerIcon("codex", Icon.Terminal), brandColor: "#49A3B0" },
  claude: { name: "Claude", icon: providerIcon("claude", Icon.Bubble), brandColor: "#CC7C5E" },
  cursor: { name: "Cursor", icon: providerIcon("cursor", Icon.ArrowRightCircle), brandColor: "#00BFA5" },
  opencode: { name: "OpenCode", icon: providerIcon("opencode", Icon.Code), brandColor: "#3B82F6" },
  alibaba: { name: "Alibaba", icon: providerIcon("alibaba"), brandColor: "#FF6A00" },
  factory: { name: "Factory", icon: providerIcon("factory"), brandColor: "#FF6B35" },
  gemini: { name: "Gemini", icon: providerIcon("gemini", Icon.Bolt), brandColor: "#AB87EA" },
  antigravity: { name: "Antigravity", icon: providerIcon("antigravity"), brandColor: "#60BA7E" },
  copilot: { name: "GitHub Copilot", icon: providerIcon("copilot", Icon.Person), brandColor: "#A855F7" },
  zai: { name: "Z.ai", icon: providerIcon("zai", Icon.Globe), brandColor: "#E85A6A" },
  minimax: { name: "MiniMax", icon: providerIcon("minimax"), brandColor: "#FE603C" },
  kimi: { name: "Kimi", icon: providerIcon("kimi"), brandColor: "#FE603C" },
  kilo: { name: "Kilo", icon: providerIcon("kilo", Icon.BarChart), brandColor: "#F27027" },
  kiro: { name: "Kiro", icon: providerIcon("kiro"), brandColor: "#FF9900" },
  vertexai: { name: "Vertex AI", icon: providerIcon("vertexai", Icon.Globe), brandColor: "#4285F4" },
  augment: { name: "Augment", icon: providerIcon("augment", Icon.Bolt), brandColor: "#6366F1" },
  jetbrains: { name: "JetBrains", icon: providerIcon("jetbrains", Icon.AppWindow), brandColor: "#FF3399" },
  kimik2: { name: "Kimi K2", icon: Icon.Circle, brandColor: "#4C00FF" },
  amp: { name: "Amp", icon: providerIcon("amp", Icon.Bolt), brandColor: "#DC2626" },
  ollama: { name: "Ollama", icon: providerIcon("ollama", Icon.Box), brandColor: "#888888" },
  synthetic: { name: "Synthetic", icon: providerIcon("synthetic"), brandColor: "#141414" },
  warp: { name: "Warp", icon: providerIcon("warp", Icon.ArrowRightCircle), brandColor: "#938BB4" },
  openrouter: { name: "OpenRouter", icon: providerIcon("openrouter", Icon.TwoPeople), brandColor: "#6467F2" },
  perplexity: { name: "Perplexity", icon: providerIcon("perplexity", Icon.Globe), brandColor: "#20B2AA" },
} satisfies Record<string, ProviderDefinition>;

export const PROVIDER_IDS = Object.keys(PROVIDER_DEFINITIONS);
export const PROVIDER_SELECTOR_IDS = ["all", "both"] as const;

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
  return (PROVIDER_SELECTOR_IDS as readonly string[]).includes(id);
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
  };
}

export function getProviderProgressPalette(id: string): ProviderProgressPalette {
  return getProviderMetadata(id).progressPalette;
}
