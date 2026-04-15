import {
  buildHeaderMarkup,
  buildSectionDivider,
  buildSvgDocument,
  buildSvgImageMarkdown,
  buildText,
  type DetailAppearance,
  DETAIL_FONT_WEIGHT,
  DETAIL_PALETTES,
  getPanelHeight,
  getSectionDividerY,
  getSectionTitleY,
  getTextBottomY,
  wrapText,
} from "./detailMarkdown";

export function formatLocalDateTime(
  isoTimestamp?: string,
  locale?: Intl.LocalesArgument,
  timeZone?: string,
): string | undefined {
  if (!isoTimestamp) {
    return undefined;
  }

  const target = Date.parse(isoTimestamp);
  if (Number.isNaN(target)) {
    return isoTimestamp;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(target));
}

export function buildProviderErrorMarkdown(
  title: string,
  error: Error,
  appearance: DetailAppearance = "light",
): string {
  const lines = wrapText(error.message || "Unknown error", 64);
  const messageFontSize = 14;
  const messageLineAdvance = 24;
  const palette = DETAIL_PALETTES[appearance];
  const header = buildHeaderMarkup(title, appearance);
  const markup = [
    ...header.markup,
    buildSectionDivider(getSectionDividerY(header.contentBottomY), palette.dividerStroke),
  ];
  let currentY = getSectionTitleY(header.contentBottomY);

  for (const line of lines) {
    markup.push(buildText(line, 0, currentY, "#FF6B6B", messageFontSize, DETAIL_FONT_WEIGHT.medium));
    currentY += messageLineAdvance;
  }

  const height = getPanelHeight(getTextBottomY(currentY - messageLineAdvance, messageFontSize));
  const svg = buildSvgDocument(markup, height);

  return buildSvgImageMarkdown(title, svg, height);
}
