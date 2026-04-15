import { Color, Icon } from "@raycast/api";
import { describe, expect, it } from "vitest";
import { getProviderMetadata, isKnownProviderId, PROVIDER_IDS, PROVIDER_SELECTOR_IDS } from "./registry";

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
        source: "providers/ProviderIcon-openrouter.svg",
        fallback: Icon.TwoPeople,
        tintColor: Color.PrimaryText,
      },
      brandColor: "#6467F2",
      progressPalette: {
        lightFill: "#6467F2",
        darkFill: "#8385F5",
      },
    });
  });

  it("uses upstream svg assets when present", () => {
    expect(getProviderMetadata("alibaba")).toEqual({
      id: "alibaba",
      name: "Alibaba",
      icon: {
        source: "providers/ProviderIcon-alibaba.svg",
        fallback: Icon.Circle,
        tintColor: Color.PrimaryText,
      },
      brandColor: "#FF6A00",
      progressPalette: {
        lightFill: "#FF6A00",
        darkFill: "#FF8833",
      },
    });
  });

  it("includes OpenCode Go with its upstream provider id", () => {
    expect(getProviderMetadata("opencodego")).toEqual({
      id: "opencodego",
      name: "OpenCode Go",
      icon: {
        source: "providers/ProviderIcon-opencodego.svg",
        fallback: Icon.Code,
        tintColor: Color.PrimaryText,
      },
      brandColor: "#3B82F6",
      progressPalette: {
        lightFill: "#3B82F6",
        darkFill: "#629BF8",
      },
    });
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
    });
  });
});
