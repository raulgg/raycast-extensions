import type { AirPodsStatusSnapshot, ConversationAwarenessState, ListeningModes } from "./types";

interface StatePresentation {
  label: string;
  symbol: string;
}

// Use the same geometric-circle base for every listening mode. The combining
// slash keeps Off the same visual size as the other symbols.
export const LISTENING_MODE_PRESENTATION = {
  off: { label: "Off", symbol: "○̸" },
  transparency: { label: "Transparency", symbol: "○" },
  adaptive: { label: "Adaptive", symbol: "◑" },
  anc: { label: "Noise Cancellation", symbol: "●" },
} as const satisfies Record<ListeningModes, StatePresentation>;

export const CONVERSATION_AWARENESS_PRESENTATION = {
  on: { label: "On", symbol: "●" },
  off: { label: "Off", symbol: "○" },
} as const satisfies Record<ConversationAwarenessState, StatePresentation>;

export function listeningModeSubtitle(mode: ListeningModes): string {
  const { label, symbol } = LISTENING_MODE_PRESENTATION[mode];
  return `${label} ${symbol}`;
}

export function listeningModeHud(mode: ListeningModes): string {
  const { label, symbol } = LISTENING_MODE_PRESENTATION[mode];
  return `Set to ${label} ${symbol}`;
}

export function conversationAwarenessSubtitle(state: ConversationAwarenessState): string {
  const { label, symbol } = CONVERSATION_AWARENESS_PRESENTATION[state];
  return `${label} ${symbol}`;
}

export function conversationAwarenessHud(state: ConversationAwarenessState): string {
  const { label, symbol } = CONVERSATION_AWARENESS_PRESENTATION[state];
  return `Conversation Awareness ${label} ${symbol}`;
}

export function formatAirPodsStatusSubtitle(status: AirPodsStatusSnapshot): string | null {
  const parts: string[] = [];

  if (status.listeningMode) {
    parts.push(listeningModeSubtitle(status.listeningMode));
  }
  if (status.conversationAwareness) {
    parts.push(`CA ${CONVERSATION_AWARENESS_PRESENTATION[status.conversationAwareness].symbol}`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}
