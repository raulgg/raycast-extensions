import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./components/UsageList", () => ({
  UsageList: () => null,
}));

import { UsageList } from "./components/UsageList";
import Command from "./usage-overview";

const overviewSource = readFileSync(resolve(__dirname, "usage-overview.tsx"), "utf8");

describe("Usage Overview command", () => {
  it("renders the list and does not launch Refresh Usage Cache", () => {
    expect(Command()).toEqual(expect.objectContaining({ type: UsageList }));
    expect(overviewSource).not.toContain("launchRefreshUsageCacheIfNeeded");
    expect(overviewSource).not.toContain("launchCommand");
    expect(overviewSource).not.toContain("ensureCodexBarServe");
  });
});
