import { formatRelativeUpdateTime } from "../lib/presentation";
import { buildSvgProgressBar, buildSvgRect, buildSvgWarningIcon } from "../lib/svg";
import { formatUsagePacingLabels } from "./usagePacing";
import { getProviderProgressPalette } from "./registry";
import {
  buildHeaderMarkup,
  buildSectionDivider,
  buildSvgDocument,
  buildSvgImageMarkdown,
  buildText,
  DETAIL_FONT_WEIGHT,
  DETAIL_PALETTES,
  DETAIL_TEXT_LAYOUT,
  DETAIL_TYPOGRAPHY,
  getContentWidth,
  getLeftContentX,
  getPanelHeight,
  getRightContentX,
  getSectionDividerY,
  getSectionTitleY,
  getTextBaselineY,
  getTextBottomY,
  wrapText,
  type DetailAppearance,
} from "../lib/detailMarkdown";
import { getProviderStatusLabel, isRenderableProviderStatusIndicator } from "./status";
import type {
  ProviderDetailData,
  ProviderInfoSection,
  ProviderSection,
  ProviderStatus,
  ProviderStatusIndicator,
} from "./types";

export type ProviderDetailAppearance = DetailAppearance;
type ProviderDetailMarkdownOptions = {
  subtitle?: string;
  now?: number;
  status?: ProviderStatus;
};

const TYPOGRAPHY = DETAIL_TYPOGRAPHY;
const FONT_WEIGHT = DETAIL_FONT_WEIGHT;
const PROGRESS_BAR = {
  height: 8,
  radius: 4,
} as const;

const PROGRESS_MARKER = {
  width: 3,
  height: 12,
  radius: 1.5,
  edgeInset: 1,
} as const;

const LOADING_SKELETON_LAYOUT = {
  sectionCount: 2,
  titleWidth: 88,
  titleHeight: 10,
  footerLeftWidth: 76,
  footerRightWidth: 92,
  footerHeight: 8,
  titleRadius: 4,
  footerRadius: 4,
} as const;

const USAGE_LAYOUT = {
  titleToProgressOffset: 12,
  progressToFooterOffset: 22,
  footerRowGap: 20,
  bottomSpacing: 22,
  sectionGap: 8,
} as const;

const GENERIC_SECTION_LAYOUT = {
  titleToRowsOffset: 22,
  emptyStateHeight: 16,
  rowGap: 20,
} as const;

const PANEL_PALETTES = DETAIL_PALETTES;

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function getHeaderSubtitle(updatedAt?: string, now?: number): string | undefined {
  const formatted = formatRelativeUpdateTime(updatedAt, { now });
  return formatted ? `Updated ${formatted}` : undefined;
}

function getUsageProgressY(titleY: number): number {
  return titleY + USAGE_LAYOUT.titleToProgressOffset;
}

function getUsageFooterY(progressY: number): number {
  return progressY + PROGRESS_BAR.height + USAGE_LAYOUT.progressToFooterOffset;
}

function getGenericSectionRowsStartY(titleY: number): number {
  return titleY + GENERIC_SECTION_LAYOUT.titleToRowsOffset;
}

function getGenericSectionEmptyNextY(emptyStateY: number): number {
  return emptyStateY + GENERIC_SECTION_LAYOUT.emptyStateHeight;
}

function getTextTopY(baselineY: number, fontSize: number): number {
  return baselineY - Math.ceil(fontSize * DETAIL_TEXT_LAYOUT.topInsetRatio);
}

function getTextPlaceholderHeight(baselineY: number, fontSize: number): number {
  return getTextBottomY(baselineY, fontSize) - getTextTopY(baselineY, fontSize);
}

function getCenteredPlaceholderY(baselineY: number, fontSize: number, placeholderHeight: number): number {
  const textTopY = getTextTopY(baselineY, fontSize);
  const textHeight = getTextPlaceholderHeight(baselineY, fontSize);

  return textTopY + Math.floor((textHeight - placeholderHeight) / 2);
}

function splitRenderableSections(sections: ProviderSection[]): {
  metricSections: ProviderSection[];
  otherSections: ProviderSection[];
} {
  const metricSections = sections.filter((section) => section.kind === "usage" || section.kind === "supplementalUsage");
  const otherSections = sections.filter((section) => section.kind !== "usage" && section.kind !== "supplementalUsage");

  return { metricSections, otherSections };
}

