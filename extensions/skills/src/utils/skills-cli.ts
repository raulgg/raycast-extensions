import { homedir } from "node:os";
import { basename } from "node:path";
import { getCustomNpxPath } from "../preferences";
import type { InstalledSkill, Skill } from "../shared";
import { execAsync } from "./exec-async";
import { getExecOptions } from "./exec-options";

const home = homedir();
const isWindows = process.platform === "win32";

type ExecFailure = Error & {
  code?: string | number;
  stderr?: string;
};

export class NpxResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NpxResolutionError";
  }
}

export function isNpxResolutionError(error: unknown): boolean {
  return error instanceof NpxResolutionError;
}

function buildSkillsCliCommand(npxCommand: string, args: string[]): string {
  return [npxCommand, "-y", "skills@latest", ...args].map(shellEscape).join(" ");
}

async function runSkillsCli(args: string[]): Promise<string> {
  const npxCommand = getCustomNpxPath() ?? "npx";
  try {
    const { stdout } = await execAsync(buildSkillsCliCommand(npxCommand, args), getExecOptions());
    return stdout.toString();
  } catch (error) {
    throw normalizeCliError(error, npxCommand);
  }
}

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1B\[[0-9;]*m/g;

/**
 * Strip ANSI escape codes from CLI output.
 * The skills CLI forces colors with no --no-color or --json option.
 */
function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, "");
}

/** Escape a value for safe use as a shell argument. */
function shellEscape(arg: string): string {
  if (isWindows) {
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function normalizeCliError(error: unknown, npxCommand: string): Error {
  if (isNpxCommandResolutionFailure(error, npxCommand)) {
    return new NpxResolutionError(
      "Unable to find a working npx command. Run `which npx` in Terminal, then set that path in Extension Preferences under 'Custom npx Path'.",
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Failed to execute the skills CLI command.");
}

function isNpxCommandResolutionFailure(error: unknown, npxCommand: string): boolean {
  const failure = error as ExecFailure | undefined;
  const code = typeof failure?.code === "string" || typeof failure?.code === "number" ? String(failure.code) : "";
  const details = [failure?.message, failure?.stderr]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLowerCase();
  const normalizedNpxCommand = npxCommand.toLowerCase();
  const commandBase = basename(normalizedNpxCommand).replace(/\.exe$/, "");
  const windowsCommandNotFound = `'${commandBase}' is not recognized as an internal or external command`;

  const mentionsCommand =
    details.includes(`spawn ${normalizedNpxCommand} `) ||
    details.includes(`spawn ${commandBase} `) ||
    details.includes(`command not found: ${commandBase}`) ||
    details.includes(`${commandBase}: command not found`) ||
    details.includes(windowsCommandNotFound);

  return (
    (code === "ENOENT" && mentionsCommand) ||
    details.includes(`spawn ${normalizedNpxCommand} enoent`) ||
    details.includes(`spawn ${commandBase} enoent`) ||
    details.includes(`command not found: ${commandBase}`) ||
    details.includes(`${commandBase}: command not found`) ||
    details.includes(windowsCommandNotFound)
  );
}

/**
 * Parse `npx skills list -g` output into InstalledSkill[].
 *
 * After stripping ANSI, format is:
 *   Global Skills
 
 *   skill-name ~/.agents/skills/skill-name
 *   Agents: Claude Code, Cline, Codex, Command Code, Continue +19 more
 */
function parseSkillsList(raw: string): InstalledSkill[] {
  const clean = stripAnsi(raw);
  const skills: InstalledSkill[] = [];
  const lines = clean.split("\n");

  for (let i = 0; i < lines.length; i++) {
    // Matches: "skill-name ~/path" or "skill-name /path" (macOS/Linux)
    //      or: "skill-name C:\path" (Windows)
    const skillMatch = lines[i].match(/^(\S+)\s+(~?\/.*|[A-Z]:\\.*)$/);
    if (!skillMatch) continue;

    const name = skillMatch[1];
    const rawPath = skillMatch[2].trim();
    const path = rawPath.startsWith("~") ? rawPath.replace("~", home) : rawPath;

    let agents: string[] = [];
    let agentCount = 0;
    const nextLine = lines[i + 1]?.trim();
    if (nextLine?.startsWith("Agents:")) {
      agents = nextLine
        .replace("Agents:", "")
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);

      // Handle "+N more" truncation from CLI output
      // e.g. ["Antigravity", "Claude Code", "Continue +16 more"]
      let extraCount = 0;
      const last = agents[agents.length - 1];
      const moreMatch = last?.match(/^(.+?)\s*\+(\d+) more$/);
      if (moreMatch) {
        agents[agents.length - 1] = moreMatch[1].trim();
        extraCount = parseInt(moreMatch[2], 10);
      }

      agentCount = agents.length + extraCount;
    }

    skills.push({ name, path, agents, agentCount });
  }

  return skills;
}

export async function listInstalledSkills(): Promise<InstalledSkill[]> {
  const stdout = await runSkillsCli(["list", "-g"]);
  return parseSkillsList(stdout);
}

export async function installSkill(skill: Skill): Promise<void> {
  await runSkillsCli(["add", `${skill.source}@${skill.skillId}`, "-g", "-y"]);
}

export async function removeSkill(skillName: string): Promise<void> {
  await runSkillsCli(["remove", skillName, "-g", "-y"]);
}
