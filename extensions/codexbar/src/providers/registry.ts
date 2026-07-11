import { Color, Icon, type Image } from "@raycast/api";

export type ProviderProgressPalette = {
  lightFill: string;
  darkFill: string;
};

export type ProviderUsageSectionLabels = {
  primary: string;
  secondary?: string;
  tertiary?: string;
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
    statusPageUrl: "https://status.claude.com/",
  },
  cursor: {
    name: "Cursor",
    icon: providerIcon("cursor", Icon.ArrowRightCircle),
    brandColor: "#00BFA5",
    usageSectionLabels: { primary: "Total", secondary: "Auto", tertiary: "API" },
    dashboardUrl: "https://cursor.com/dashboard?tab=usage",
    statusPageUrl: "https://status.cursor.com",
  },
  opencode: {
    name: "OpenCode",
    icon: providerIcon("opencode", Icon.Code),
    brandColor: "#3B82F6",
    usageSectionLabels: { primary: "5-hour", secondary: "Weekly" },
    dashboardUrl: "https://opencode.ai",
  },
  opencodego: {
    name: "OpenCode Go",
    icon: providerIcon("opencodego", Icon.Code),
    brandColor: "#3B82F6",
    usageSectionLabels: { primary: "5-hour", secondary: "Weekly", tertiary: "Monthly" },
    dashboardUrl: "https://opencode.ai",
  },
  alibaba: {
    name: "Alibaba",
    icon: providerIcon("alibaba"),
    brandColor: "#FF6A00",
    usageSectionLabels: { primary: "5-hour", secondary: "Weekly", tertiary: "Monthly" },
    dashboardUrl: "https://modelstudio.console.alibabacloud.com/ap-southeast-1/?tab=coding-plan#/efm/coding_plan",
    statusPageUrl: "https://status.aliyun.com",
  },
  factory: {
    name: "Droid",
    icon: providerIcon("factory"),
    brandColor: "#FF6B35",
    usageSectionLabels: { primary: "Standard", secondary: "Premium" },
    dashboardUrl: "https://app.factory.ai/settings/billing",
    statusPageUrl: "https://status.factory.ai",
  },
  gemini: {
    name: "Gemini",
    icon: providerIcon("gemini", Icon.Bolt),
    brandColor: "#AB87EA",
    usageSectionLabels: { primary: "Pro", secondary: "Flash", tertiary: "Flash Lite" },
    dashboardUrl: "https://gemini.google.com",
    statusPageUrl: "https://www.google.com/appsstatus/dashboard/products/npdyhgECDJ6tB66MxXyo/history",
  },
  antigravity: {
    name: "Antigravity",
    icon: providerIcon("antigravity"),
    brandColor: "#60BA7E",
    usageSectionLabels: { primary: "Gemini Models", secondary: "Claude and GPT" },
    statusPageUrl: "https://www.google.com/appsstatus/dashboard/products/npdyhgECDJ6tB66MxXyo/history",
  },
  copilot: {
    name: "Copilot",
    icon: providerIcon("copilot", Icon.Person),
    brandColor: "#A855F7",
    usageSectionLabels: { primary: "Premium", secondary: "Chat" },
    dashboardUrl: "https://github.com/settings/copilot",
    statusPageUrl: "https://www.githubstatus.com/",
  },
  zai: {
    name: "z.ai",
    icon: providerIcon("zai", Icon.Globe),
    brandColor: "#E85A6A",
    usageSectionLabels: { primary: "Tokens", secondary: "MCP", tertiary: "5-hour" },
    dashboardUrl: "https://z.ai/manage-apikey/coding-plan/personal/my-plan",
  },
  minimax: {
    name: "MiniMax",
    icon: providerIcon("minimax"),
    brandColor: "#FE603C",
    usageSectionLabels: { primary: "Prompts", secondary: "Window" },
    dashboardUrl: "https://platform.minimax.io/user-center/payment/coding-plan?cycle_type=3",
  },
  kimi: {
    name: "Kimi",
    icon: providerIcon("kimi"),
    brandColor: "#FE603C",
    usageSectionLabels: { primary: "Weekly", secondary: "Rate Limit" },
    dashboardUrl: "https://www.kimi.com/code/console",
  },
  kilo: {
    name: "Kilo",
    icon: providerIcon("kilo", Icon.BarChart),
    brandColor: "#F27027",
    usageSectionLabels: { primary: "Credits", secondary: "Kilo Pass" },
    dashboardUrl: "https://app.kilo.ai/usage",
  },
  kiro: {
    name: "Kiro",
    icon: providerIcon("kiro"),
    brandColor: "#FF9900",
    usageSectionLabels: { primary: "Credits", secondary: "Bonus" },
    dashboardUrl: "https://app.kiro.dev/account/usage",
    statusPageUrl: "https://health.aws.amazon.com/health/status",
  },
  vertexai: {
    name: "Vertex AI",
    icon: providerIcon("vertexai", Icon.Globe),
    brandColor: "#4285F4",
    usageSectionLabels: { primary: "Requests", secondary: "Tokens" },
    dashboardUrl: "https://console.cloud.google.com/vertex-ai",
    statusPageUrl: "https://status.cloud.google.com",
  },
  augment: {
    name: "Augment",
    icon: providerIcon("augment", Icon.Bolt),
    brandColor: "#6366F1",
    usageSectionLabels: { primary: "Credits", secondary: "Usage" },
    dashboardUrl: "https://app.augmentcode.com/account/subscription",
    statusPageUrl: "https://status.augmentcode.com",
  },
  jetbrains: {
    name: "JetBrains AI",
    icon: providerIcon("jetbrains", Icon.AppWindow),
    brandColor: "#FF3399",
    usageSectionLabels: { primary: "Current", secondary: "Refill" },
  },
  kimik2: {
    name: "Kimi K2 (unofficial)",
    icon: Icon.Circle,
    brandColor: "#4C00FF",
    usageSectionLabels: { primary: "Credits", secondary: "Credits" },
  },
  amp: {
    name: "Amp",
    icon: providerIcon("amp", Icon.Bolt),
    brandColor: "#DC2626",
    usageSectionLabels: { primary: "Amp Free", secondary: "Balance" },
    dashboardUrl: "https://ampcode.com/settings/usage",
  },
  ollama: {
    name: "Ollama",
    icon: providerIcon("ollama", Icon.Box),
    brandColor: "#888888",
    usageSectionLabels: { primary: "Session", secondary: "Weekly" },
    dashboardUrl: "https://ollama.com/settings",
  },
  synthetic: {
    name: "Synthetic",
    icon: providerIcon("synthetic"),
    brandColor: "#141414",
    usageSectionLabels: { primary: "Five-hour quota", secondary: "Weekly tokens", tertiary: "Search hourly" },
  },
  warp: {
    name: "Warp",
    icon: providerIcon("warp", Icon.ArrowRightCircle),
    brandColor: "#938BB4",
    usageSectionLabels: { primary: "Credits", secondary: "Add-on credits" },
    dashboardUrl: "https://docs.warp.dev/reference/cli/api-keys",
  },
  openrouter: {
    name: "OpenRouter",
    icon: providerIcon("openrouter", Icon.TwoPeople),
    brandColor: "#6467F2",
    usageSectionLabels: { primary: "Credits", secondary: "Usage" },
    dashboardUrl: "https://openrouter.ai/settings/credits",
    statusPageUrl: "https://status.openrouter.ai",
  },
  perplexity: {
    name: "Perplexity",
    icon: providerIcon("perplexity", Icon.Globe),
    brandColor: "#20B2AA",
    usageSectionLabels: { primary: "Credits", secondary: "Bonus credits", tertiary: "Purchased" },
    dashboardUrl: "https://www.perplexity.ai/account/usage",
    statusPageUrl: "https://status.perplexity.com/",
  },
  openai: {
    name: "OpenAI",
    icon: providerIcon("codex", Icon.Terminal),
    brandColor: "#0F826E",
    usageSectionLabels: { primary: "Spend", secondary: "Requests" },
    dashboardUrl: "https://platform.openai.com/usage",
    statusPageUrl: "https://status.openai.com",
  },
  azureopenai: {
    name: "Azure OpenAI",
    icon: providerIcon("codex", Icon.Terminal),
    brandColor: "#0078D4",
    usageSectionLabels: { primary: "Status", secondary: "Deployment" },
    dashboardUrl: "https://ai.azure.com",
    statusPageUrl: "https://azure.status.microsoft/en-us/status",
  },
  alibabatokenplan: {
    name: "Alibaba Token Plan",
    icon: providerIcon("alibaba"),
    brandColor: "#FF6A00",
    usageSectionLabels: { primary: "Credits", secondary: "Usage" },
    dashboardUrl: "https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/token-plan",
    statusPageUrl: "https://status.aliyun.com",
  },
  manus: {
    name: "Manus",
    icon: providerIcon("manus"),
    brandColor: "#34322D",
    usageSectionLabels: { primary: "Monthly credits", secondary: "Daily refresh" },
    dashboardUrl: "https://manus.im",
  },
  moonshot: {
    name: "Moonshot / Kimi API",
    icon: providerIcon("kimi"),
    brandColor: "#205DEB",
    usageSectionLabels: { primary: "Balance", secondary: "Balance" },
    dashboardUrl: "https://platform.moonshot.ai/console/account",
  },
  t3chat: {
    name: "T3 Chat",
    icon: providerIcon("t3chat", Icon.Bubble),
    brandColor: "#F56647",
    usageSectionLabels: { primary: "Base", secondary: "Overage" },
    dashboardUrl: "https://t3.chat/settings/customization",
    subscriptionDashboardUrl: "https://t3.chat/settings/subscription",
  },
  elevenlabs: {
    name: "ElevenLabs",
    icon: providerIcon("elevenlabs", Icon.SpeakerOn),
    brandColor: "#EBEBE6",
    usageSectionLabels: { primary: "Credits", secondary: "Voices" },
    dashboardUrl: "https://elevenlabs.io/app/developers/usage",
    subscriptionDashboardUrl: "https://elevenlabs.io/app/subscription",
    statusPageUrl: "https://status.elevenlabs.io",
  },
  windsurf: {
    name: "Windsurf",
    icon: providerIcon("windsurf", Icon.Code),
    brandColor: "#34E8BB",
    usageSectionLabels: { primary: "Daily", secondary: "Weekly" },
    dashboardUrl: "https://windsurf.com/subscription/usage",
  },
  mimo: {
    name: "Xiaomi MiMo",
    icon: providerIcon("mimo"),
    brandColor: "#FF6900",
    usageSectionLabels: { primary: "Credits", secondary: "Window" },
    dashboardUrl: "https://platform.xiaomimimo.com/#/console/balance",
  },
  doubao: {
    name: "Doubao",
    icon: providerIcon("doubao"),
    brandColor: "#3370FF",
    usageSectionLabels: { primary: "5-hour", secondary: "Weekly", tertiary: "Monthly" },
    dashboardUrl:
      "https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=subscribe",
  },
  abacus: {
    name: "Abacus AI",
    icon: providerIcon("abacus", Icon.BarChart),
    brandColor: "#38BDF8",
    usageSectionLabels: { primary: "Credits", secondary: "Weekly" },
    dashboardUrl: "https://apps.abacus.ai/chatllm/admin/compute-points-usage",
  },
  mistral: {
    name: "Mistral",
    icon: providerIcon("mistral", Icon.Bolt),
    brandColor: "#FF500F",
    usageSectionLabels: { primary: "Balance" },
    dashboardUrl: "https://admin.mistral.ai/organization/usage",
    statusPageUrl: "https://status.mistral.ai",
  },
  deepseek: {
    name: "DeepSeek",
    icon: providerIcon("deepseek"),
    brandColor: "#527DF0",
    usageSectionLabels: { primary: "Balance", secondary: "Balance" },
    dashboardUrl: "https://platform.deepseek.com/usage",
    statusPageUrl: "https://status.deepseek.com",
  },
  codebuff: {
    name: "Codebuff",
    icon: providerIcon("codebuff", Icon.Code),
    brandColor: "#44FF00",
    usageSectionLabels: { primary: "Credits", secondary: "Weekly" },
    dashboardUrl: "https://www.codebuff.com/usage",
  },
  crof: {
    name: "Crof",
    icon: providerIcon("crof"),
    brandColor: "#2EAB94",
    usageSectionLabels: { primary: "Requests", secondary: "Credits" },
    dashboardUrl: "https://crof.ai/dashboard",
  },
  venice: {
    name: "Venice",
    icon: providerIcon("venice", Icon.Globe),
    brandColor: "#3399FF",
    usageSectionLabels: { primary: "Balance", secondary: "Balance" },
    dashboardUrl: "https://venice.ai/settings/api",
  },
  commandcode: {
    name: "Command Code",
    icon: providerIcon("commandcode", Icon.Terminal),
    brandColor: "#000000",
    usageSectionLabels: { primary: "Monthly credits", secondary: "Monthly" },
    dashboardUrl: "https://commandcode.ai/studio",
    subscriptionDashboardUrl: "https://commandcode.ai/sixhobbits/settings/billing",
  },
  stepfun: {
    name: "StepFun",
    icon: providerIcon("stepfun"),
    brandColor: "#2196F2",
    usageSectionLabels: { primary: "5h Window", secondary: "Weekly Window" },
    dashboardUrl: "https://platform.stepfun.com/plan-usage",
  },
  bedrock: {
    name: "AWS Bedrock",
    icon: providerIcon("bedrock", Icon.Cloud),
    brandColor: "#FF9900",
    usageSectionLabels: { primary: "Budget", secondary: "Cost" },
    dashboardUrl: "https://console.aws.amazon.com/bedrock",
    statusPageUrl: "https://health.aws.amazon.com/health/status",
  },
  grok: {
    name: "Grok",
    icon: providerIcon("grok", Icon.Stars),
    brandColor: "#10A37F",
    usageSectionLabels: { primary: "Credits", secondary: "On-demand" },
    dashboardUrl: "https://grok.com/?_s=usage",
    statusPageUrl: "https://status.x.ai",
  },
  groq: {
    name: "Groq",
    icon: providerIcon("groq", Icon.Bolt),
    brandColor: "#F56844",
    usageSectionLabels: { primary: "Requests", secondary: "Tokens" },
    dashboardUrl: "https://console.groq.com/dashboard/metrics",
    statusPageUrl: "https://status.groq.com",
  },
  llmproxy: {
    name: "LLM Proxy",
    icon: providerIcon("llmproxy", Icon.Network),
    brandColor: "#24B47E",
    usageSectionLabels: { primary: "Quota", secondary: "Requests" },
  },
  deepgram: {
    name: "Deepgram",
    icon: providerIcon("deepgram", Icon.Microphone),
    brandColor: "#6467F2",
    usageSectionLabels: { primary: "Requests", secondary: "Usage" },
    dashboardUrl: "https://console.deepgram.com/project/",
    statusPageUrl: "https://status.deepgram.com",
  },
  devin: {
    name: "Devin",
    icon: providerIcon("devin", Icon.Code),
    brandColor: "#46B482",
    usageSectionLabels: { primary: "Daily", secondary: "Weekly" },
    dashboardUrl: "https://app.devin.ai",
    subscriptionDashboardUrl: "https://app.devin.ai/settings/usage",
  },
  zed: {
    name: "Zed",
    icon: providerIcon("zed", Icon.AppWindow),
    brandColor: "#084EFF",
    usageSectionLabels: { primary: "Edit predictions", secondary: "Billing cycle" },
  },
  sakana: {
    name: "Sakana AI",
    icon: providerIcon("sakana"),
    brandColor: "#2975DB",
    usageSectionLabels: { primary: "5-hour", secondary: "Weekly" },
    dashboardUrl: "https://console.sakana.ai/billing",
  },
  qoder: {
    name: "Qoder",
    icon: providerIcon("qoder", Icon.Code),
    brandColor: "#10B981",
    usageSectionLabels: { primary: "Credits", secondary: "Balance" },
    dashboardUrl: "https://qoder.com/account/usage",
  },
  litellm: {
    name: "LiteLLM",
    icon: providerIcon("litellm", Icon.Network),
    brandColor: "#4C89F0",
    usageSectionLabels: { primary: "Personal budget", secondary: "Team budget" },
  },
  poe: {
    name: "Poe",
    icon: providerIcon("poe", Icon.Bubble),
    brandColor: "#5D5CDE",
    usageSectionLabels: { primary: "Points", secondary: "Points" },
    dashboardUrl: "https://poe.com/api/keys",
  },
  chutes: {
    name: "Chutes",
    icon: providerIcon("chutes", Icon.Bolt),
    brandColor: "#3184FF",
    usageSectionLabels: { primary: "4-hour quota", secondary: "Monthly quota" },
    dashboardUrl: "https://chutes.ai",
  },
  crossmodel: {
    name: "CrossModel",
    icon: providerIcon("crossmodel", Icon.Wallet),
    brandColor: "#7C3AED",
    usageSectionLabels: { primary: "Credits", secondary: "Usage" },
    dashboardUrl: "https://crossmodel.ai/console/usage",
  },
  clawrouter: {
    name: "ClawRouter",
    icon: providerIcon("clawrouter", Icon.Network),
    brandColor: "#596EF6",
    usageSectionLabels: { primary: "Monthly budget", secondary: "Requests" },
    dashboardUrl: "https://clawrouter.openclaw.ai/dashboard/access",
  },
  wayfinder: {
    name: "Wayfinder",
    icon: providerIcon("wayfinder", Icon.Globe),
    brandColor: "#10A37F",
    usageSectionLabels: { primary: "Savings", secondary: "Requests" },
    // Default gateway dashboard (WayfinderSettingsReader.dashboardURL with empty env).
    dashboardUrl: "http://127.0.0.1:8088/router",
  },
} satisfies Record<string, ProviderDefinition>;

