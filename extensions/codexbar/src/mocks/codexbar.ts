import { environment } from "@raycast/api";
import { getProviderMetadata, PROVIDER_IDS } from "../providers/registry";
import type { ConfiguredProvider, RawProviderPayload } from "../providers/types";

// TODO: add CODEXBAR_MOCK_ERROR fixtures later.

// update const to true when want to use mock data in development
const DEV_MOCK = false;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type MockBuilder = (now: Date) => RawProviderPayload;

type MockWindow = {
  usedPercent: number;
  resetsAt: string | null;
  resetDescription: string | null;
  nextRegenPercent?: number;
};

type MockPayloadOptions = {
  source: string;
  version: string | null;
  status: Record<string, unknown> | null;
  usage: Record<string, unknown> | null;
  credits: Record<string, unknown> | null;
  antigravityPlanInfo: Record<string, unknown> | null;
  openaiDashboard: Record<string, unknown> | null;
};

const MOCK_SOURCES: Record<string, string> = {
  codex: "codex-cli",
  claude: "web",
  cursor: "web",
  opencode: "web",
  opencodego: "web",
  alibaba: "web",
  factory: "web",
  gemini: "api",
  antigravity: "local",
  copilot: "api",
  zai: "api",
  minimax: "web",
  kimi: "api",
  kilo: "api",
  kiro: "cli",
  vertexai: "oauth",
  augment: "web",
  jetbrains: "local",
  kimik2: "api",
  amp: "web",
  ollama: "web",
  synthetic: "api",
  warp: "api",
  openrouter: "api",
  perplexity: "api",
  openai: "api",
  azureopenai: "api",
  alibabatokenplan: "web",
  manus: "web",
  moonshot: "api",
  t3chat: "web",
  elevenlabs: "api",
  windsurf: "web",
  mimo: "web",
  doubao: "web",
  abacus: "web",
  mistral: "web",
  deepseek: "api",
  codebuff: "api",
  crof: "api",
  venice: "api",
  commandcode: "web",
  stepfun: "web",
  bedrock: "oauth",
  grok: "web",
  groq: "api",
  llmproxy: "api",
  deepgram: "api",
  devin: "web",
  zed: "local",
  sakana: "web",
  qoder: "web",
  litellm: "api",
  poe: "api",
  chutes: "api",
  crossmodel: "api",
  clawrouter: "api",
};

const MOCK_VERSIONS: Record<string, string | null> = {
  codex: "0.6.0",
  claude: "1.0.0",
  gemini: "0.12.0",
  kiro: "0.4.0",
};

function isCodexBarMockMode(): boolean {
  return environment.isDevelopment && DEV_MOCK;
}

function iso(value: Date): string {
  return value.toISOString();
}

function offsetIso(now: Date, offsetMs: number): string {
  return iso(new Date(now.getTime() + offsetMs));
}

function buildWindow(
  now: Date,
  usedPercent: number,
  resetOffsetMs: number | null,
  resetDescription: string | null = null,
  nextRegenPercent?: number,
): MockWindow {
  return {
    usedPercent,
    resetsAt: resetOffsetMs === null ? null : offsetIso(now, resetOffsetMs),
    resetDescription,
    ...(nextRegenPercent === undefined ? {} : { nextRegenPercent }),
  };
}

function buildStatus(
  description: string,
  url: string,
  now: Date,
  indicator: "none" | "minor" | "major" | "critical" | "maintenance" | "unknown" = "none",
): Record<string, unknown> {
  return {
    indicator,
    description,
    url,
    updatedAt: iso(now),
  };
}

function buildIdentity(
  providerID: string,
  email: string | null,
  organization: string | null,
  loginMethod: string | null,
): Record<string, unknown> {
  return {
    identity: {
      providerID,
      accountEmail: email,
      accountOrganization: organization,
      loginMethod,
    },
    accountEmail: email,
    accountOrganization: organization,
    loginMethod,
  };
}