const STATUS_BANNER_LAYOUT = {
  topSpacing: 16,
  paddingX: 12,
  paddingY: 12,
  radius: 8,
  iconSize: 14,
  iconToLabelGap: 7,
  // Distance from the label baseline up to the icon's top edge. Empirically
  // tuned against Raycast's rendered detail panel (not qlmanage/browser
  // previews — Raycast draws SVG text ~2px higher relative to path
  // coordinates) so the glyph's visual center matches the label's cap center.
  iconTopAboveLabelBaseline: 13.4,
  labelToDescriptionOffset: 19,
  descriptionLineGap: 17,
  // Description column width ≈ panel width minus banner + text padding; at the
  // 12px row font this holds roughly 62 characters per line.
  descriptionMaxLineLength: 62,
} as const;

type StatusBannerTone = "danger" | "warning" | "neutral";

const STATUS_BANNER_PALETTES: Record<
  DetailAppearance,
  Record<StatusBannerTone, { fill: string; fillOpacity: number; iconFill: string; labelFill: string }>
> = {
  light: {
    danger: { fill: "#EF4444", fillOpacity: 0.1, iconFill: "#EF4444", labelFill: "#B91C1C" },
    warning: { fill: "#F59E0B", fillOpacity: 0.12, iconFill: "#F59E0B", labelFill: "#B45309" },
    neutral: { fill: "#6B7280", fillOpacity: 0.1, iconFill: "#6B7280", labelFill: "#4B5563" },
  },
  dark: {
    danger: { fill: "#EF4444", fillOpacity: 0.16, iconFill: "#F87171", labelFill: "#FCA5A5" },
    warning: { fill: "#F59E0B", fillOpacity: 0.16, iconFill: "#FBBF24", labelFill: "#FCD34D" },
    neutral: { fill: "#9CA3AF", fillOpacity: 0.14, iconFill: "#9CA3AF", labelFill: "#D1D5DB" },
  },
};

function getStatusBannerTone(indicator: ProviderStatusIndicator): StatusBannerTone {
  switch (indicator) {
    case "major":
    case "critical":
      return "danger";
    case "minor":
      return "warning";
    default:
      return "neutral";
  }
}

// Renders the incident status as a tinted banner directly under the header: a
// rounded severity-colored panel with a status dot, the indicator label, and
// the wrapped incident description. Operational/unknown never reach here. The
// status page URL is offered as a detail action, not drawn here.
function renderStatusBanner(
  status: ProviderStatus,
  appearance: ProviderDetailAppearance,
  startY: number,
): { markup: string[]; contentBottomY: number } {
  const tonePalette = STATUS_BANNER_PALETTES[appearance][getStatusBannerTone(status.indicator)];
  const palette = PANEL_PALETTES[appearance];
  const textX = getLeftContentX() + STATUS_BANNER_LAYOUT.paddingX;
  const labelBaselineY = getTextBaselineY(startY + STATUS_BANNER_LAYOUT.paddingY, TYPOGRAPHY.sectionTitleSize);
  const markup: string[] = [];

  const iconTopY = labelBaselineY - STATUS_BANNER_LAYOUT.iconTopAboveLabelBaseline;
  markup.push(
    buildSvgWarningIcon({
      x: textX,
      y: iconTopY,
      size: STATUS_BANNER_LAYOUT.iconSize,
      fill: tonePalette.iconFill,
    }),
    buildText(
      getProviderStatusLabel(status.indicator),
      textX + STATUS_BANNER_LAYOUT.iconSize + STATUS_BANNER_LAYOUT.iconToLabelGap,
      labelBaselineY,
      tonePalette.labelFill,
      TYPOGRAPHY.sectionTitleSize,
      FONT_WEIGHT.bold,
    ),
  );

  let lastBaselineY = labelBaselineY;
  let lastFontSize: number = TYPOGRAPHY.sectionTitleSize;

  if (status.description) {
    const lines = wrapText(status.description, STATUS_BANNER_LAYOUT.descriptionMaxLineLength);
    let lineY = labelBaselineY + STATUS_BANNER_LAYOUT.labelToDescriptionOffset;

    for (const line of lines) {
      markup.push(buildText(line, textX, lineY, palette.valueFill, TYPOGRAPHY.rowLabelSize, FONT_WEIGHT.medium));
      lastBaselineY = lineY;
      lastFontSize = TYPOGRAPHY.rowLabelSize;
      lineY += STATUS_BANNER_LAYOUT.descriptionLineGap;
    }
  }

  const bannerBottomY = getTextBottomY(lastBaselineY, lastFontSize) + STATUS_BANNER_LAYOUT.paddingY;
  // The banner background is prepended so the dot and text render on top.
  markup.unshift(
    buildSvgRect({
      x: getLeftContentX(),
      y: startY,
      width: getContentWidth(),
      height: bannerBottomY - startY,
      radius: STATUS_BANNER_LAYOUT.radius,
      fill: tonePalette.fill,
      fillOpacity: tonePalette.fillOpacity,
    }),
  );

  return { markup, contentBottomY: bannerBottomY };
}

