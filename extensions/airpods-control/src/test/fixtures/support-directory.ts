import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { environment } from "@raycast/api";
import { onTestFinished } from "vitest";

export function createSupportDirectory() {
  const previousPath = environment.supportPath;
  const path = mkdtempSync(join(tmpdir(), "airpods-control-support-test-"));
  environment.supportPath = path;
  onTestFinished(() => {
    try {
      rmSync(path, { recursive: true, force: true });
    } finally {
      environment.supportPath = previousPath;
    }
  });
  return path;
}
