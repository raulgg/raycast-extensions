import { updateCommandMetadata } from "@raycast/api";

export async function resetCommandSubtitle(): Promise<void> {
  try {
    await updateCommandMetadata({ subtitle: null });
  } catch (error) {
    console.error("Failed to restore the command subtitle", error);
  }
}

export async function publishCommandSubtitle(subtitle: string): Promise<void> {
  try {
    await updateCommandMetadata({ subtitle });
  } catch (error) {
    console.error("Failed to update the command subtitle", error);
    await resetCommandSubtitle();
  }
}