function buildPayload(provider: string, options: MockPayloadOptions): RawProviderPayload {
  return {
    provider,
    account: null,
    version: options.version,
    source: options.source,
    status: options.status,
    usage: options.usage,
    credits: options.credits,
    antigravityPlanInfo: options.antigravityPlanInfo,
    openaiDashboard: options.openaiDashboard,
    error: null,
  };
}

function buildUsage(
  now: Date,
  primary: MockWindow | null,
  secondary: MockWindow | null = null,
  tertiary: MockWindow | null = null,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    primary,
    secondary,
    tertiary,
    updatedAt: iso(now),
    ...extras,
  };
}

function buildCredits(now: Date, remaining: number, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    remaining,
    events: [
      {
        id: "00000000-0000-0000-0000-000000000001",
        date: offsetIso(now, -DAY),
        service: "Codex",
        creditsUsed: 3.5,
      },
    ],
    updatedAt: iso(now),
    ...extras,
  };
}

function buildOpenAIDashboard(now: Date): Record<string, unknown> {
  return {
    signedInEmail: "dev@example.com",
    codeReviewRemainingPercent: 72,
    creditEvents: [
      {
        id: "00000000-0000-0000-0000-000000000002",
        date: offsetIso(now, -DAY),
        service: "CLI",
        creditsUsed: 3.5,
      },
      {
        id: "00000000-0000-0000-0000-000000000003",
        date: iso(now),
        service: "Code Review",
        creditsUsed: 1.25,
      },
    ],
    dailyBreakdown: [
      {
        day: iso(now).slice(0, 10),
        services: [{ service: "CLI", creditsUsed: 3.5 }],
        totalCreditsUsed: 3.5,
      },
    ],
    usageBreakdown: [
      {
        day: iso(now).slice(0, 10),
        services: [{ service: "Code Review", creditsUsed: 1.25 }],
        totalCreditsUsed: 1.25,
      },
    ],
    creditsPurchaseURL: "https://platform.openai.com/account/billing",
    primaryLimit: buildWindow(now, 28, 90 * MINUTE, "Session"),
    secondaryLimit: buildWindow(now, 59, 7 * DAY, "Weekly"),
    creditsRemaining: 16.5,
    accountPlan: "pro",
    updatedAt: iso(now),
  };
}

function buildClaudeProviderCost(now: Date): Record<string, unknown> {
  return {
    used: 1.42,
    limit: 20,
    currencyCode: "USD",
    period: "monthly",
    resetsAt: offsetIso(now, 30 * DAY),
    updatedAt: iso(now),
  };
}

function buildCursorProviderCost(now: Date): Record<string, unknown> {
  return {
    used: 3.08,
    limit: 25,
    currencyCode: "USD",
    period: "monthly",
    resetsAt: offsetIso(now, 30 * DAY),
    updatedAt: iso(now),
  };
}

function buildOpenRouterUsage(now: Date): Record<string, unknown> {
  return {
    totalCredits: 50,
    totalUsage: 24.5,
    balance: 25.5,
    usedPercent: 49,
    keyDataFetched: true,
    keyLimit: 100,
    keyUsage: 47,
    rateLimit: {
      requests: 10,
      interval: "10s",
    },
    updatedAt: iso(now),
  };
}

function buildCodex(now: Date): RawProviderPayload {
  return buildPayload("codex", {
    source: MOCK_SOURCES.codex,
    version: MOCK_VERSIONS.codex,
    status: buildStatus("Partial System Degradation", "https://status.openai.com", now, "minor"),
    usage: buildUsage(
      now,
      buildWindow(now, 61, 90 * MINUTE, "Session"),
      buildWindow(now, 19, 7 * DAY, "Weekly"),
      null,
      {
        extraRateWindows: [
          {
            id: "codex-spark",
            title: "Codex Spark",
            window: buildWindow(now, 12, 5 * HOUR, null),
          },
        ],
        ...buildIdentity("codex", "dev@example.com", null, "pro"),
      },
    ),
    credits: buildCredits(now, 12.5),
    antigravityPlanInfo: null,
    openaiDashboard: buildOpenAIDashboard(now),
  });
}

