import { execFile } from "child_process";
import { mkdirSync } from "fs";
import { join } from "path";
import { environment } from "@raycast/api";

export function brewLockCommand(file: string, args: string[]) {
  mkdirSync(environment.supportPath, { recursive: true });
  // Keep one inode across launches. The OS releases the lock when the process exits.
  return {
    file: "/usr/bin/lockf",
    args: ["-k", "-s", "-t", "0", join(environment.supportPath, "cli-install.lock"), file, ...args],
  };
}

export async function isBrewOperationRunning(): Promise<boolean> {
  const command = brewLockCommand("/usr/bin/true", []);
  return new Promise((resolve, reject) => {
    execFile(command.file, command.args, { timeout: 5000 }, (error) => {
      if (!error) resolve(false);
      else if (error.code === 75) resolve(true);
      else reject(error);
    });
  });
}
