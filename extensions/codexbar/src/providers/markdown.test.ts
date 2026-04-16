import { describe, expect, it } from "vitest";
import { formatLocalDateTime } from "../lib/presentation";
import { extractSvgMarkup } from "../../test/svg-markdown";
import { buildProviderDetailMarkdown, buildProviderLoadingMarkdown } from "./markdown";

const TEXT_TOP_INSET_RATIO = 0.8;
const TEXT_BOTTOM_INSET_RATIO = 0.25;

function getTextY(svg: string, text: string): number {
  const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = svg.match(new RegExp(`<text[^>]* y="([^"]+)"[^>]*>${escapedText}</text>`));
  if (!match) {
    throw new Error(`Could not find text node for "${text}"`);
  }

  return Number(match[1]);
}

function getLineYAfterText(svg: string, text: string): number {
  const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = svg.match(new RegExp(`${escapedText}</text>(.*?)<line[^>]* y1="([^"]+)"`, "s"));
  if (!match) {
    throw new Error(`Could not find divider after "${text}"`);
  }

  return Number(match[2]);
}

function getRectYs(svg: string, width: number, height: number): number[] {
  return [...svg.matchAll(new RegExp(`<rect[^>]* y="([^"]+)"[^>]* width="${width}" height="${height}"`, "g"))].map(
    (match) => Number(match[1]),
  );
}

function getTextTopY(baselineY: number, fontSize: number): number {
  return baselineY - Math.ceil(fontSize * TEXT_TOP_INSET_RATIO);
}

function getTextBottomY(baselineY: number, fontSize: number): number {
  return baselineY + Math.ceil(fontSize * TEXT_BOTTOM_INSET_RATIO);
}

