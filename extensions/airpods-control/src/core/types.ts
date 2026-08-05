export type ListeningModes = "off" | "anc" | "transparency" | "adaptive";

export type CliListeningMode = "off" | "transparency" | "adaptive" | "noise-cancellation";

export type ConversationAwarenessState = "on" | "off";

/**
 * Structured output emitted by the airpods-control CLI with `--json`.
 * Command-specific state fields are null when unavailable or on errors.
 */
export interface CliPayload {
  result: "ok" | "error";
  device: string | null;
  error?: string;
  listeningMode?: string | null;
  conversationAwareness?: string | null;
  supportedListeningModes?: string[];
}

export interface ExtensionPreferences {
  cliPath?: string;
}

export interface CycleCommandPreferences {
  cycleOff: boolean;
  cycleTransparency: boolean;
  cycleAdaptive: boolean;
  cycleAnc: boolean;
}