function buildProgressBar(
  percent: number,
  x: number,
  y: number,
  width: number,
  appearance: ProviderDetailAppearance,
  providerId: string,
  targetRemainingPercent?: number,
): string {
  const palette = PANEL_PALETTES[appearance];
  const progressPalette = getProviderProgressPalette(providerId);
  const progressFill = appearance === "dark" ? progressPalette.darkFill : progressPalette.lightFill;

  return buildSvgProgressBar({
    percent,
    x,
    y,
    width,
    height: PROGRESS_BAR.height,
    radius: PROGRESS_BAR.radius,
    trackFill: palette.progressTrackFill,
    trackFillOpacity: palette.progressTrackOpacity,
    fill: progressFill,
    marker:
      typeof targetRemainingPercent === "number"
        ? {
            percent: targetRemainingPercent,
            width: PROGRESS_MARKER.width,
            height: PROGRESS_MARKER.height,
            radius: PROGRESS_MARKER.radius,
            edgeInset: PROGRESS_MARKER.edgeInset,
            fill: palette.progressMarkerFill,
            fillOpacity: palette.progressMarkerOpacity,
          }
        : undefined,
  });
}

function renderProgressSection(
  title: string,
  percent: number,
  footerRows: Array<{ left: string; right?: string }>,
  providerId: string,
  appearance: ProviderDetailAppearance,
  startY: number,
  targetRemainingPercent?: number,
): { markup: string[]; contentBottomY: number } {
  const palette = PANEL_PALETTES[appearance];
  const progressY = getUsageProgressY(startY);
  const initialFooterY = getUsageFooterY(progressY);
  const markup = [
    buildText(
      title,
      getLeftContentX(),
      startY,
      palette.sectionTitleFill,
      TYPOGRAPHY.sectionTitleSize,
      FONT_WEIGHT.bold,
    ),
    buildProgressBar(
      percent,
      getLeftContentX(),
      progressY,
      getContentWidth(),
      appearance,
      providerId,
      targetRemainingPercent,
    ),
  ];
  let footerY = initialFooterY;

  for (const [index, footerRow] of footerRows.entries()) {
    markup.push(
      buildText(
        footerRow.left,
        getLeftContentX(),
        footerY,
        palette.valueFill,
        TYPOGRAPHY.rowValueSize,
        FONT_WEIGHT.semibold,
      ),
    );

    if (footerRow.right) {
      markup.push(
        buildText(
          footerRow.right,
          getRightContentX(),
          footerY,
          palette.labelFill,
          TYPOGRAPHY.rowLabelSize,
          FONT_WEIGHT.medium,
          "end",
        ),
      );
    }

    if (index < footerRows.length - 1) {
      footerY += USAGE_LAYOUT.footerRowGap;
    }
  }

  return { markup, contentBottomY: getTextBottomY(footerY, TYPOGRAPHY.rowValueSize) };
}

function renderMetricSection(
  section: ProviderSection,
  providerId: string,
  appearance: ProviderDetailAppearance,
  startY: number,
): { markup: string[]; contentBottomY: number } {
  if (section.kind !== "usage" && section.kind !== "supplementalUsage") {
    throw new Error(`Unsupported metric section kind: ${section.kind}`);
  }

  const title = section.kind === "usage" ? section.displayTitle : section.title;
  const usagePacingFooter = section.usagePacing ? formatUsagePacingLabels(section.usagePacing) : undefined;
  const targetRemainingPercent = section.usagePacing
    ? Math.max(0, 100 - section.usagePacing.idealUsedPercentByNow)
    : undefined;

  return renderProgressSection(
    title,
    section.remainingPercent,
    [
      {
        left: `${formatPercent(section.remainingPercent)} left`,
        right: section.resetsIn ? `Resets in ${section.resetsIn}` : undefined,
      },
      ...(usagePacingFooter ? [{ left: usagePacingFooter.leftLabel, right: usagePacingFooter.rightLabel }] : []),
      ...(section.nextRegenPercent !== undefined
        ? [{ left: `Regenerates ${formatPercent(section.nextRegenPercent)} next tick` }]
        : []),
    ],
    providerId,
    appearance,
    startY,
    targetRemainingPercent,
  );
}

