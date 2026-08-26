export type SvgTextNode = {
  content: string;
  x: number;
  y: number;
  fill?: string;
  fontSize?: number;
  fontWeight?: number;
  index: number;
};

export type SvgRectNode = {
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  index: number;
};

export type SvgLineNode = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  index: number;
};

export type ParsedSvg = {
  texts: SvgTextNode[];
  rects: SvgRectNode[];
  lines: SvgLineNode[];
};

export function extractSvgMarkup(markdown: string): string[] {
  const imagePrefix = "data:image/svg+xml;base64,";
  const images: string[] = [];
  let searchIndex = 0;

  while (searchIndex < markdown.length) {
    const imageIndex = markdown.indexOf(imagePrefix, searchIndex);
    if (imageIndex === -1) {
      break;
    }

    const encodedStart = imageIndex + imagePrefix.length;
    const encodedEnd = markdown.indexOf(")", encodedStart);
    if (encodedEnd === -1) {
      break;
    }

    const encodedPayload = markdown.slice(encodedStart, encodedEnd).split("?")[0];
    images.push(Buffer.from(encodedPayload, "base64").toString("utf8"));
    searchIndex = encodedEnd + 1;
  }

  return images;
}

export function extractFirstSvg(markdown: string): string {
  const [svg] = extractSvgMarkup(markdown);
  if (!svg) {
    throw new Error("No SVG image in markdown");
  }

  return svg;
}

export function parseSvg(svg: string): ParsedSvg {
  const texts: SvgTextNode[] = [];
  const rects: SvgRectNode[] = [];
  const lines: SvgLineNode[] = [];

  for (const match of svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
    const attrs = parseAttributes(match[1]);
    texts.push({
      content: match[2],
      x: requireNumber(attrs, "x"),
      y: requireNumber(attrs, "y"),
      fill: attrs.fill,
      fontSize: optionalNumber(attrs["font-size"]),
      fontWeight: optionalNumber(attrs["font-weight"]),
      index: match.index ?? 0,
    });
  }

  for (const match of svg.matchAll(/<rect\b([^>]*)\/?>/g)) {
    const attrs = parseAttributes(match[1]);
    rects.push({
      x: requireNumber(attrs, "x"),
      y: requireNumber(attrs, "y"),
      width: requireNumber(attrs, "width"),
      height: requireNumber(attrs, "height"),
      fill: attrs.fill,
      index: match.index ?? 0,
    });
  }

  for (const match of svg.matchAll(/<line\b([^>]*)\/?>/g)) {
    const attrs = parseAttributes(match[1]);
    lines.push({
      x1: requireNumber(attrs, "x1"),
      y1: requireNumber(attrs, "y1"),
      x2: requireNumber(attrs, "x2"),
      y2: requireNumber(attrs, "y2"),
      index: match.index ?? 0,
    });
  }

  return { texts, rects, lines };
}

export function parseDetailSvg(markdown: string): ParsedSvg {
  return parseSvg(extractFirstSvg(markdown));
}

export function requireText(parsed: ParsedSvg, content: string): SvgTextNode {
  const matches = parsed.texts.filter((text) => text.content === content);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one text node for "${content}", found ${matches.length}`);
  }

  return matches[0];
}

export function textY(parsed: ParsedSvg, content: string): number {
  return requireText(parsed, content).y;
}

export function lineYAfterText(parsed: ParsedSvg, content: string): number {
  const text = requireText(parsed, content);
  const line = parsed.lines.find((item) => item.index > text.index);
  if (!line) {
    throw new Error(`Could not find divider after "${content}"`);
  }

  return line.y1;
}

export function rectsWithSize(parsed: ParsedSvg, width: number, height: number): SvgRectNode[] {
  return parsed.rects.filter((rect) => rect.width === width && rect.height === height);
}

export function markerFills(parsed: ParsedSvg): string[] {
  return rectsWithSize(parsed, 3, 12).map((rect) => {
    if (!rect.fill) {
      throw new Error("Pace marker rect is missing a fill");
    }

    return rect.fill;
  });
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};

  for (const match of tag.matchAll(/([a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }

  return attrs;
}

function requireNumber(attrs: Record<string, string>, name: string): number {
  const value = Number(attrs[name]);
  if (!Number.isFinite(value)) {
    throw new Error(`SVG ${name} is missing or not a number`);
  }

  return value;
}

function optionalNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}
