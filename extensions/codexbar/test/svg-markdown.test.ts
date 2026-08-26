import { describe, expect, it } from "vitest";
import { parseSvg, requireText } from "./svg-markdown";

describe("requireText", () => {
  it("throws when two text nodes share the same content", () => {
    const parsed = parseSvg(`<svg><text x="0" y="10">53% left</text><text x="0" y="40">53% left</text></svg>`);

    expect(() => requireText(parsed, "53% left")).toThrow('Expected exactly one text node for "53% left", found 2');
  });
});

describe("parseSvg", () => {
  it("parses line coordinates that include digits in the attribute name", () => {
    const parsed = parseSvg(`<svg><line x1="0" y1="10.5" x2="10" y2="10.5"/></svg>`);

    expect(parsed.lines[0]?.y1).toBe(10.5);
  });

  it("throws when a rect is missing a required coordinate", () => {
    expect(() => parseSvg(`<svg><rect y="1" width="3" height="12"/></svg>`)).toThrow(
      "SVG x is missing or not a number",
    );
  });
});