function renderLoadingSkeletonSection(
  appearance: ProviderDetailAppearance,
  startY: number,
): { markup: string[]; contentBottomY: number } {
  const palette = PANEL_PALETTES[appearance];
  const progressY = getUsageProgressY(startY);
  const footerY = getUsageFooterY(progressY);
  const footerRightX = getRightContentX() - LOADING_SKELETON_LAYOUT.footerRightWidth;
  const markup = [
    buildSvgRect({
      x: getLeftContentX(),
      y: getCenteredPlaceholderY(startY, TYPOGRAPHY.sectionTitleSize, LOADING_SKELETON_LAYOUT.titleHeight),
      width: LOADING_SKELETON_LAYOUT.titleWidth,
      height: LOADING_SKELETON_LAYOUT.titleHeight,
      radius: LOADING_SKELETON_LAYOUT.titleRadius,
      fill: palette.progressTrackFill,
      fillOpacity: palette.progressTrackOpacity,
    }),
    buildSvgRect({
      x: getLeftContentX(),
      y: progressY,
      width: getContentWidth(),
      height: PROGRESS_BAR.height,
      radius: PROGRESS_BAR.radius,
      fill: palette.progressTrackFill,
      fillOpacity: palette.progressTrackOpacity,
    }),
    buildSvgRect({
      x: getLeftContentX(),
      y: getCenteredPlaceholderY(footerY, TYPOGRAPHY.rowValueSize, LOADING_SKELETON_LAYOUT.footerHeight),
      width: LOADING_SKELETON_LAYOUT.footerLeftWidth,
      height: LOADING_SKELETON_LAYOUT.footerHeight,
      radius: LOADING_SKELETON_LAYOUT.footerRadius,
      fill: palette.progressTrackFill,
      fillOpacity: palette.progressTrackOpacity,
    }),
    buildSvgRect({
      x: footerRightX,
      y: getCenteredPlaceholderY(footerY, TYPOGRAPHY.rowLabelSize, LOADING_SKELETON_LAYOUT.footerHeight),
      width: LOADING_SKELETON_LAYOUT.footerRightWidth,
      height: LOADING_SKELETON_LAYOUT.footerHeight,
      radius: LOADING_SKELETON_LAYOUT.footerRadius,
      fill: palette.progressTrackFill,
      fillOpacity: palette.progressTrackOpacity,
    }),
  ];

  return { markup, contentBottomY: getTextBottomY(footerY, TYPOGRAPHY.rowValueSize) };
}

function renderMetricSections(
  sections: ProviderSection[],
  providerId: string,
  appearance: ProviderDetailAppearance,
  startY: number,
): { markup: string[]; contentBottomY: number } {
  const markup: string[] = [];
  let currentY = startY;
  let contentBottomY = startY;

  for (const [index, section] of sections.entries()) {
    const rendered = renderMetricSection(section, providerId, appearance, currentY);
    markup.push(...rendered.markup);
    contentBottomY = rendered.contentBottomY;
    currentY = rendered.contentBottomY + USAGE_LAYOUT.bottomSpacing;

    if (index < sections.length - 1) {
      currentY += USAGE_LAYOUT.sectionGap;
    }
  }

  return { markup, contentBottomY };
}

function renderLoadingSkeletonSections(
  appearance: ProviderDetailAppearance,
  startY: number,
): { markup: string[]; contentBottomY: number } {
  const markup: string[] = [];
  let currentY = startY;
  let contentBottomY = startY;

  for (let index = 0; index < LOADING_SKELETON_LAYOUT.sectionCount; index += 1) {
    const rendered = renderLoadingSkeletonSection(appearance, currentY);
    markup.push(...rendered.markup);
    contentBottomY = rendered.contentBottomY;
    currentY = rendered.contentBottomY + USAGE_LAYOUT.bottomSpacing;

    if (index < LOADING_SKELETON_LAYOUT.sectionCount - 1) {
      currentY += USAGE_LAYOUT.sectionGap;
    }
  }

  return { markup, contentBottomY };
}

