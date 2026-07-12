import type { Image } from "@raycast/api";
import { DETAIL_PALETTES } from "./detailMarkdown";
import { renderedFillPercent } from "./svg";
import { getProviderProgressPalette } from "../providers/registry";

const ICON_SIZE_PT = 18;
const ICON_VIEWBOX_PX = 36;
const CONTENT_Y_OFFSET_PX = 1;

const TOP_BAR = {
  x: 3,
  y: 5 + CONTENT_Y_OFFSET_PX,
  width: 30,
  height: 12,
} as const;

const BOTTOM_BAR = {
  x: 3,
  y: 23 + CONTENT_Y_OFFSET_PX,
  width: 30,
  height: 8,
} as const;

const TRACK_STROKE_OPACITY = {
  light: 0.18,
  dark: 0.24,
} as const;

const twoBarAccessoryIconCache = new Map<string, Image.Image>();

export function buildTwoBarAccessoryIcon(
  providerId: string,
  topRemainingPercent: number,
  bottomRemainingPercent?: number,
): Image.Image {
  const top = clampPercent(topRemainingPercent);
  const bottom = bottomRemainingPercent === undefined ? undefined : clampPercent(bottomRemainingPercent);
  const cacheKey = `${providerId}:${top}:${bottom ?? "missing"}`;
  const cached = twoBarAccessoryIconCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const progressPalette = getProviderProgressPalette(providerId);
  const icon: Image.Image = {
    source: {
      light: buildIconDataUri({
        fillColor: progressPalette.lightFill,
        trackColor: DETAIL_PALETTES.light.progressTrackFill,
        trackFillOpacity: DETAIL_PALETTES.light.progressTrackOpacity,
        trackStrokeOpacity: TRACK_STROKE_OPACITY.light,
        topRemainingPercent: top,
        bottomRemainingPercent: bottom,
      }),
      dark: buildIconDataUri({
        fillColor: progressPalette.darkFill,
        trackColor: DETAIL_PALETTES.dark.progressTrackFill,
        trackFillOpacity: DETAIL_PALETTES.dark.progressTrackOpacity,
        trackStrokeOpacity: TRACK_STROKE_OPACITY.dark,
        topRemainingPercent: top,
        bottomRemainingPercent: bottom,
      }),
    },
  };

  twoBarAccessoryIconCache.set(cacheKey, icon);
  return icon;
}

type BuildIconOptions = {
  fillColor: string;
  trackColor: string;
  trackFillOpacity: number;
  trackStrokeOpacity: number;
  topRemainingPercent: number;
  bottomRemainingPercent?: number;
};

function buildIconDataUri(options: BuildIconOptions): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE_PT}" height="${ICON_SIZE_PT}" viewBox="0 0 ${ICON_VIEWBOX_PX} ${ICON_VIEWBOX_PX}" fill="none">`,
    buildTrackFill(TOP_BAR, options.trackColor, options.trackFillOpacity),
    buildTrackFill(BOTTOM_BAR, options.trackColor, options.trackFillOpacity),
    buildFillRect(TOP_BAR, options.topRemainingPercent, options.fillColor),
    options.bottomRemainingPercent === undefined
      ? ""
      : buildFillRect(BOTTOM_BAR, options.bottomRemainingPercent, options.fillColor),
    buildTrackStroke(TOP_BAR, options.trackColor, options.trackStrokeOpacity),
    buildTrackStroke(BOTTOM_BAR, options.trackColor, options.trackStrokeOpacity),
    `</svg>`,
  ].join("");

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function buildTrackFill(
  rect: { x: number; y: number; width: number; height: number },
  trackColor: string,
  trackFillOpacity: number,
): string {
  const radius = rect.height / 2;

  return `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="${radius}" fill="${trackColor}" fill-opacity="${trackFillOpacity}"/>`;
}

function buildTrackStroke(
  rect: { x: number; y: number; width: number; height: number },
  trackColor: string,
  trackStrokeOpacity: number,
): string {
  const inset = 1;
  const radius = rect.height / 2;

  return `<rect x="${rect.x + inset}" y="${rect.y + inset}" width="${rect.width - inset * 2}" height="${rect.height - inset * 2}" rx="${Math.max(0, radius - inset)}" stroke="${trackColor}" stroke-opacity="${trackStrokeOpacity}" stroke-width="2"/>`;
}

function buildFillRect(
  rect: { x: number; y: number; width: number; height: number },
  remainingPercent: number,
  fillColor: string,
): string {
  const normalized = renderedFillPercent(remainingPercent);
  const fillWidth = Math.max(0, Math.min(rect.width, Math.round((rect.width * normalized) / 100)));
  if (fillWidth <= 0) {
    return "";
  }

  const radius = rect.height / 2;
  return `<rect x="${rect.x}" y="${rect.y}" width="${fillWidth}" height="${rect.height}" rx="${radius}" fill="${fillColor}"/>`;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}
