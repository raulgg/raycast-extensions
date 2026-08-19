import { getPreferenceValues } from "@raycast/api";
import type { KeychainAccessPolicy } from "./lib/keychainAccessPolicy";

export function getHidePersonalInfoPreference(): boolean {
  return getPreferenceValues<Preferences>().hidePersonalInfo ?? false;
}

export function getKeychainAccessPolicy(): KeychainAccessPolicy {
  return getPreferenceValues<Preferences>().disableKeychainAccess ? "disabled" : "default";
}