function renderGenericSection(
  section: ProviderInfoSection,
  appearance: ProviderDetailAppearance,
  startY: number,
): { markup: string[]; contentBottomY: number } {
  const palette = PANEL_PALETTES[appearance];
  const markup: string[] = [
    buildText(
      section.title,
      getLeftContentX(),
      startY,
      palette.sectionTitleFill,
      TYPOGRAPHY.sectionTitleSize,
      FONT_WEIGHT.bold,
    ),
  ];
  let currentY = getGenericSectionRowsStartY(startY);

  if (section.items.length === 0) {
    markup.push(
      buildText(
        "No data available",
        getLeftContentX(),
        currentY,
        palette.labelFill,
        TYPOGRAPHY.rowLabelSize,
        FONT_WEIGHT.medium,
      ),
    );
    return {
      markup,
      contentBottomY: getTextBottomY(getGenericSectionEmptyNextY(currentY), TYPOGRAPHY.rowLabelSize),
    };
  }

  for (const [index, item] of section.items.entries()) {
    markup.push(
      buildText(
        item.label,
        getLeftContentX(),
        currentY,
        palette.labelFill,
        TYPOGRAPHY.rowLabelSize,
        FONT_WEIGHT.medium,
      ),
      buildText(
        item.value,
        getRightContentX(),
        currentY,
        palette.valueFill,
        TYPOGRAPHY.rowValueSize,
        FONT_WEIGHT.semibold,
        "end",
      ),
    );

    if (index < section.items.length - 1) {
      currentY += GENERIC_SECTION_LAYOUT.rowGap;
    }
  }

  return { markup, contentBottomY: getTextBottomY(currentY, TYPOGRAPHY.rowLabelSize) };
}

function renderStandaloneSection(
  section: ProviderSection,
  providerId: string,
  appearance: ProviderDetailAppearance,
  startY: number,
): { markup: string[]; contentBottomY: number } {
  if (section.kind === "info") {
    return renderGenericSection(section, appearance, startY);
  }

  return renderMetricSection(section, providerId, appearance, startY);
}

export function buildProviderDetailMarkdown(
  detail: Pick<ProviderDetailData, "id" | "name" | "sections" | "updatedAt" | "accountEmail" | "planText">,
  appearance: ProviderDetailAppearance = "light",
  options?: ProviderDetailMarkdownOptions,
): string {
  const sections = detail.sections.filter((section) => section.kind !== "info" || section.items.length > 0);
  const subtitle = options?.subtitle ?? getHeaderSubtitle(detail.updatedAt, options?.now);
  const hasHeaderContent = Boolean(subtitle || detail.accountEmail || detail.planText);
  const status =
    options?.status && isRenderableProviderStatusIndicator(options.status.indicator) ? options.status : undefined;

  if (sections.length === 0 && !hasHeaderContent && !status) {
    return "No data available";
  }

  const palette = PANEL_PALETTES[appearance];
  const { metricSections, otherSections } = splitRenderableSections(sections);
  const header = buildHeaderMarkup(
    detail.name,
    appearance,
    {
      subtitle,
      trailingTitle: detail.accountEmail,
      trailingSubtitle: detail.planText,
    },
    `${detail.name} detail`,
  );
  const markup = [...header.markup];
  let currentY = header.contentBottomY;

  // An incident banner sits directly under the header, above every section, so
  // an outage is the first thing read in the detail panel.
  if (status) {
    const rendered = renderStatusBanner(status, appearance, currentY + STATUS_BANNER_LAYOUT.topSpacing);
    markup.push(...rendered.markup);
    currentY = rendered.contentBottomY;
  }

  if (metricSections.length > 0) {
    markup.push(buildSectionDivider(getSectionDividerY(currentY), palette.dividerStroke));
    currentY = getSectionTitleY(currentY);

    const rendered = renderMetricSections(metricSections, detail.id, appearance, currentY);
    markup.push(...rendered.markup);
    currentY = rendered.contentBottomY;
  }

  for (const section of otherSections) {
    markup.push(buildSectionDivider(getSectionDividerY(currentY), palette.dividerStroke));
    currentY = getSectionTitleY(currentY);

    const rendered = renderStandaloneSection(section, detail.id, appearance, currentY);
    markup.push(...rendered.markup);
    currentY = rendered.contentBottomY;
  }

  const height = getPanelHeight(currentY);
  const svg = buildSvgDocument(markup, height);

  return buildSvgImageMarkdown(`${detail.name} detail`, svg, height);
}

export function buildProviderLoadingMarkdown(
  detail: Pick<ProviderDetailData, "name">,
  appearance: ProviderDetailAppearance = "light",
): string {
  const palette = PANEL_PALETTES[appearance];
  const header = buildHeaderMarkup(detail.name, appearance, { subtitle: "Updating..." }, `${detail.name} detail`);
  const markup = [
    ...header.markup,
    buildSectionDivider(getSectionDividerY(header.contentBottomY), palette.dividerStroke),
  ];
  const contentStartY = getSectionTitleY(header.contentBottomY);
  const rendered = renderLoadingSkeletonSections(appearance, contentStartY);
  markup.push(...rendered.markup);
  const height = getPanelHeight(rendered.contentBottomY);
  const svg = buildSvgDocument(markup, height);

  return buildSvgImageMarkdown(`${detail.name} detail`, svg, height);
}
