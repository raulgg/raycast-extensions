import { describe, expect, it } from "vitest";
import manifest from "../../package.json";

const commands = manifest.commands as Array<{ name: string; interval?: string; subtitle?: string }>;

describe("background command manifest", () => {
  it("exposes the seven no-view controls and the CLI update view", () => {
    expect(manifest.commands.map(({ name }) => name)).toEqual([
      "set-noise-cancellation",
      "set-transparency",
      "set-adaptive",
      "set-off",
      "cycle-listening-mode",
      "toggle-conversation-awareness",
      "refresh-airpods-status",
      "update-airpods-control-cli",
    ]);
    expect(manifest.commands.slice(0, 7).every(({ mode }) => mode === "no-view")).toBe(true);
    expect(manifest.commands[7]).toMatchObject({
      name: "update-airpods-control-cli",
      title: "Manage AirPods Control Helper",
      mode: "view",
    });
  });
  it("refreshes AirPods status approximately once a minute", () => {
    expect(commands.find(({ name }) => name === "refresh-airpods-status")).toMatchObject({
      interval: "1m",
      subtitle: "AirPods",
    });
  });

  it.each(["cycle-listening-mode", "toggle-conversation-awareness"])(
    "keeps %s as a direct action without a background schedule",
    (commandName) => {
      expect(commands.find(({ name }) => name === commandName)?.interval).toBeUndefined();
    },
  );
});