// Alternate spellings the CLI accepts (cliName + aliases from upstream
// ProviderCLIConfig), mapped to the canonical config.json/payload id.
const PROVIDER_ID_ALIASES: Record<string, string> = {
  "alibaba-coding-plan": "alibaba",
  bailian: "alibaba",
  "alibaba-token-plan": "alibabatokenplan",
  "alibaba-token": "alibabatokenplan",
  "bailian-token-plan": "alibabatokenplan",
  "azure-openai": "azureopenai",
  aoai: "azureopenai",
  "openai-api": "openai",
  abacusai: "abacus",
  "abacus-ai": "abacus",
  groqcloud: "groq",
  "groq-api": "groq",
  "aws-bedrock": "bedrock",
  manicode: "codebuff",
  "command-code": "commandcode",
  crofai: "crof",
  dg: "deepgram",
  "deep-seek": "deepseek",
  ds: "deepseek",
  volcengine: "doubao",
  ark: "doubao",
  bytedance: "doubao",
  "11labs": "elevenlabs",
  eleven: "elevenlabs",
  "llm-api-key-proxy": "llmproxy",
  "llm-proxy": "llmproxy",
  "xiaomi-mimo": "mimo",
  "mistral-ai": "mistral",
  "step-fun": "stepfun",
  sf: "stepfun",
  "t3-chat": "t3chat",
  t3: "t3chat",
  ven: "venice",
  "sakana-ai": "sakana",
  "litellm-proxy": "litellm",
  "chutes.ai": "chutes",
  cm: "crossmodel",
  "claw-router": "clawrouter",
  "wayfinder-router": "wayfinder",
};

export function resolveProviderId(id: string): string {
  return PROVIDER_ID_ALIASES[id] ?? id;
}

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
  // Other dual-URL providers (devin, t3chat, elevenlabs, commandcode) have no plan
  // detection, and the usage this extension meters is their subscription usage — so the
  // subscription dashboard is the better target when upstream provides one. Deliberate
  // divergence from upstream, which only plan-switches Claude.
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
