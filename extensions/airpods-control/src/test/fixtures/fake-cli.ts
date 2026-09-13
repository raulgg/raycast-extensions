import { chmod, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { onTestFinished } from "vitest";

export async function createFakeCli(body: string) {
  const directory = await mkdtemp(join(tmpdir(), "airpods-control-cli-test-"));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  onTestFinished(cleanup);
  const path = join(directory, "airpods-control");
  await writeFile(path, `#!/bin/sh\nset -eu\n${body}\n`, "utf8");
  await chmod(path, 0o755);
  return { path, cleanup };
}
