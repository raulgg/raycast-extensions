import type { ListeningModes } from "../airpods/types";

export interface CycleCommandPreferences {
  cycleOff: boolean;
  cycleTransparency: boolean;
  cycleAdaptive: boolean;
  cycleAnc: boolean;
}

export const CYCLE_MODE_ORDER: ListeningModes[] = ["off", "transparency", "adaptive", "anc"];