function buildClaude(now: Date): RawProviderPayload {
  return buildPayload("claude", {
    source: MOCK_SOURCES.claude,
    version: MOCK_VERSIONS.claude,
    status: buildStatus("Claude operational", "https://status.anthropic.com", now),
    usage: buildUsage(
      now,
      buildWindow(now, 47, 3 * HOUR, "Session"),
      buildWindow(now, 71, 7 * DAY, "Weekly", 4),
      buildWindow(now, 91, 30 * DAY, "Monthly"),
      {
        providerCost: buildClaudeProviderCost(now),
        subscriptionRenewsAt: offsetIso(now, 21 * DAY),
        ...buildIdentity("claude", "dev@example.com", "Example Labs", "oauth"),
      },
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildCursor(now: Date): RawProviderPayload {
  return buildPayload("cursor", {
    source: MOCK_SOURCES.cursor,
    version: null,
    status: buildStatus("Cursor operational", "https://status.cursor.com", now),
    usage: buildUsage(
      now,
      buildWindow(now, 34, 3 * HOUR, "Resets in 3h"),
      buildWindow(now, 68, 24 * HOUR, "Resets tomorrow"),
      buildWindow(now, 79, 7 * DAY, "Resets next week"),
      {
        providerCost: buildCursorProviderCost(now),
        ...buildIdentity("cursor", "dev@example.com", null, "Pro"),
      },
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildOpenCode(now: Date): RawProviderPayload {
  return buildPayload("opencode", {
    source: MOCK_SOURCES.opencode,
    version: null,
    status: null,
    usage: buildUsage(now, buildWindow(now, 29, 2 * HOUR, null), buildWindow(now, 56, 24 * HOUR, null)),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildOpenCodeGo(now: Date): RawProviderPayload {
  return buildPayload("opencodego", {
    source: MOCK_SOURCES.opencodego,
    version: null,
    status: null,
    usage: buildUsage(
      now,
      buildWindow(now, 24, 90 * MINUTE, null),
      buildWindow(now, 44, 5 * DAY, null),
      buildWindow(now, 83, 30 * DAY, null),
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildAlibaba(now: Date): RawProviderPayload {
  return buildPayload("alibaba", {
    source: MOCK_SOURCES.alibaba,
    version: null,
    status: null,
    usage: buildUsage(
      now,
      buildWindow(now, 39, 5 * HOUR, "39 / 100 used"),
      buildWindow(now, 63, 24 * HOUR, "63 / 100 used"),
      buildWindow(now, 88, 30 * DAY, "88 / 100 used"),
      buildIdentity("alibaba", null, null, "Pro"),
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildFactory(now: Date): RawProviderPayload {
  return buildPayload("factory", {
    source: MOCK_SOURCES.factory,
    version: null,
    status: buildStatus("Factory operational", "https://status.factory.ai", now),
    usage: buildUsage(
      now,
      buildWindow(now, 56, 2 * DAY, "Resets in 2d"),
      buildWindow(now, 81, 7 * DAY, "Resets in 7d"),
      null,
      buildIdentity("factory", "dev@example.com", "Example Labs", "Factory Pro"),
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildGemini(now: Date): RawProviderPayload {
  return buildPayload("gemini", {
    source: MOCK_SOURCES.gemini,
    version: MOCK_VERSIONS.gemini,
    status: null,
    usage: buildUsage(
      now,
      buildWindow(now, 51, 6 * HOUR, "Free tier"),
      buildWindow(now, 67, 24 * HOUR, "Pro quota"),
      buildWindow(now, 84, 30 * DAY, "Monthly cap"),
      {
        ...buildIdentity("gemini", "dev@example.com", null, "Google AI Pro"),
      },
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildAntigravity(now: Date): RawProviderPayload {
  return buildPayload("antigravity", {
    source: MOCK_SOURCES.antigravity,
    version: null,
    status: null,
    usage: buildUsage(
      now,
      buildWindow(now, 43, 12 * HOUR, "Model quota"),
      buildWindow(now, 76, 24 * HOUR, "Workspace quota"),
      buildWindow(now, 91, 30 * DAY, "Monthly quota"),
      {
        ...buildIdentity("antigravity", "dev@example.com", null, "enterprise"),
      },
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildCopilot(now: Date): RawProviderPayload {
  return buildPayload("copilot", {
    source: MOCK_SOURCES.copilot,
    version: null,
    status: buildStatus("GitHub Copilot operational", "https://www.githubstatus.com/", now),
    usage: buildUsage(
      now,
      buildWindow(now, 45, null, null),
      buildWindow(now, 67, null, null),
      null,
      buildIdentity("copilot", null, null, "Business"),
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildZai(now: Date): RawProviderPayload {
  return buildPayload("zai", {
    source: MOCK_SOURCES.zai,
    version: null,
    status: null,
    usage: buildUsage(
      now,
      buildWindow(now, 35, 4 * HOUR, "1 week window"),
      buildWindow(now, 58, 30 * DAY, "Monthly"),
      buildWindow(now, 74, 2 * HOUR, "5 hours window"),
      buildIdentity("zai", null, null, "Pro"),
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildMiniMax(now: Date): RawProviderPayload {
  return buildPayload("minimax", {
    source: MOCK_SOURCES.minimax,
    version: null,
    status: null,
    usage: buildUsage(
      now,
      buildWindow(now, 63, 5 * HOUR, "1000 prompts / 5 hours"),
      null,
      null,
      buildIdentity("minimax", null, null, "Pro"),
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildKimi(now: Date): RawProviderPayload {
  return buildPayload("kimi", {
    source: MOCK_SOURCES.kimi,
    version: null,
    status: null,
    usage: buildUsage(
      now,
      buildWindow(now, 49, 7 * DAY, "42/200 requests"),
      buildWindow(now, 61, 5 * HOUR, "Rate: 15/60 per 5 hours"),
      null,
      buildIdentity("kimi", null, null, null),
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildKilo(now: Date): RawProviderPayload {
  return buildPayload("kilo", {
    source: MOCK_SOURCES.kilo,
    version: null,
    status: null,
    usage: buildUsage(
      now,
      buildWindow(now, 52, null, "12/30 credits"),
      buildWindow(now, 86, 7 * DAY, "$4.00 / $20.00 (+ $2.00 bonus)"),
      null,
      buildIdentity("kilo", null, null, "Kilo Pass Pro - Auto top-up: visa"),
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildKiro(now: Date): RawProviderPayload {
  return buildPayload("kiro", {
    source: MOCK_SOURCES.kiro,
    version: MOCK_VERSIONS.kiro,
    status: null,
    usage: buildUsage(
      now,
      buildWindow(now, 38, 30 * DAY, null),
      buildWindow(now, 79, 14 * DAY, "expires in 14d"),
      null,
      buildIdentity("kiro", null, "Kiro Pro", "Kiro Pro"),
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildVertexAI(now: Date): RawProviderPayload {
  return buildPayload("vertexai", {
    source: MOCK_SOURCES.vertexai,
    version: null,
    status: null,
    usage: buildUsage(now, null, null, null, {
      ...buildIdentity("vertexai", "dev@example.com", "example-project", "gcloud"),
    }),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildAugment(now: Date): RawProviderPayload {
  return buildPayload("augment", {
    source: MOCK_SOURCES.augment,
    version: null,
    status: null,
    usage: buildUsage(
      now,
      buildWindow(now, 46, 3 * DAY, "Resets in 3d"),
      null,
      null,
      buildIdentity("augment", "dev@example.com", null, "Pro"),
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildJetBrains(now: Date): RawProviderPayload {
  return buildPayload("jetbrains", {
    source: MOCK_SOURCES.jetbrains,
    version: null,
    status: null,
    usage: buildUsage(
      now,
      buildWindow(now, 33, 7 * DAY, "Resets in 7d"),
      null,
      null,
      buildIdentity("jetbrains", null, "IntelliJ IDEA", "AI Pro"),
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildKimiK2(now: Date): RawProviderPayload {
  return buildPayload("kimik2", {
    source: MOCK_SOURCES.kimik2,
    version: null,
    status: null,
    usage: buildUsage(
      now,
      buildWindow(now, 40, null, "Credits: 120/500"),
      null,
      null,
      buildIdentity("kimik2", null, null, null),
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildAmp(now: Date): RawProviderPayload {
  return buildPayload("amp", {
    source: MOCK_SOURCES.amp,
    version: null,
    status: null,
    usage: buildUsage(
      now,
      buildWindow(now, 57, 4 * HOUR, null),
      null,
      null,
      buildIdentity("amp", null, null, "Amp Free"),
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildOllama(now: Date): RawProviderPayload {
  return buildPayload("ollama", {
    source: MOCK_SOURCES.ollama,
    version: null,
    status: null,
    usage: buildUsage(
      now,
      buildWindow(now, 26, 90 * MINUTE, null),
      buildWindow(now, 64, 7 * DAY, null),
      null,
      buildIdentity("ollama", "dev@example.com", null, "Pro"),
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildSynthetic(now: Date): RawProviderPayload {
  return buildPayload("synthetic", {
    source: MOCK_SOURCES.synthetic,
    version: null,
    status: null,
    usage: buildUsage(
      now,
      buildWindow(now, 22, 2 * DAY, null),
      buildWindow(now, 70, null, "60 minutes"),
      null,
      buildIdentity("synthetic", null, null, "Pro"),
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildWarp(now: Date): RawProviderPayload {
  return buildPayload("warp", {
    source: MOCK_SOURCES.warp,
    version: null,
    status: null,
    usage: buildUsage(
      now,
      buildWindow(now, 0, null, "Unlimited"),
      buildWindow(now, 84, null, "2 bonus credits"),
      null,
      buildIdentity("warp", null, null, null),
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildOpenRouter(now: Date): RawProviderPayload {
  return buildPayload("openrouter", {
    source: MOCK_SOURCES.openrouter,
    version: null,
    status: null,
    usage: buildUsage(now, buildWindow(now, 47, null, null), null, null, {
      openRouterUsage: buildOpenRouterUsage(now),
      ...buildIdentity("openrouter", null, null, "Balance: $25.50"),
    }),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function buildPerplexity(now: Date): RawProviderPayload {
  return buildPayload("perplexity", {
    source: MOCK_SOURCES.perplexity,
    version: null,
    status: null,
    usage: buildUsage(
      now,
      buildWindow(now, 54, 30 * DAY, "54/100 credits"),
      buildWindow(now, 29, null, "20 promo credits"),
      buildWindow(now, 71, null, "8 purchased credits"),
      buildIdentity("perplexity", null, null, "Pro"),
    ),
    credits: null,
    antigravityPlanInfo: null,
    openaiDashboard: null,
  });
}

function hashSeed(value: string): number {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }

  return Math.abs(hash);
}

function buildGenericProvider(providerId: string, windowCount: 1 | 2 = 2): MockBuilder {
  return (now) => {
    const seed = hashSeed(providerId);
    return buildPayload(providerId, {
      source: MOCK_SOURCES[providerId] ?? "api",
      version: MOCK_VERSIONS[providerId] ?? null,
      status: null,
      usage: buildUsage(
        now,
        buildWindow(now, 15 + (seed % 70), 5 * HOUR, null),
        windowCount > 1 ? buildWindow(now, 10 + (seed % 80), 7 * DAY, null) : null,
        null,
        buildIdentity(providerId, null, null, "Pro"),
      ),
      credits: null,
      antigravityPlanInfo: null,
      openaiDashboard: null,
    });
  };
}

const MOCK_BUILDERS: Record<string, MockBuilder> = {
  codex: buildCodex,
  claude: buildClaude,
  cursor: buildCursor,
  opencode: buildOpenCode,
  opencodego: buildOpenCodeGo,
  alibaba: buildAlibaba,
  factory: buildFactory,
  gemini: buildGemini,
  antigravity: buildAntigravity,
  copilot: buildCopilot,
  zai: buildZai,
  minimax: buildMiniMax,
  kimi: buildKimi,
  kilo: buildKilo,
  kiro: buildKiro,
  vertexai: buildVertexAI,
  augment: buildAugment,
  jetbrains: buildJetBrains,
  kimik2: buildKimiK2,
  amp: buildAmp,
  ollama: buildOllama,
  synthetic: buildSynthetic,
  warp: buildWarp,
  openrouter: buildOpenRouter,
  perplexity: buildPerplexity,
  openai: buildGenericProvider("openai"),
  azureopenai: buildGenericProvider("azureopenai"),
  alibabatokenplan: buildGenericProvider("alibabatokenplan"),
  manus: buildGenericProvider("manus"),
  moonshot: buildGenericProvider("moonshot"),
  t3chat: buildGenericProvider("t3chat"),
  elevenlabs: buildGenericProvider("elevenlabs"),
  windsurf: buildGenericProvider("windsurf"),
  mimo: buildGenericProvider("mimo"),
  doubao: buildGenericProvider("doubao"),
  abacus: buildGenericProvider("abacus"),
  mistral: buildGenericProvider("mistral", 1),
  deepseek: buildGenericProvider("deepseek"),
  codebuff: buildGenericProvider("codebuff"),
  crof: buildGenericProvider("crof"),
  venice: buildGenericProvider("venice"),
  commandcode: buildGenericProvider("commandcode"),
  stepfun: buildGenericProvider("stepfun"),
  bedrock: buildGenericProvider("bedrock"),
  grok: buildGenericProvider("grok"),
  groq: buildGenericProvider("groq"),
  llmproxy: buildGenericProvider("llmproxy"),
  deepgram: buildGenericProvider("deepgram"),
  devin: buildGenericProvider("devin"),
  zed: buildGenericProvider("zed"),
  sakana: buildGenericProvider("sakana"),
  qoder: buildGenericProvider("qoder"),
  litellm: buildGenericProvider("litellm"),
  poe: buildGenericProvider("poe"),
  chutes: buildGenericProvider("chutes"),
  crossmodel: buildGenericProvider("crossmodel"),
  clawrouter: buildGenericProvider("clawrouter"),
};

const missingMockProviderIds = PROVIDER_IDS.filter((id) => !MOCK_BUILDERS[id]);
if (missingMockProviderIds.length > 0) {
  throw new Error(`Missing mock provider builders: ${missingMockProviderIds.join(", ")}`);
}

export function getMockConfiguredProviders(): ConfiguredProvider[] {
  return PROVIDER_IDS.map((providerId) => getProviderMetadata(providerId));
}

export function getMockProviderPayload(providerId: string, now: Date = new Date()): RawProviderPayload {
  const builder = MOCK_BUILDERS[providerId];
  if (!builder) {
    throw new Error(`Unknown mock provider id: ${providerId}`);
  }

  return builder(now);
}

export function getMockProviderPayloads(now: Date = new Date()): RawProviderPayload[] {
  return PROVIDER_IDS.map((providerId) => getMockProviderPayload(providerId, now));
}

export { isCodexBarMockMode };
