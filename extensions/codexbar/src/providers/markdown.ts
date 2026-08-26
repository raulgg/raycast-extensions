import { formatRelativeUpdateTime } from "../lib/presentation";
import { buildSvgWarningIcon } from "../lib/svg";
import {
  buildHeaderMarkup,
  buildSectionDivider,
  buildSvgDocument,
  buildSvgImageMarkdown,
  buildText,
  DETAIL_FONT_WEIGHT,
  DETAIL_PALETTES,
  DETAIL_TYPOGRAPHY,
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
import type { ProviderDetailData, ProviderInfoSection, ProviderSection, ProviderStatus } from "./types";
import { renderLoadingSkeletonSections, renderMetricSection, renderMetricSections } from "./usageMeter";

export type ProviderDetailAppearance = DetailAppearance;
type ProviderDetailMarkdownOptions = {
  subtitle?: string;
  now?: number;
  status?: ProviderStatus;
};

const TYPOGRAPHY = DETAIL_TYPOGRAPHY;
const FONT_WEIGHT = DETAIL_FONT_WEIGHT;

const GENERIC_SECTION_LAYOUT = {
  titleToRowsOffset: 22,
  emptyStateHeight: 16,
  rowGap: 20,
} as const;

const STATUS_FOOTER_LAYOUT = {
  textTopSpacing: 12,
  lineGap: 17,
  maxLineLength: 68,
  iconSize: 12,
  iconToTextGap: 6,
  iconTopAboveBaseline: 12,
} as const;

const PANEL_PALETTES = DETAIL_PALETTES;

const STATUS_FOOTER_ICON_FILL: Record<DetailAppearance, string> = {
  light: "#F59E0B",
  dark: "#FBBF24",
};

function getHeaderSubtitle(updatedAt?: string, now?: number): string | undefined {
  const formatted = formatRelativeUpdateTime(updatedAt, { now });
  return formatted ? `Updated ${formatted}` : undefined;
}

function getGenericSectionRowsStartY(titleY: number): number {
  return titleY + GENERIC_SECTION_LAYOUT.titleToRowsOffset;
}

function getGenericSectionEmptyNextY(emptyStateY: number): number {
  return emptyStateY + GENERIC_SECTION_LAYOUT.emptyStateHeight;
}

function splitRenderableSections(sections: ProviderSection[]): {
  metricSections: ProviderSection[];
  otherSections: ProviderSection[];
} {
  const metricSections = sections.filter((section) => section.kind === "usage" || section.kind === "supplementalUsage");
  const otherSections = sections.filter((section) => section.kind !== "usage" && section.kind !== "supplementalUsage");

  return { metricSections, otherSections };
}

function formatStatusUpdatedTime(updatedAt?: string): string | undefined {
  if (!updatedAt) {
    return undefined;
  }

  const timestamp = Date.parse(updatedAt);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(timestamp));
}

function formatStatusFooterText(status: ProviderStatus): string {
  const incidentText = status.description ?? getProviderStatusLabel(status.indicator);
  const updatedTime = formatStatusUpdatedTime(status.updatedAt);

  return updatedTime ? `${incidentText} - Updated ${updatedTime}` : incidentText;
}

function renderStatusFooter(
  status: ProviderStatus,
  appearance: ProviderDetailAppearance,
  startY: number,
): { markup: string[]; contentBottomY: number } {
  const palette = PANEL_PALETTES[appearance];
  const lines = wrapText(formatStatusFooterText(status), STATUS_FOOTER_LAYOUT.maxLineLength);
  const markup: string[] = [];
  let currentY = getTextBaselineY(startY + STATUS_FOOTER_LAYOUT.textTopSpacing, TYPOGRAPHY.rowLabelSize);
  const textX = getLeftContentX() + STATUS_FOOTER_LAYOUT.iconSize + STATUS_FOOTER_LAYOUT.iconToTextGap;
  const iconY = currentY - STATUS_FOOTER_LAYOUT.iconTopAboveBaseline;

  markup.push(
    buildSvgWarningIcon({
      x: getLeftContentX(),
      y: iconY,
      size: STATUS_FOOTER_LAYOUT.iconSize,
      fill: STATUS_FOOTER_ICON_FILL[appearance],
    }),
  );

  for (const line of lines) {
    markup.push(buildText(line, textX, currentY, palette.labelFill, TYPOGRAPHY.rowLabelSize, FONT_WEIGHT.medium));
    currentY += STATUS_FOOTER_LAYOUT.lineGap;
  }

  return {
    markup,
    contentBottomY: getTextBottomY(currentY - STATUS_FOOTER_LAYOUT.lineGap, TYPOGRAPHY.rowLabelSize),
  };
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

  if (status) {
    markup.push(buildSectionDivider(getSectionDividerY(currentY), palette.dividerStroke));
    const rendered = renderStatusFooter(status, appearance, getSectionDividerY(currentY));
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
