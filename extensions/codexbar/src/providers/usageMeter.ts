import { formatPercentRemaining } from "../lib/presentation";
import { buildSvgProgressBar, buildSvgRect } from "../lib/svg";
import { formatUsagePacingLabels, paceMarkerKind } from "./usagePacing";
import { getProviderProgressPalette } from "./registry";
import {
  buildText,
  DETAIL_FONT_WEIGHT,
  DETAIL_PALETTES,
  DETAIL_TEXT_LAYOUT,
  DETAIL_TYPOGRAPHY,
  getContentWidth,
  getLeftContentX,
  getRightContentX,
  getTextBottomY,
  type DetailAppearance,
} from "../lib/detailMarkdown";
import type { ProviderSection } from "./types";

export type ProviderDetailAppearance = DetailAppearance;

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
  punchGutter: 3,
} as const;

// SwiftUI Color.red / Color.green (UsageProgressBar.swift, CodexBar v0.55.0, 061593ca).
const PACE_MARKER_FILLS = {
  deficit: { light: "#FF383C", dark: "#FF4245" },
  reserve: { light: "#34C759", dark: "#30D158" },
} as const;

type ProgressMarker = {
  percent: number;
  fill: string;
};

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

const PANEL_PALETTES = DETAIL_PALETTES;

function getUsageProgressY(titleY: number): number {
  return titleY + USAGE_LAYOUT.titleToProgressOffset;
}

function getUsageFooterY(progressY: number): number {
  return progressY + PROGRESS_BAR.height + USAGE_LAYOUT.progressToFooterOffset;
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

function buildProgressBar(
  percent: number,
  x: number,
  y: number,
  width: number,
  appearance: ProviderDetailAppearance,
  providerId: string,
  marker?: ProgressMarker,
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
    marker: marker
      ? {
          percent: marker.percent,
          width: PROGRESS_MARKER.width,
          height: PROGRESS_MARKER.height,
          radius: PROGRESS_MARKER.radius,
          edgeInset: PROGRESS_MARKER.edgeInset,
          fill: marker.fill,
          punchGutter: PROGRESS_MARKER.punchGutter,
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
  marker?: ProgressMarker,
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
    buildProgressBar(percent, getLeftContentX(), progressY, getContentWidth(), appearance, providerId, marker),
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

export function renderMetricSection(
  section: ProviderSection,
  providerId: string,
  appearance: ProviderDetailAppearance,
  startY: number,
): { markup: string[]; contentBottomY: number } {
  if (section.kind !== "usage" && section.kind !== "supplementalUsage") {
    throw new Error(`Unsupported metric section kind: ${section.kind}`);
  }

  const title = section.kind === "usage" ? section.displayTitle : section.title;
  const usagePacing = section.usagePacing;
  const usagePacingFooter = usagePacing ? formatUsagePacingLabels(usagePacing) : undefined;
  const markerKind = usagePacing ? paceMarkerKind(usagePacing) : undefined;
  const marker =
    usagePacing && markerKind
      ? {
          percent: Math.max(0, 100 - usagePacing.idealUsedPercentByNow),
          fill: PACE_MARKER_FILLS[markerKind][appearance],
        }
      : undefined;

  return renderProgressSection(
    title,
    section.remainingPercent,
    [
      {
        left: `${formatPercentRemaining(section.remainingPercent)} left`,
        right: section.resetsIn ? `Resets in ${section.resetsIn}` : undefined,
      },
      ...(usagePacingFooter ? [{ left: usagePacingFooter.leftLabel, right: usagePacingFooter.rightLabel }] : []),
      ...(section.nextRegenPercent !== undefined
        ? [{ left: `Regenerates ${formatPercentRemaining(section.nextRegenPercent)} next tick` }]
        : []),
    ],
    providerId,
    appearance,
    startY,
    marker,
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

export function renderMetricSections(
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

export function renderLoadingSkeletonSections(
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
