import { expect, test } from "vitest";
import manifest from "../../package.json";

const commands = manifest.commands as Array<{ name: string; interval?: string; subtitle?: string }>;

test("exposes the seven no-view controls and the CLI update view", () => {
  // Given
  const commands = manifest.commands;
  // When
  const names = commands.map(({ name }) => name);
  // Then
  expect(names).toEqual([
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

test("refreshes AirPods status approximately once a minute", () => {
  // Given
  const name = "refresh-airpods-status";
  // When
  const command = commands.find((command) => command.name === name);
  // Then
  expect(command).toMatchObject({
    interval: "1m",
    subtitle: "AirPods",
  });
});

test.each(["cycle-listening-mode", "toggle-conversation-awareness"])(
  "keeps %s as a direct action without a background schedule",
  (commandName) => {
    // Given the command name supplied by this case
    // When
    const command = commands.find(({ name }) => name === commandName);
    // Then
    expect(command?.interval).toBeUndefined();
  },
);
