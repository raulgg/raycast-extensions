export type DetailAppearance = "light" | "dark";

export const DETAIL_PANEL = {
  width: 440,
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 2,
  paddingLeft: 0,
  minimumHeight: 64,
} as const;

export const DETAIL_TYPOGRAPHY = {
  headerTitleSize: 22,
  headerSubtitleSize: 12,
  sectionTitleSize: 14,
  rowLabelSize: 12,
  rowValueSize: 12,
} as const;

export const DETAIL_TEXT_LAYOUT = {
  topInsetRatio: 0.8,
  bottomInsetRatio: 0.25,
} as const;

export const DETAIL_FONT_WEIGHT = {
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

export const DETAIL_HEADER_LAYOUT = {
  titleBaselineY: 24,
  titleToSubtitleOffset: 18,
} as const;

export const DETAIL_SECTION_LAYOUT = {
  dividerPaddingY: 16,
} as const;

export const DETAIL_SVG_LAYOUT = {
  transparentCanvasHeight: 1,
  dividerStrokeWidth: 1,
} as const;

const MARKDOWN_ESCAPE_CHARACTERS = new Set([
  "\\",
  "`",
  "*",
  "_",
  "{",
  "}",
  "[",
  "]",
  "(",
  ")",
  "#",
  "+",
  "!",
  "|",
  ">",
]);

export const DETAIL_PALETTES: Record<
  DetailAppearance,
  {
    titleFill: string;
    subtitleFill: string;
    sectionTitleFill: string;
    labelFill: string;
    valueFill: string;
    dividerStroke: string;
    progressTrackFill: string;
    progressFill: string;
  }
> = {
  light: {
    titleFill: "#111827",
    subtitleFill: "#6B7280",
    sectionTitleFill: "#111827",
    labelFill: "#6B7280",
    valueFill: "#111827",
    dividerStroke: "#E5E7EB",
    progressTrackFill: "#E5E7EB",
    progressFill: "#22B8CF",
  },
  dark: {
    titleFill: "#F3F4F6",
    subtitleFill: "#9CA3AF",
    sectionTitleFill: "#F3F4F6",
    labelFill: "#9CA3AF",
    valueFill: "#E5E7EB",
    dividerStroke: "#374151",
    progressTrackFill: "#253040",
    progressFill: "#4EC8DD",
  },
};

export function escapeMarkdown(value: string): string {
  const normalized = value.replace(/\r?\n/g, " ").trim();
  let escaped = "";

  for (const character of normalized) {
    escaped += MARKDOWN_ESCAPE_CHARACTERS.has(character) ? `\\${character}` : character;
  }

  return escaped;
}

export function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildSvgImageMarkdown(alt: string, svg: string, height: number): string {
  const encodedSvg = Buffer.from(svg, "utf8").toString("base64");
  return `![${escapeMarkdown(alt)}](data:image/svg+xml;base64,${encodedSvg}?raycast-width=${DETAIL_PANEL.width}&raycast-height=${height})`;
}

export function buildText(
  value: string,
  x: number,
  y: number,
  fill: string,
  fontSize: number,
  fontWeight: number,
  textAnchor: "start" | "end" = "start",
): string {
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" text-anchor="${textAnchor}">${escapeSvgText(value)}</text>`;
}

export function getLeftContentX(): number {
  return DETAIL_PANEL.paddingLeft;
}

export function getRightContentX(): number {
  return DETAIL_PANEL.width - DETAIL_PANEL.paddingRight;
}

export function getContentWidth(): number {
  return getRightContentX() - getLeftContentX();
}

export function getHeaderSubtitleY(titleY: number): number {
  return titleY + DETAIL_HEADER_LAYOUT.titleToSubtitleOffset;
}

export function getTextBottomY(baselineY: number, fontSize: number): number {
  return baselineY + Math.ceil(fontSize * DETAIL_TEXT_LAYOUT.bottomInsetRatio);
}

export function getTextBaselineY(topY: number, fontSize: number): number {
  return topY + Math.ceil(fontSize * DETAIL_TEXT_LAYOUT.topInsetRatio);
}

export function getSectionDividerY(contentBottomY: number): number {
  return contentBottomY + DETAIL_SECTION_LAYOUT.dividerPaddingY + DETAIL_SVG_LAYOUT.dividerStrokeWidth / 2;
}

export function getSectionTitleY(contentBottomY: number): number {
  const titleTopY = contentBottomY + DETAIL_SECTION_LAYOUT.dividerPaddingY * 2 + DETAIL_SVG_LAYOUT.dividerStrokeWidth;
  return getTextBaselineY(titleTopY, DETAIL_TYPOGRAPHY.sectionTitleSize);
}

export function getPanelHeight(contentBottomY: number): number {
  return Math.max(DETAIL_PANEL.minimumHeight, contentBottomY + DETAIL_PANEL.paddingBottom);
}

export function buildSectionDivider(y: number, stroke: string): string {
  return `<line x1="${getLeftContentX()}" y1="${y}" x2="${getRightContentX()}" y2="${y}" stroke="${stroke}" stroke-width="${DETAIL_SVG_LAYOUT.dividerStrokeWidth}"/>`;
}

export function buildSvgDocument(markup: string[], height: number): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DETAIL_PANEL.width}" height="${height}" viewBox="0 0 ${DETAIL_PANEL.width} ${height}" fill="none" role="img">`,
    ...markup,
    `</svg>`,
  ].join("");
}

