import { describe, expect, it } from "vitest";
import { applyKeychainAccessPolicy, CODEXBAR_DISABLE_KEYCHAIN_ACCESS_ENV } from "./keychainAccessPolicy";

describe("Keychain access policy", () => {
  it("sets the CodexBar guard for disabled policy without mutating the parent environment", () => {
    const parentEnvironment = { PATH: "/usr/bin", [CODEXBAR_DISABLE_KEYCHAIN_ACCESS_ENV]: "0" };

    const childEnvironment = applyKeychainAccessPolicy(parentEnvironment, "disabled");

    expect(childEnvironment).toMatchObject({
      PATH: "/usr/bin",
      [CODEXBAR_DISABLE_KEYCHAIN_ACCESS_ENV]: "1",
    });
    expect(parentEnvironment[CODEXBAR_DISABLE_KEYCHAIN_ACCESS_ENV]).toBe("0");
  });

  it("removes an inherited guard for the default policy", () => {
    const childEnvironment = applyKeychainAccessPolicy(
      { PATH: "/usr/bin", [CODEXBAR_DISABLE_KEYCHAIN_ACCESS_ENV]: "1" },
      "default",
    );

    expect(childEnvironment.PATH).toBe("/usr/bin");
    expect(childEnvironment).not.toHaveProperty(CODEXBAR_DISABLE_KEYCHAIN_ACCESS_ENV);
  });
});
