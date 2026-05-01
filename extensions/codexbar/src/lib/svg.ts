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
  const normalized = clampPercent(percent);
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
