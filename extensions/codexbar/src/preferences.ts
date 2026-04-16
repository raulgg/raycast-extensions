import { getPreferenceValues } from "@raycast/api";

export function getHidePersonalInfoPreference(): boolean {
  return getPreferenceValues<Preferences>().hidePersonalInfo ?? false;
}
