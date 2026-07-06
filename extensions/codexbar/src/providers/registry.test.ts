import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Color, Icon } from "@raycast/api";
import { describe, expect, it } from "vitest";
import {
  getProviderMetadata,
  getProviderUsageSectionDisplayTitle,
  isKnownProviderId,
  PROVIDER_IDS,
  PROVIDER_SELECTOR_IDS,
  resolveProviderId,
} from "./registry";

describe("provider registry", () => {
  it("covers the documented provider IDs without including selector aliases", () => {
    expect(PROVIDER_IDS).toContain("codex");
    expect(PROVIDER_IDS).toContain("claude");
    expect(PROVIDER_IDS).toContain("opencodego");
    expect(PROVIDER_IDS).toContain("alibaba");
    expect(PROVIDER_IDS).toContain("openrouter");
    expect(PROVIDER_IDS).toContain("perplexity");
    expect(PROVIDER_IDS).not.toContain("all");
    expect(PROVIDER_IDS).not.toContain("both");
    expect(PROVIDER_SELECTOR_IDS).toEqual(["all", "both"]);
  });

  it("recognizes known providers", () => {
    expect(isKnownProviderId("codex")).toBe(true);
    expect(isKnownProviderId("unknown-provider")).toBe(false);
  });

  it("covers every provider id the upstream CLI exposes", () => {
    const upstreamEnumIds = [
      "openai",
      "azureopenai",
      "alibabatokenplan",
      "manus",
      "moonshot",
      "t3chat",
      "elevenlabs",
      "windsurf",
      "mimo",
      "doubao",
      "abacus",
      "mistral",
      "deepseek",
      "codebuff",
      "crof",
      "venice",
      "commandcode",
      "stepfun",
      "bedrock",
      "grok",
      "groq",
      "llmproxy",
      "deepgram",
      "devin",
      "zed",
      "sakana",
      "qoder",
      "litellm",
      "poe",
      "chutes",
      "crossmodel",
      "clawrouter",
    ];

    for (const providerId of upstreamEnumIds) {
      expect(PROVIDER_IDS, `missing registry entry for ${providerId}`).toContain(providerId);
    }
  });

  it("resolves upstream CLI aliases to canonical provider ids", () => {
    expect(resolveProviderId("alibaba-coding-plan")).toBe("alibaba");
    expect(resolveProviderId("alibaba-token-plan")).toBe("alibabatokenplan");
    expect(resolveProviderId("azure-openai")).toBe("azureopenai");
    expect(resolveProviderId("abacusai")).toBe("abacus");
    expect(resolveProviderId("groqcloud")).toBe("groq");
    expect(resolveProviderId("codex")).toBe("codex");
    expect(resolveProviderId("unknown-provider")).toBe("unknown-provider");

    expect(isKnownProviderId("alibaba-coding-plan")).toBe(true);
    expect(getProviderMetadata("alibaba-coding-plan").id).toBe("alibaba");
    expect(getProviderMetadata("groqcloud").name).toBe("Groq");

    expect(resolveProviderId("sakana-ai")).toBe("sakana");
    expect(resolveProviderId("litellm-proxy")).toBe("litellm");
    expect(resolveProviderId("chutes.ai")).toBe("chutes");
    expect(resolveProviderId("cm")).toBe("crossmodel");
    expect(resolveProviderId("claw-router")).toBe("clawrouter");
  });

  it("uses harvested upstream metadata for new providers", () => {
    expect(getProviderMetadata("openai")).toMatchObject({
      name: "OpenAI",
      brandColor: "#0F826E",
      usageSectionLabels: { primary: "Spend", secondary: "Requests" },
    });
    expect(getProviderMetadata("mistral")).toMatchObject({
      name: "Mistral",
      brandColor: "#FF500F",
      usageSectionLabels: { primary: "Monthly" },
    });
    expect(getProviderMetadata("alibabatokenplan")).toMatchObject({
      name: "Alibaba Token Plan",
      brandColor: "#FF6A00",
      usageSectionLabels: { primary: "Credits", secondary: "Usage" },
    });
    expect(getProviderMetadata("devin")).toMatchObject({
      name: "Devin",
      brandColor: "#46B482",
      usageSectionLabels: { primary: "Daily", secondary: "Weekly" },
    });
    expect(getProviderMetadata("zed")).toMatchObject({
      name: "Zed",
      brandColor: "#084EFF",
      usageSectionLabels: { primary: "Edit predictions", secondary: "Billing cycle" },
    });
    expect(getProviderMetadata("sakana")).toMatchObject({
      name: "Sakana AI",
      brandColor: "#2975DB",
      usageSectionLabels: { primary: "5-hour", secondary: "Weekly" },
    });
    expect(getProviderMetadata("qoder")).toMatchObject({
      name: "Qoder",
      brandColor: "#10B981",
      usageSectionLabels: { primary: "Credits", secondary: "Balance" },
    });
    expect(getProviderMetadata("litellm")).toMatchObject({
      name: "LiteLLM",
      brandColor: "#4C89F0",
      usageSectionLabels: { primary: "Personal budget", secondary: "Team budget" },
    });
    expect(getProviderMetadata("poe")).toMatchObject({
      name: "Poe",
      brandColor: "#5D5CDE",
      usageSectionLabels: { primary: "Points", secondary: "Points" },
    });
    expect(getProviderMetadata("chutes")).toMatchObject({
      name: "Chutes",
      brandColor: "#3184FF",
      usageSectionLabels: { primary: "4-hour quota", secondary: "Monthly quota" },
    });
    expect(getProviderMetadata("crossmodel")).toMatchObject({
      name: "CrossModel",
      brandColor: "#7C3AED",
      usageSectionLabels: { primary: "Credits", secondary: "Usage" },
    });
    expect(getProviderMetadata("clawrouter")).toMatchObject({
      name: "ClawRouter",
      brandColor: "#596EF6",
      usageSectionLabels: { primary: "Monthly budget", secondary: "Requests" },
    });
  });

  it("falls back to the semantic slot title when a label is missing", () => {
    expect(getProviderUsageSectionDisplayTitle("mistral", "Primary")).toBe("Monthly");
    expect(getProviderUsageSectionDisplayTitle("mistral", "Secondary")).toBe("Secondary");
  });

  it("returns friendly metadata for known providers", () => {
    expect(getProviderMetadata("openrouter")).toEqual({
      id: "openrouter",
      name: "OpenRouter",
      icon: {
        source: "provider-icons/openrouter.svg",
        fallback: Icon.TwoPeople,
        tintColor: Color.PrimaryText,
      },
      brandColor: "#6467F2",
      progressPalette: {
        lightFill: "#6467F2",
        darkFill: "#8385F5",
      },
      usageSectionLabels: { primary: "Credits", secondary: "Usage" },
    });
  });

  it("uses upstream svg assets when present", () => {
    expect(getProviderMetadata("alibaba")).toEqual({
      id: "alibaba",
      name: "Alibaba",
      icon: {
        source: "provider-icons/alibaba.svg",
        fallback: Icon.Circle,
        tintColor: Color.PrimaryText,
      },
      brandColor: "#FF6A00",
      progressPalette: {
        lightFill: "#FF6A00",
        darkFill: "#FF8833",
      },
      usageSectionLabels: { primary: "5-hour", secondary: "Weekly", tertiary: "Monthly" },
    });
  });

  it("includes OpenCode Go with its upstream provider id", () => {
    expect(getProviderMetadata("opencodego")).toEqual({
      id: "opencodego",
      name: "OpenCode Go",
      icon: {
        source: "provider-icons/opencodego.svg",
        fallback: Icon.Code,
        tintColor: Color.PrimaryText,
      },
      brandColor: "#3B82F6",
      progressPalette: {
        lightFill: "#3B82F6",
        darkFill: "#629BF8",
      },
      usageSectionLabels: { primary: "5-hour", secondary: "Weekly", tertiary: "Monthly" },
    });
  });

  it("has a local svg asset for every providerIcon reference", () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const registrySource = readFileSync(path.join(currentDir, "registry.ts"), "utf8");
    const providerIconSlugs = [...registrySource.matchAll(/providerIcon\("([^"]+)"/g)].map((match) => match[1]);

    expect(providerIconSlugs.length).toBeGreaterThan(0);

    for (const slug of providerIconSlugs) {
      expect(existsSync(path.join(currentDir, `../../assets/provider-icons/${slug}.svg`))).toBe(true);
    }
  });

  it("falls back to a title-cased label for unknown providers", () => {
    expect(getProviderMetadata("my-provider_name")).toEqual({
      id: "my-provider_name",
      name: "My Provider Name",
      icon: Icon.Circle,
      brandColor: "#22B8CF",
      progressPalette: {
        lightFill: "#22B8CF",
        darkFill: "#4EC8DD",
      },
      usageSectionLabels: { primary: "Primary", secondary: "Secondary", tertiary: "Tertiary" },
    });
  });

  it("returns upstream usage section labels for semantic slots", () => {
    expect(getProviderUsageSectionDisplayTitle("cursor", "Primary")).toBe("Total");
    expect(getProviderUsageSectionDisplayTitle("cursor", "Secondary")).toBe("Auto");
    expect(getProviderUsageSectionDisplayTitle("cursor", "Tertiary")).toBe("API");
    expect(getProviderUsageSectionDisplayTitle("amp", "Tertiary")).toBe("Tertiary");
    expect(getProviderUsageSectionDisplayTitle("codex", "Credits")).toBe("Credits");
  });
});
