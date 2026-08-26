import { describe, expect, it } from "vitest";
import { parseSvg, requireText } from "./svg-markdown";

describe("requireText", () => {
  it("throws when two text nodes share the same content", () => {
    const parsed = parseSvg(`<svg><text x="0" y="10">53% left</text><text x="0" y="40">53% left</text></svg>`);

    expect(() => requireText(parsed, "53% left")).toThrow('Expected exactly one text node for "53% left", found 2');
  });
});
