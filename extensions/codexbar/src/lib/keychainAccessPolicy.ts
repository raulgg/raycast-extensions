export const CODEXBAR_DISABLE_KEYCHAIN_ACCESS_ENV = "CODEXBAR_DISABLE_KEYCHAIN_ACCESS";

export type KeychainAccessPolicy = "default" | "disabled";

export function applyKeychainAccessPolicy(
  environment: NodeJS.ProcessEnv,
  policy: KeychainAccessPolicy,
): NodeJS.ProcessEnv {
  const childEnvironment = { ...environment };

  if (policy === "disabled") {
    childEnvironment[CODEXBAR_DISABLE_KEYCHAIN_ACCESS_ENV] = "1";
  } else {
    delete childEnvironment[CODEXBAR_DISABLE_KEYCHAIN_ACCESS_ENV];
  }

  return childEnvironment;
}
