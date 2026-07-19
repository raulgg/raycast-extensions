import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildInstallHelp,
  detectHomebrew,
  findCodexBarApp,
  HOMEBREW_APP_AND_CLI_COMMAND,
  HOMEBREW_CLI_ONLY_COMMAND,
  installCodexBarCli,
} from "./cliInstall";

// installCodexBarCli takes its destination dirs by injection, so these tests
// drive real temp directories instead of fs mocks.
describe("cliInstall", () => {
  let root: string;
  let appBundlePath: string;
  let helperPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "codexbar-cli-install-"));
    appBundlePath = join(root, "CodexBar.app");
    helperPath = join(appBundlePath, "Contents", "Helpers", "CodexBarCLI");
    await mkdir(dirname(helperPath), { recursive: true });
    await writeFile(helperPath, "#!/bin/sh\n");
    await chmod(helperPath, 0o755);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("installCodexBarCli", () => {
    it("symlinks the helper into every present writable bin dir, best-effort over both", async () => {
      const binA = join(root, "usr-local-bin");
      const binB = join(root, "opt-homebrew-bin");
      await mkdir(binA);
      await mkdir(binB);

      const result = await installCodexBarCli(helperPath, { binDirs: [binA, binB] });

      expect(result.results).toEqual([`Installed: ${binA}`, `Installed: ${binB}`]);
      expect(result.statusLine).toBe(`Installed: ${binA} · Installed: ${binB}`);
      await expect(readlink(join(binA, "codexbar"))).resolves.toBe(helperPath);
      await expect(readlink(join(binB, "codexbar"))).resolves.toBe(helperPath);
    });

    it("reports a destination already linking to the helper as installed", async () => {
      const bin = join(root, "bin");
      await mkdir(bin);
      await symlink(helperPath, join(bin, "codexbar"));

      const result = await installCodexBarCli(helperPath, { binDirs: [bin] });

      expect(result.statusLine).toBe(`Installed: ${bin}`);
    });

    it("resolves a relative destination link against its dir, like upstream's isLink", async () => {
      const bin = join(root, "bin");
      await mkdir(bin);
      await symlink(relative(bin, helperPath), join(bin, "codexbar"));

      const result = await installCodexBarCli(helperPath, { binDirs: [bin] });

      expect(result.statusLine).toBe(`Installed: ${bin}`);
    });

    it("leaves a foreign file at the destination untouched and reports it", async () => {
      const bin = join(root, "bin");
      await mkdir(bin);
      const destination = join(bin, "codexbar");
      await writeFile(destination, "#!/bin/sh\necho other\n");

      const result = await installCodexBarCli(helperPath, { binDirs: [bin] });

      expect(result.statusLine).toBe(`Exists: ${bin}`);
      await expect(readFile(destination, "utf8")).resolves.toBe("#!/bin/sh\necho other\n");
      expect((await lstat(destination)).isSymbolicLink()).toBe(false);
    });

    // Root sees every dir as writable, so the permission refusal cannot be provoked.
    it.skipIf(process.getuid?.() === 0)("reports a non-writable bin dir without escalating", async () => {
      const bin = join(root, "bin");
      await mkdir(bin);
      await chmod(bin, 0o555);

      const result = await installCodexBarCli(helperPath, { binDirs: [bin] });

      expect(result.statusLine).toBe(`No write access: ${bin}`);
    });

    it("skips a missing bin dir without a result entry and without creating it", async () => {
      const missing = join(root, "missing-bin");
      const present = join(root, "bin");
      await mkdir(present);

      const result = await installCodexBarCli(helperPath, { binDirs: [missing, present] });

      expect(result.results).toEqual([`Installed: ${present}`]);
      await expect(lstat(missing)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("reports no writable bin dirs when every destination dir is missing", async () => {
      const result = await installCodexBarCli(helperPath, { binDirs: [join(root, "a"), join(root, "b")] });

      expect(result.results).toEqual([]);
      expect(result.statusLine).toBe("No writable bin dirs found.");
    });

    it("stops with the upstream message when the helper is missing from the app bundle", async () => {
      const bin = join(root, "bin");
      await mkdir(bin);

      const result = await installCodexBarCli(join(root, "Missing.app", "Contents", "Helpers", "CodexBarCLI"), {
        binDirs: [bin],
      });

      expect(result.results).toEqual([]);
      expect(result.statusLine).toBe("CodexBarCLI not found in app bundle.");
    });

    it("reports a dangling destination link as failed, mirroring upstream's follow-symlink existence check", async () => {
      const bin = join(root, "bin");
      await mkdir(bin);
      await symlink(join(root, "gone"), join(bin, "codexbar"));

      const result = await installCodexBarCli(helperPath, { binDirs: [bin] });

      expect(result.statusLine).toBe(`Failed: ${bin}`);
    });
  });

  describe("findCodexBarApp", () => {
    it("returns the helper path from the first app bundle whose bundled CLI is executable", async () => {
      const bareApp = join(root, "other", "CodexBar.app");
      await mkdir(join(bareApp, "Contents", "Helpers"), { recursive: true });

      await expect(findCodexBarApp([bareApp, appBundlePath])).resolves.toBe(helperPath);
    });

    it("treats an app whose bundled CLI is not executable as missing", async () => {
      await chmod(helperPath, 0o644);

      await expect(findCodexBarApp([appBundlePath])).resolves.toBeUndefined();
    });

    it("returns undefined when no app bundle is present", async () => {
      await expect(findCodexBarApp([join(root, "nope", "CodexBar.app")])).resolves.toBeUndefined();
    });
  });

  describe("detectHomebrew", () => {
    it("returns the prefix of the first executable brew binary", async () => {
      const prefix = join(root, "homebrew");
      const brewPath = join(prefix, "bin", "brew");
      await mkdir(dirname(brewPath), { recursive: true });
      await writeFile(brewPath, "#!/bin/sh\n");
      await chmod(brewPath, 0o755);

      await expect(detectHomebrew([join(root, "missing", "bin", "brew"), brewPath])).resolves.toBe(prefix);
    });

    it("returns undefined when no brew binary is executable", async () => {
      await expect(detectHomebrew([join(root, "missing", "bin", "brew")])).resolves.toBeUndefined();
    });
  });

  describe("buildInstallHelp", () => {
    const helper = "/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI";

    it("forks to cli-missing when the app helper is present, without Homebrew routes or paths", () => {
      const help = buildInstallHelp({ helperPath: helper, homebrewPrefix: "/opt/homebrew" });

      expect(help.kind).toBe("cli-missing");
      if (help.kind === "cli-missing") {
        expect(help.helperPath).toBe(helper);
        expect(help.markdown).toContain("The CodexBar app is installed");
        // No Homebrew route here: a formula install would collide with the
        // app's own codexbar link.
        expect(help.markdown).not.toContain("brew install");
        expect(help.markdown).not.toContain("/Applications");
      }
    });

    it("forks to app-missing with both fully-qualified Homebrew commands when brew is present", () => {
      const help = buildInstallHelp({ homebrewPrefix: "/opt/homebrew" });

      expect(help.kind).toBe("app-missing");
      if (help.kind === "app-missing") {
        expect(help.homebrewCommands).toEqual({
          appAndCli: HOMEBREW_APP_AND_CLI_COMMAND,
          cliOnly: HOMEBREW_CLI_ONLY_COMMAND,
        });
        expect(help.markdown).toContain("brew install --cask steipete/tap/codexbar");
        expect(help.markdown).toContain("brew install --formula steipete/tap/codexbar");
      }
    });

    it("lays out download routes matched to the CPU architecture when Homebrew is absent", () => {
      const help = buildInstallHelp({ arch: "arm64" });

      expect(help.kind).toBe("app-missing");
      if (help.kind === "app-missing") {
        expect(help.homebrewCommands).toBeUndefined();
        expect(help.markdown).toContain("codexbar.app");
        expect(help.markdown).toContain("macos-arm64");
        expect(help.markdown).not.toContain("brew install --cask");
        // Closing line pointing at Homebrew as the shorter route.
        expect(help.markdown).toContain("Homebrew");
      }

      const intel = buildInstallHelp({ arch: "x64" });

      expect(intel.kind).toBe("app-missing");
      if (intel.kind === "app-missing") {
        expect(intel.markdown).toContain("macos-x86_64");
      }
    });
  });
});
