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

export function formatPercentRemaining(value: number): string {
  const clamped = Math.max(0, Math.min(100, value));
  if (clamped > 0 && clamped < 1) return "<1%";
  return `${Math.round(clamped)}%`;
}

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

type RelativeUpdateTimeOptions = {
  now?: number;
  locale?: Intl.LocalesArgument;
  timeZone?: string;
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export function formatRelativeUpdateTime(
  isoTimestamp?: string,
  options: RelativeUpdateTimeOptions = {},
): string | undefined {
  if (!isoTimestamp) {
    return undefined;
  }

  const target = Date.parse(isoTimestamp);
  if (Number.isNaN(target)) {
    return formatLocalDateTime(isoTimestamp, options.locale, options.timeZone);
  }

  const ageMs = Math.max(0, (options.now ?? Date.now()) - target);

  if (ageMs < MINUTE_MS) {
    return "just now";
  }

  if (ageMs < HOUR_MS) {
    return `${Math.floor(ageMs / MINUTE_MS)}m ago`;
  }

  return `${Math.floor(ageMs / HOUR_MS)}h ago`;
}

export function getRelativeUpdateTimeRefreshDelay(isoTimestamp?: string, now = Date.now()): number | undefined {
  if (!isoTimestamp) {
    return undefined;
  }

  const target = Date.parse(isoTimestamp);
  if (Number.isNaN(target)) {
    return undefined;
  }

  const ageMs = Math.max(0, now - target);

  if (ageMs < MINUTE_MS) {
    return MINUTE_MS - ageMs;
  }

  if (ageMs < HOUR_MS) {
    return getNextBucketDelay(ageMs, MINUTE_MS);
  }

  return getNextBucketDelay(ageMs, HOUR_MS);
}

function getNextBucketDelay(ageMs: number, bucketMs: number): number {
  const remainder = ageMs % bucketMs;
  return remainder === 0 ? bucketMs : bucketMs - remainder;
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
