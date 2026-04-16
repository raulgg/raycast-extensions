import { formatLocalDateTime } from "../lib/presentation";
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
  getTextBottomY,
  type DetailAppearance,
} from "../lib/detailMarkdown";
import type { ProviderDetailData, ProviderInfoSection, ProviderSection } from "./types";

export type ProviderDetailAppearance = DetailAppearance;
type ProviderDetailMarkdownOptions = {
  subtitle?: string;
};

const TYPOGRAPHY = DETAIL_TYPOGRAPHY;
const FONT_WEIGHT = DETAIL_FONT_WEIGHT;
const PROGRESS_BAR = {
  height: 8,
  radius: 4,
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

function getHeaderSubtitle(updatedAt?: string): string | undefined {
  const formatted = formatLocalDateTime(updatedAt);
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
  const otherSections: ProviderSection[] = [];

  for (const section of sections) {
    if (section.kind === "usage" || section.kind === "supplementalUsage") {
      continue;
    }

    if (section.kind === "info" && section.title === "General") {
      const remainingItems = section.items.filter((item) => item.label !== "Last Updated");
      if (remainingItems.length > 0) {
        otherSections.push({ ...section, items: remainingItems });
      }
      continue;
    }

    otherSections.push(section);
  }

  return { metricSections, otherSections };
}

function buildProgressBarSvg(
  percent: number,
  x: number,
  y: number,
  width: number,
  appearance: ProviderDetailAppearance,
  providerId: string,
): string {
  const normalized = Math.max(0, Math.min(100, percent));
  const fillWidth = Math.round((normalized / 100) * width);
  const palette = PANEL_PALETTES[appearance];
  const progressPalette = getProviderProgressPalette(providerId);
  const progressFill = appearance === "dark" ? progressPalette.darkFill : progressPalette.lightFill;

  return [
    `<rect x="${x}" y="${y}" width="${width}" height="${PROGRESS_BAR.height}" rx="${PROGRESS_BAR.radius}" fill="${palette.progressTrackFill}"/>`,
    fillWidth > 0
      ? `<rect x="${x}" y="${y}" width="${fillWidth}" height="${PROGRESS_BAR.height}" rx="${PROGRESS_BAR.radius}" fill="${progressFill}"/>`
      : "",
  ].join("");
}

function buildSkeletonRect(x: number, y: number, width: number, height: number, fill: string, radius: number): string {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"/>`;
}

function renderProgressSection(
  title: string,
  percent: number,
  footerLeft: string,
  footerRight: string | undefined,
  providerId: string,
  appearance: ProviderDetailAppearance,
  startY: number,
): { markup: string[]; contentBottomY: number } {
  const palette = PANEL_PALETTES[appearance];
  const progressY = getUsageProgressY(startY);
  const footerY = getUsageFooterY(progressY);
  const markup = [
    buildText(
      title,
      getLeftContentX(),
      startY,
      palette.sectionTitleFill,
      TYPOGRAPHY.sectionTitleSize,
      FONT_WEIGHT.bold,
    ),
    buildProgressBarSvg(percent, getLeftContentX(), progressY, getContentWidth(), appearance, providerId),
    buildText(footerLeft, getLeftContentX(), footerY, palette.valueFill, TYPOGRAPHY.rowValueSize, FONT_WEIGHT.semibold),
    footerRight
      ? buildText(
          footerRight,
          getRightContentX(),
          footerY,
          palette.labelFill,
          TYPOGRAPHY.rowLabelSize,
          FONT_WEIGHT.medium,
          "end",
        )
      : "",
  ].filter(Boolean);

  return { markup, contentBottomY: getTextBottomY(footerY, TYPOGRAPHY.rowValueSize) };
}

function renderMetricSection(
  section: ProviderSection,
  providerId: string,
  appearance: ProviderDetailAppearance,
  startY: number,
): { markup: string[]; contentBottomY: number } {
  if (section.kind === "usage") {
    return renderProgressSection(
      section.displayTitle,
      section.remainingPercent,
      `${formatPercent(section.remainingPercent)} left`,
      section.resetsIn ? `Resets in ${section.resetsIn}` : undefined,
      providerId,
      appearance,
      startY,
    );
  }

  if (section.kind === "supplementalUsage") {
    return renderProgressSection(
      section.title,
      section.remainingPercent,
      `${formatPercent(section.remainingPercent)} left`,
      section.resetsIn ? `Resets in ${section.resetsIn}` : undefined,
      providerId,
      appearance,
      startY,
    );
  }

  throw new Error(`Unsupported metric section kind: ${section.kind}`);
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
    buildSkeletonRect(
      getLeftContentX(),
      getCenteredPlaceholderY(startY, TYPOGRAPHY.sectionTitleSize, LOADING_SKELETON_LAYOUT.titleHeight),
      LOADING_SKELETON_LAYOUT.titleWidth,
      LOADING_SKELETON_LAYOUT.titleHeight,
      palette.progressTrackFill,
      LOADING_SKELETON_LAYOUT.titleRadius,
    ),
    buildSkeletonRect(
      getLeftContentX(),
      progressY,
      getContentWidth(),
      PROGRESS_BAR.height,
      palette.progressTrackFill,
      PROGRESS_BAR.radius,
    ),
    buildSkeletonRect(
      getLeftContentX(),
      getCenteredPlaceholderY(footerY, TYPOGRAPHY.rowValueSize, LOADING_SKELETON_LAYOUT.footerHeight),
      LOADING_SKELETON_LAYOUT.footerLeftWidth,
      LOADING_SKELETON_LAYOUT.footerHeight,
      palette.progressTrackFill,
      LOADING_SKELETON_LAYOUT.footerRadius,
    ),
    buildSkeletonRect(
      footerRightX,
      getCenteredPlaceholderY(footerY, TYPOGRAPHY.rowLabelSize, LOADING_SKELETON_LAYOUT.footerHeight),
      LOADING_SKELETON_LAYOUT.footerRightWidth,
      LOADING_SKELETON_LAYOUT.footerHeight,
      palette.progressTrackFill,
      LOADING_SKELETON_LAYOUT.footerRadius,
    ),
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
  if (section.kind === "credits") {
    return renderProgressSection(
      section.title,
      section.remainingPercent,
      section.remaining,
      section.scaleLabel,
      providerId,
      appearance,
      startY,
    );
  }

  if (section.kind === "providerCost") {
    return renderProgressSection(
      section.title,
      section.usedPercent,
      section.spendLine,
      `${formatPercent(section.usedPercent)} used`,
      providerId,
      appearance,
      startY,
    );
  }

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
  const subtitle = options?.subtitle ?? getHeaderSubtitle(detail.updatedAt);
  const hasHeaderContent = Boolean(subtitle || detail.accountEmail || detail.planText);

  if (sections.length === 0 && !hasHeaderContent) {
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
