import { expect, test } from "vitest";
import manifest from "../../package.json";

test("exposes each command with its required execution mode", () => {
  // Given
  const expectedModes = {
    "set-noise-cancellation": "no-view",
    "set-transparency": "no-view",
    "set-adaptive": "no-view",
    "set-off": "no-view",
    "cycle-listening-mode": "no-view",
    "toggle-conversation-awareness": "no-view",
    "refresh-airpods-status": "no-view",
    "update-airpods-control-cli": "view",
  };

  // When
  const modes = Object.fromEntries(manifest.commands.map(({ name, mode }) => [name, mode]));

  // Then
  expect(modes).toEqual(expectedModes);
  expect(manifest.commands).toHaveLength(Object.keys(expectedModes).length);
});

test("schedules status refresh while leaving direct controls unscheduled", () => {
  // Given
  const commands: Array<{ name: string; interval?: string; subtitle?: string }> = manifest.commands;

  // When
  const refresh = commands.find(({ name }) => name === "refresh-airpods-status");
  const directControls = commands.filter(({ name }) =>
    ["cycle-listening-mode", "toggle-conversation-awareness"].includes(name),
  );

  // Then
  expect(refresh).toMatchObject({ interval: "1m", subtitle: "AirPods" });
  expect(directControls).toHaveLength(2);
  for (const command of directControls) expect(command.interval).toBeUndefined();
});