export function buildHeaderMarkup(
  title: string,
  appearance: DetailAppearance,
  options?: {
    subtitle?: string;
    trailingTitle?: string;
    trailingSubtitle?: string;
  },
  documentTitle?: string,
): { markup: string[]; contentBottomY: number } {
  const palette = DETAIL_PALETTES[appearance];
  const titleY = DETAIL_PANEL.paddingTop + DETAIL_HEADER_LAYOUT.titleBaselineY;
  const markup: string[] = [
    `<rect x="0" y="0" width="${DETAIL_PANEL.width}" height="${DETAIL_SVG_LAYOUT.transparentCanvasHeight}" fill="transparent"/>`,
    `<title>${escapeSvgText(documentTitle ?? title)}</title>`,
    buildText(
      title,
      getLeftContentX(),
      titleY,
      palette.titleFill,
      DETAIL_TYPOGRAPHY.headerTitleSize,
      DETAIL_FONT_WEIGHT.bold,
    ),
  ];

  let contentBottomY = getTextBottomY(titleY, DETAIL_TYPOGRAPHY.headerTitleSize);
  const trailingTitle = options?.trailingTitle;
  if (trailingTitle) {
    markup.push(
      buildText(
        trailingTitle,
        getRightContentX(),
        titleY,
        palette.subtitleFill,
        DETAIL_TYPOGRAPHY.headerSubtitleSize,
        DETAIL_FONT_WEIGHT.medium,
        "end",
      ),
    );
    contentBottomY = Math.max(contentBottomY, getTextBottomY(titleY, DETAIL_TYPOGRAPHY.headerSubtitleSize));
  }

  const subtitle = options?.subtitle;
  const trailingSubtitle = options?.trailingSubtitle;
  if (subtitle || trailingSubtitle) {
    const subtitleY = getHeaderSubtitleY(titleY);
    if (subtitle) {
      markup.push(
        buildText(
          subtitle,
          getLeftContentX(),
          subtitleY,
          palette.subtitleFill,
          DETAIL_TYPOGRAPHY.headerSubtitleSize,
          DETAIL_FONT_WEIGHT.medium,
        ),
      );
      contentBottomY = Math.max(contentBottomY, getTextBottomY(subtitleY, DETAIL_TYPOGRAPHY.headerSubtitleSize));
    }
    if (trailingSubtitle) {
      markup.push(
        buildText(
          trailingSubtitle,
          getRightContentX(),
          subtitleY,
          palette.subtitleFill,
          DETAIL_TYPOGRAPHY.headerSubtitleSize,
          DETAIL_FONT_WEIGHT.medium,
          "end",
        ),
      );
      contentBottomY = Math.max(contentBottomY, getTextBottomY(subtitleY, DETAIL_TYPOGRAPHY.headerSubtitleSize));
    }
  }

  return { markup, contentBottomY };
}

export function wrapText(value: string, maxLineLength: number): string[] {
  const normalized = value.replace(/\r?\n/g, " ").trim();
  if (!normalized) {
    return ["Unknown error"];
  }

  const words = normalized.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (candidate.length <= maxLineLength) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}
