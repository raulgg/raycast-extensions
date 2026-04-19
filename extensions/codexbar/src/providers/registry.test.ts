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

  it("declares usage-projection-capable providers explicitly", () => {
    expect(getProviderMetadata("codex").usagePacingSlot).toBe("secondary");
    expect(getProviderMetadata("claude").usagePacingSlot).toBe("secondary");
    expect(getProviderMetadata("opencode").usagePacingSlot).toBe("secondary");
    expect(getProviderMetadata("opencodego").usagePacingSlot).toBeUndefined();
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
