import { describe, expect, it } from "vitest";
import manifest from "../../package.json";

const commands = manifest.commands as Array<{ name: string; interval?: string }>;

describe("background command manifest", () => {
  it("refreshes AirPods status approximately once a minute", () => {
    expect(commands.find(({ name }) => name === "refresh-airpods-status")?.interval).toBe("1m");
  });

  it.each(["cycle-listening-mode", "toggle-conversation-awareness"])(
    "keeps %s as a direct action without a background schedule",
    (commandName) => {
      expect(commands.find(({ name }) => name === commandName)?.interval).toBeUndefined();
    },
  );
});
