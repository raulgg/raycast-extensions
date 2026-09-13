export type ListeningModes = "off" | "anc" | "transparency" | "adaptive";

export type ConversationAwarenessState = "on" | "off";

export interface AirPodsStatusSnapshot {
  listeningMode: ListeningModes | null;
  conversationAwareness: ConversationAwarenessState | null;
}