describe("provider markdown", () => {
  it("renders codex usage and generic sections with semantic content", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        updatedAt: "2026-03-23T09:00:00Z",
        accountEmail: "dev@example.com",
        planText: "Pro",
        sections: [
          {
            kind: "usage",
            title: "Primary",
            displayTitle: "Session",
            remainingPercent: 53,
            resetsIn: "1h 30m",
          },
          {
            kind: "usage",
            title: "Secondary",
            displayTitle: "Weekly",
            remainingPercent: 88,
            resetsIn: "7d",
          },
          {
            kind: "supplementalUsage",
            title: "Code review",
            remainingPercent: 78,
          },
          {
            kind: "credits",
            title: "Credits",
            remaining: "112.4",
            remainingPercent: 11,
            scaleLabel: "1K tokens",
          },
          {
            kind: "info",
            title: "General",
            items: [{ label: "Last Updated", value: "2026-03-23T09:00:00Z" }],
          },
        ],
      },
      "light",
    );

    const [svg] = extractSvgMarkup(markdown);
    const expectedUpdated = formatLocalDateTime("2026-03-23T09:00:00Z");

    expect(markdown).toContain("data:image/svg+xml;base64,");
    expect(markdown).not.toContain("prefers-color-scheme");
    expect(markdown).not.toContain("## Primary");
    expect(markdown).not.toContain("- **Remaining:**");
    expect(svg).toContain("<title>Codex detail</title>");
    expect(svg).toContain(">Codex<");
    expect(svg).toContain(">dev@example.com<");
    expect(svg).toContain(">Pro<");
    expect(svg).toContain(`>Updated ${expectedUpdated}<`);
    expect(svg).toContain(">Session<");
    expect(svg).toContain(">Weekly<");
    expect(svg).toContain(">53% left<");
    expect(svg).toContain(">Resets in 1h 30m<");
    expect(svg).toContain(">Code review<");
    expect(svg).toContain(">78% left<");
    expect(svg).toContain(">Credits<");
    expect(svg).toContain(">112.4<");
    expect(svg).toContain(">1K tokens<");
    expect(svg).not.toContain(">General<");
  });

  it("bakes explicit theme colors into svg cards", () => {
    const lightMarkdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        sections: [
          {
            kind: "usage",
            title: "Primary",
            displayTitle: "Session",
            remainingPercent: 53,
            resetsIn: "1h 30m",
          },
        ],
      },
      "light",
    );
    const darkMarkdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        sections: [
          {
            kind: "usage",
            title: "Primary",
            displayTitle: "Session",
            remainingPercent: 53,
            resetsIn: "1h 30m",
          },
        ],
      },
      "dark",
    );

    const [lightSvg] = extractSvgMarkup(lightMarkdown);
    const [darkSvg] = extractSvgMarkup(darkMarkdown);

    expect(lightMarkdown).not.toContain("prefers-color-scheme");
    expect(darkMarkdown).not.toContain("prefers-color-scheme");
    expect(lightSvg).toContain('fill="#111827"');
    expect(lightSvg).toContain('stroke="#E5E7EB"');
    expect(lightSvg).toContain('fill="#49A3B0"');
    expect(darkSvg).toContain('fill="#F3F4F6"');
    expect(darkSvg).toContain('stroke="#374151"');
    expect(darkSvg).toContain('fill="#6DB5C0"');
    expect(lightSvg).toContain(">Session<");
    expect(darkSvg).toContain(">Session<");
    expect(lightMarkdown).not.toBe(darkMarkdown);
  });

  it("uses explicit display titles for usage sections", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "claude",
        name: "Claude",
        sections: [
          {
            kind: "usage",
            title: "Primary",
            displayTitle: "Session",
            remainingPercent: 80,
            resetsIn: "30m",
          },
        ],
      },
      "dark",
    );

    const [svg] = extractSvgMarkup(markdown);

    expect(svg).toContain(">Claude<");
    expect(svg).toContain(">Session<");
    expect(svg).not.toContain(">Primary<");
  });

  it("renders supplemental usage sections", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "claude",
        name: "Claude",
        sections: [
          {
            kind: "supplementalUsage",
            title: "Sonnet",
            remainingPercent: 80,
            resetsIn: "30m",
          },
        ],
      },
      "dark",
    );

    const [svg] = extractSvgMarkup(markdown);

    expect(svg).toContain(">Sonnet<");
    expect(svg).toContain(">80% left<");
    expect(svg).toContain(">Resets in 30m<");
  });

  it("supports overriding header subtitle while keeping sections", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        updatedAt: "2026-03-23T09:00:00Z",
        accountEmail: "dev@example.com",
        planText: "Pro",
        sections: [
          {
            kind: "usage",
            title: "Primary",
            displayTitle: "Session",
            remainingPercent: 53,
            resetsIn: "1h 30m",
          },
        ],
      },
      "light",
      { subtitle: "Updating..." },
    );

    const [svg] = extractSvgMarkup(markdown);

    expect(svg).toContain(">Codex<");
    expect(svg).toContain(">dev@example.com<");
    expect(svg).toContain(">Pro<");
    expect(svg).toContain(">Updating...<");
    expect(svg).not.toContain(">Updated ");
    expect(svg).toContain(">Session<");
  });

  it("renders header-only cards when only account metadata exists", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "vertexai",
        name: "Vertex AI",
        accountEmail: "dev@example.com",
        planText: "Gcloud",
        sections: [],
      },
      "light",
    );

    const [svg] = extractSvgMarkup(markdown);

    expect(markdown).toContain("data:image/svg+xml;base64,");
    expect(svg).toContain(">Vertex AI<");
    expect(svg).toContain(">dev@example.com<");
    expect(svg).toContain(">Gcloud<");
    expect(svg).not.toContain("<line ");
  });

  it("renders header-only loading markdown", () => {
    const markdown = buildProviderLoadingMarkdown(
      {
        name: "Codex",
      },
      "dark",
    );

    const [svg] = extractSvgMarkup(markdown);

    expect(svg).toContain("<title>Codex detail</title>");
    expect(svg).toContain(">Codex<");
    expect(svg).toContain(">Updating...<");
    expect(svg).not.toContain(">Session<");
    expect(svg).toContain("<line ");
    expect(svg).not.toContain('fill="#6DB5C0"');
    expect(getRectYs(svg, 88, 10)).toHaveLength(2);
    expect(getRectYs(svg, 440, 8)).toHaveLength(2);
    expect(getRectYs(svg, 76, 8)).toHaveLength(2);
    expect(getRectYs(svg, 92, 8)).toHaveLength(2);

    const progressTrackYs = getRectYs(svg, 440, 8);
    expect(progressTrackYs[1]).toBeGreaterThan(progressTrackYs[0]);
    expect(progressTrackYs[1] - progressTrackYs[0]).toBe(75);
  });

  it("falls back to plain text for empty details", () => {
    expect(
      buildProviderDetailMarkdown({
        id: "warp",
        name: "Warp",
        sections: [],
      }),
    ).toBe("No data available");
  });

  it("places the next divider below the rendered footer text, not its baseline", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        sections: [
          {
            kind: "usage",
            title: "Primary",
            displayTitle: "Session",
            remainingPercent: 53,
            resetsIn: "1h 30m",
          },
          {
            kind: "usage",
            title: "Secondary",
            displayTitle: "Weekly",
            remainingPercent: 88,
            resetsIn: "7d",
          },
          {
            kind: "credits",
            title: "Credits",
            remaining: "112.4",
            remainingPercent: 11,
            scaleLabel: "1K tokens",
          },
        ],
      },
      "dark",
    );

    const [svg] = extractSvgMarkup(markdown);
    const weeklyFooterY = getTextY(svg, "Resets in 7d");
    const creditsTitleY = getTextY(svg, "Credits");
    const creditsDividerY = getLineYAfterText(svg, "Resets in 7d");

    const gapAboveDivider = creditsDividerY - getTextBottomY(weeklyFooterY, 12);
    const gapBelowDivider = getTextTopY(creditsTitleY, 14) - creditsDividerY;

    expect(gapAboveDivider).toBeCloseTo(16.5);
    expect(gapBelowDivider).toBeCloseTo(16.5);
  });
});
