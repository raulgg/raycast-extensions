import { expect, test } from "vitest";
import { cliSetup, installedCliSetup, outdatedCliSetup } from "../test/fixtures/cli-setup";
import { screenMarkdown, setupScreen, UPDATE_NOTES } from "./screens";

function paragraphs(setup: ReturnType<typeof cliSetup>): string[] {
  return setupScreen(setup).body.split("\n\n");
}

test("lists version facts and omits the path when the CLI location is unknown", () => {
  // Given
  const setup = installedCliSetup({ cliPath: null });
  // When
  const [facts] = paragraphs(setup);
  // Then
  expect(facts).toBe("- **Version:** 0.4.0\n- **Install method:** Homebrew");
});

test("shows the latest version only on update screens", () => {
  // Given / When
  const upToDate = setupScreen(installedCliSetup());
  const update = setupScreen(outdatedCliSetup());
  // Then
  expect(upToDate.body).not.toContain("**Latest:**");
  expect(update.body).toContain("- **Latest:** 0.4.0");
});

test.each([
  {
    name: "an unknown version wins over a failed live check",
    setup: installedCliSetup({ latestVersion: null, versionStatus: "unknown", liveCheckFailed: true }),
    note: "Could not determine the CLI version.",
  },
  {
    name: "a newer install wins over a failed live check",
    // Detection would call this up to date; the status is forced so the update screen renders.
    setup: installedCliSetup({ installedVersion: "0.9.0", versionStatus: "update-available", liveCheckFailed: true }),
    note: "This install is newer than the known release.",
  },
  {
    name: "a failed live check wins over a saved CLI Path",
    setup: installedCliSetup({ liveCheckFailed: true, configuredCliPath: "/x" }),
    note: "Could not confirm the latest release.",
  },
  {
    name: "a saved CLI Path is mentioned last",
    setup: installedCliSetup({ configuredCliPath: "/x" }),
    note: "Using the saved **CLI Path**.",
  },
] as const)("shows a single version note when $name", ({ setup, note }) => {
  // When
  const body = setupScreen(setup).body;
  // Then
  const shown = UPDATE_NOTES.map((rule) => rule.text).filter((text) => body.includes(text));
  expect(shown).toEqual([note]);
});

test("never reports an unreadable version on the up-to-date screen", () => {
  // Given: detection never routes an unknown version here, so the guard must hold on the screen itself.
  const setup = installedCliSetup({ installedVersion: null, liveCheckFailed: true });
  // When
  const screen = setupScreen(setup);
  // Then
  expect(screen.title).toBe("AirPods Control CLI is up to date");
  expect(screen.body).toContain("- **Version:** unknown");
  expect(screen.body).not.toContain("Could not determine the CLI version.");
  expect(screen.body).toContain("Could not confirm the latest release.");
});

test("adds the minimum version note alongside the version note", () => {
  // Given
  const setup = outdatedCliSetup({ configuredCliPath: "/x" });
  // When
  const body = setupScreen(setup).body;
  // Then
  expect(body).toContain("Using the saved **CLI Path**.");
  expect(body).toMatch(/older than the minimum this extension requires \(\d+\.\d+\.\d+\)/);
});

test("skips the version and minimum notes when nothing needs attention", () => {
  // Given
  const setup = installedCliSetup();
  // When
  const body = paragraphs(setup);
  // Then
  expect(body).toHaveLength(1);
  expect(body[0]).toContain("- **Version:** 0.4.0");
  expect(body[0]).not.toContain("minimum");
});

test.each([
  { brewLinked: true, cause: "already linked", command: "brew link --overwrite raulgg/tap/airpods-control" },
  { brewLinked: false, cause: "has not linked", command: "brew link raulgg/tap/airpods-control" },
  { brewLinked: null, cause: "could not report", command: "brew link raulgg/tap/airpods-control" },
] as const)("explains and fixes the link when brewLinked is $brewLinked", ({ brewLinked, cause, command }) => {
  // Given
  const setup = cliSetup({ state: "needs-link", brewCliPrefix: "/opt/homebrew/opt/airpods-control", brewLinked });
  // When
  const screen = setupScreen(setup);
  // Then
  expect(screen.body).toContain(cause);
  expect(screen.body).toContain(`\`\`\`\n${command}\n\`\`\``);
  expect(screen.actions[0]?.[0]).toEqual({ type: "copy", title: "Copy Link Command", content: command });
});

test("falls back to a generic keg label without a Homebrew prefix", () => {
  // Given
  const setup = cliSetup({ state: "needs-reinstall" });
  // When
  const body = setupScreen(setup).body;
  // Then
  expect(body).toContain("binary at its Homebrew prefix.");
});

test("renders the title as a heading above the body", () => {
  // Given
  const screen = setupScreen(cliSetup({ state: "needs-homebrew", brewPath: null }));
  // When
  const markdown = screenMarkdown(screen);
  // Then
  expect(markdown.startsWith("# Install Homebrew\n\nHomebrew is not installed.\n\n")).toBe(true);
});
