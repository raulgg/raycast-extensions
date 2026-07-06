export type SvgTextAnchor = "start" | "middle" | "end";

const DEFAULT_FONT_FAMILY = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

type SvgRectOptions = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
};

type SvgTextOptions = {
  x: number;
  y: number;
  fill: string;
  fontSize: number;
  fontWeight: number;
  textAnchor?: SvgTextAnchor;
  fontFamily?: string;
};

type SvgLineOptions = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth?: number;
};

type SvgDocumentOptions = {
  width: number;
  height: number;
  markup: string[];
  fill?: string;
  role?: string;
};

type SvgProgressMarkerOptions = {
  percent: number;
  width: number;
  height: number;
  radius: number;
  edgeInset: number;
  fill: string;
  fillOpacity?: number;
};

type SvgProgressBarOptions = {
  percent: number;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  trackFill: string;
  trackFillOpacity?: number;
  fill: string;
  marker?: SvgProgressMarkerOptions;
};

export function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function encodeSvgBase64(svg: string): string {
  return Buffer.from(svg, "utf8").toString("base64");
}

export function buildSvgDocument({ width, height, markup, fill = "none", role }: SvgDocumentOptions): string {
  const roleAttribute = role ? ` role="${role}"` : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="${fill}"${roleAttribute}>`,
    ...markup,
    `</svg>`,
  ].join("");
}

export function buildSvgText(value: string, options: SvgTextOptions): string {
  const textAnchor = options.textAnchor ?? "start";
  const fontFamily = options.fontFamily ?? DEFAULT_FONT_FAMILY;

  return `<text x="${options.x}" y="${options.y}" fill="${options.fill}" font-family="${fontFamily}" font-size="${options.fontSize}" font-weight="${options.fontWeight}" text-anchor="${textAnchor}">${escapeSvgText(value)}</text>`;
}

// Heroicons "exclamation-triangle" (solid, 24px viewBox, MIT). The exclamation
// mark subpaths are punched out via fill-rule so the icon works on any
// background without needing a second "hole" color.
const WARNING_ICON_PATH =
  "M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z";

const WARNING_ICON_VIEWBOX = 24;

export function buildSvgWarningIcon({ x, y, size, fill }: { x: number; y: number; size: number; fill: string }): string {
  const scale = size / WARNING_ICON_VIEWBOX;
  return `<path d="${WARNING_ICON_PATH}" fill="${fill}" fill-rule="evenodd" transform="translate(${x} ${y}) scale(${scale})"/>`;
}

export function buildSvgLine({ x1, y1, x2, y2, stroke, strokeWidth = 1 }: SvgLineOptions): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
}

export function buildSvgRect({
  x,
  y,
  width,
  height,
  radius,
  fill,
  fillOpacity,
  stroke,
  strokeOpacity,
  strokeWidth,
}: SvgRectOptions): string {
  const radiusAttribute = typeof radius === "number" ? ` rx="${radius}"` : "";
  const fillAttribute = fill ? ` fill="${fill}"` : "";
  const fillOpacityAttribute = typeof fillOpacity === "number" ? ` fill-opacity="${fillOpacity}"` : "";
  const strokeAttribute = stroke ? ` stroke="${stroke}"` : "";
  const strokeOpacityAttribute = typeof strokeOpacity === "number" ? ` stroke-opacity="${strokeOpacity}"` : "";
  const strokeWidthAttribute = typeof strokeWidth === "number" ? ` stroke-width="${strokeWidth}"` : "";

  return `<rect x="${x}" y="${y}" width="${width}" height="${height}"${radiusAttribute}${fillAttribute}${fillOpacityAttribute}${strokeAttribute}${strokeOpacityAttribute}${strokeWidthAttribute}/>`;
}

export function buildSvgProgressBar({
  percent,
  x,
  y,
  width,
  height,
  radius,
  trackFill,
  trackFillOpacity,
  fill,
  marker,
}: SvgProgressBarOptions): string {
  const normalized = renderedFillPercent(percent);
  const fillWidth = Math.round((normalized / 100) * width);

  return [
    buildSvgRect({
      x,
      y,
      width,
      height,
      radius,
      fill: trackFill,
      fillOpacity: trackFillOpacity,
    }),
    fillWidth > 0
      ? buildSvgRect({
          x,
          y,
          width: fillWidth,
          height,
          radius,
          fill,
        })
      : "",
    marker ? buildSvgProgressMarker(marker, x, y, width, height) : "",
  ].join("");
}

function buildSvgProgressMarker(
  marker: SvgProgressMarkerOptions,
  trackX: number,
  trackY: number,
  trackWidth: number,
  trackHeight: number,
): string {
  const normalizedPercent = clampPercent(marker.percent);
  const markerCenterX = trackX + (normalizedPercent / 100) * trackWidth;
  const minLeft = trackX + marker.edgeInset;
  const maxLeft = trackX + trackWidth - marker.width - marker.edgeInset;
  const markerX = Math.max(minLeft, Math.min(maxLeft, markerCenterX - marker.width / 2));
  const markerY = trackY - (marker.height - trackHeight) / 2;

  return buildSvgRect({
    x: markerX,
    y: markerY,
    width: marker.width,
    height: marker.height,
    radius: marker.radius,
    fill: marker.fill,
    fillOpacity: marker.fillOpacity,
  });
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Aligns the rendered bar fill with the rounded percent label so the bar never
 * shows a sliver when the label reads 0% or a gap when the label reads 100%.
 *
 * Mirrors upstream `UsageProgressBar.renderedFillPercent`
 * (steipete/CodexBar, Sources/CodexBar/UsageProgressBar.swift:125-132).
 */
export function renderedFillPercent(percent: number): number {
  const clamped = clampPercent(percent);
  const rounded = Math.round(clamped);

  if (rounded <= 0) {
    return 0;
  }

  if (rounded >= 100) {
    return 100;
  }

  return clamped;
}
