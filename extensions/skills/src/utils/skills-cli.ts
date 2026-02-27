import { exec } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import type { InstalledSkill, Skill } from "../shared";

const execAsync = promisify(exec);
const home = homedir();
const isWindows = process.platform === "win32";

/**
 * Run a CLI command with the user's full PATH.
 * - macOS/Linux: wraps in `zsh -li -c` so PATH includes zsh interactive setup (nvm/fnm, homebrew, etc.).
 * - Windows: runs directly via cmd since PATH is inherited.
 */
function execWithPath(command: string) {
  if (isWindows) {
    return execAsync(command);
  }
  return execAsync(`zsh -li -c ${shellEscape(command)}`);
}

function buildSkillsCliCommand(args: string[]): string {
  return ["npx", "-y", "skills@latest", ...args].map(shellEscape).join(" ");
}

async function runSkillsCli(args: string[]): Promise<string> {
  const { stdout } = await execWithPath(buildSkillsCliCommand(args));
  return stdout;
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
