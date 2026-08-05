import { Clipboard, Keyboard, showHUD, showToast, Toast } from "@raycast/api";

const UNEXPECTED_ERROR_MESSAGE = "An unexpected error occurred.";

export interface ToastTitles {
  loading: string;
  success: string;
  failure: string;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return UNEXPECTED_ERROR_MESSAGE;
}

export function createCopyErrorAction(message: string): Toast.ActionOptions {
  return {
    title: "Copy Error",
    shortcut: Keyboard.Shortcut.Common.Copy,
    onAction: async () => {
      await Clipboard.copy(message);
    },
  };
}

/**
 * Manages command feedback across an in-window progress toast, a copyable
 * failure toast, and a success HUD.
 */
export class ToastManager {
  private toast: Toast | null = null;
  private readonly titles: ToastTitles;

  public constructor(titles: ToastTitles) {
    this.titles = titles;
  }

  async setToLoading({
    titleOverride,
    titleSuffix,
  }: { titleOverride?: string; titleSuffix?: string } = {}): Promise<ToastManager> {
    const style = Toast.Style.Animated;
    const title = titleOverride ?? this.titles.loading;

    const finalTitle = titleSuffix ? `${title} - ${titleSuffix}` : title;
    if (this.toast) {
      this.toast.style = style;
      this.toast.title = finalTitle;
      this.toast.message = undefined;
      this.toast.primaryAction = undefined;
      this.toast.secondaryAction = undefined;
      // Property updates are fire-and-forget; awaiting show() flushes them so a
      // no-view command can't terminate before the new state is on screen.
      await this.toast.show();
    } else {
      this.toast = await showToast({
        style,
        title: finalTitle,
      });
    }

    return this;
  }

  async setToSuccess({
    titleOverride,
    titleSuffix,
  }: { titleOverride?: string; titleSuffix?: string } = {}): Promise<ToastManager> {
    const title = titleOverride ?? this.titles.success;
    const finalTitle = titleSuffix ? `${title} - ${titleSuffix}` : title;

    await this.hide();
    await showHUD(finalTitle);

    return this;
  }

  async setToFailure({
    titleOverride,
    titleSuffix,
    error,
  }: { titleOverride?: string; titleSuffix?: string; error?: unknown } = {}): Promise<ToastManager> {
    const style = Toast.Style.Failure;
    const title = titleOverride ?? this.titles.failure;
    const finalTitle = titleSuffix ? `${title} - ${titleSuffix}` : title;
    const message = getErrorMessage(error);
    const primaryAction = createCopyErrorAction(message);

    if (this.toast) {
      this.toast.style = style;
      this.toast.title = finalTitle;
      this.toast.message = message;
      this.toast.primaryAction = primaryAction;
      this.toast.secondaryAction = undefined;
      // Flush the update before the command's promise resolves and the process exits.
      await this.toast.show();
    } else {
      this.toast = await showToast({
        style,
        title: finalTitle,
        message,
        primaryAction,
      });
    }

    return this;
  }

  async hide(): Promise<void> {
    if (!this.toast) return;

    await this.toast.hide();
    this.toast = null;
  }
}
