import { Clipboard, closeMainWindow, Keyboard, showHUD, showToast, Toast } from "@raycast/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastManager, type ToastTitles } from "./toast-manager";

const mockClipboardCopy = vi.mocked(Clipboard.copy);
const mockCloseMainWindow = vi.mocked(closeMainWindow);
const mockShowHUD = vi.mocked(showHUD);
const mockShowToast = vi.mocked(showToast);

const titles: ToastTitles = {
  loading: "Setting AirPods to Transparency...",
  success: "Set to Transparency ○",
  failure: "Failed to set AirPods to Transparency",
};

function makeMockToast(overrides: Partial<Toast> = {}) {
  return {
    style: Toast.Style.Animated,
    title: "Loading...",
    message: undefined,
    primaryAction: undefined,
    secondaryAction: undefined,
    hide: vi.fn(async () => {}),
    show: vi.fn(async () => {}),
    id: "test-id",
    options: {},
    callbacks: {},
    ...overrides,
  };
}

describe("toast-manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("setToLoading", () => {
    it("shows progress without closing the Raycast window", async () => {
      const manager = new ToastManager(titles);

      await manager.setToLoading();

      expect(mockShowToast).toHaveBeenCalledWith({
        style: Toast.Style.Animated,
        title: titles.loading,
      });
      expect(mockCloseMainWindow).not.toHaveBeenCalled();
      expect(mockShowHUD).not.toHaveBeenCalled();
    });

    it("supports loading title overrides and suffixes", async () => {
      const manager = new ToastManager(titles);

      await manager.setToLoading({ titleOverride: "Custom loading title", titleSuffix: "Device 1" });

      expect(mockShowToast).toHaveBeenCalledWith({
        style: Toast.Style.Animated,
        title: "Custom loading title - Device 1",
      });
    });

    it("resets and reuses an existing toast", async () => {
      const mockToast = makeMockToast({
        style: Toast.Style.Failure,
        title: "Previous title",
        message: "Previous error",
        primaryAction: { title: "Previous action", onAction: vi.fn() },
        secondaryAction: { title: "Secondary action", onAction: vi.fn() },
      });
      mockShowToast.mockResolvedValueOnce(mockToast as unknown as Toast);
      const manager = new ToastManager(titles);
      await manager.setToLoading();
      vi.clearAllMocks();

      await manager.setToLoading();

      expect(mockShowToast).not.toHaveBeenCalled();
      expect(mockToast.style).toBe(Toast.Style.Animated);
      expect(mockToast.title).toBe(titles.loading);
      expect(mockToast.message).toBeUndefined();
      expect(mockToast.primaryAction).toBeUndefined();
      expect(mockToast.secondaryAction).toBeUndefined();
      expect(mockToast.show).toHaveBeenCalled();
    });

    it("returns the manager for chaining", async () => {
      const manager = new ToastManager(titles);

      await expect(manager.setToLoading()).resolves.toBe(manager);
    });
  });

  describe("setToSuccess", () => {
    it("shows a success HUD even when no progress toast exists", async () => {
      const manager = new ToastManager(titles);

      await manager.setToSuccess();

      expect(mockShowHUD).toHaveBeenCalledWith(titles.success);
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it("supports success title overrides and suffixes", async () => {
      const manager = new ToastManager(titles);

      await manager.setToSuccess({ titleOverride: "Custom success title", titleSuffix: "Device 1" });

      expect(mockShowHUD).toHaveBeenCalledWith("Custom success title - Device 1");
    });

    it("hides the progress toast before showing the success HUD", async () => {
      const mockToast = makeMockToast();
      mockShowToast.mockResolvedValueOnce(mockToast as unknown as Toast);
      const manager = new ToastManager(titles);
      await manager.setToLoading();

      await manager.setToSuccess();

      expect(mockToast.hide).toHaveBeenCalled();
      expect(mockShowHUD).toHaveBeenCalledWith(titles.success);
      expect(vi.mocked(mockToast.hide).mock.invocationCallOrder[0]).toBeLessThan(
        mockShowHUD.mock.invocationCallOrder[0],
      );
    });

    it("returns the manager for chaining", async () => {
      const manager = new ToastManager(titles);

      await expect(manager.setToSuccess()).resolves.toBe(manager);
    });
  });

  describe("setToFailure", () => {
    it("shows a copyable fallback message when no error is provided", async () => {
      const manager = new ToastManager(titles);

      await manager.setToFailure();

      expect(mockShowToast).toHaveBeenCalledWith({
        style: Toast.Style.Failure,
        title: titles.failure,
        message: "An unexpected error occurred.",
        primaryAction: expect.objectContaining({
          title: "Copy Error",
          shortcut: Keyboard.Shortcut.Common.Copy,
        }),
      });
    });

    it("displays and copies the exact error message", async () => {
      const manager = new ToastManager(titles);
      const error = new Error("Connection failed");

      await manager.setToFailure({ error });

      const options = mockShowToast.mock.calls[0][0] as unknown as Toast.Options;
      expect(options.message).toBe(error.message);
      await options.primaryAction?.onAction(makeMockToast() as unknown as Toast);
      expect(mockClipboardCopy).toHaveBeenCalledWith(error.message);
      expect(mockCloseMainWindow).not.toHaveBeenCalled();
      expect(mockShowHUD).not.toHaveBeenCalled();
    });

    it("uses a provided failure action and keeps copy error as the secondary action", async () => {
      const manager = new ToastManager(titles);
      const action = { title: "Open Command Preferences", onAction: vi.fn() };

      await manager.setToFailure({ error: new Error("Invalid cycle preferences"), action });

      const options = mockShowToast.mock.calls[0][0] as unknown as Toast.Options;
      expect(options.primaryAction).toBe(action);
      expect(options.secondaryAction).toEqual(
        expect.objectContaining({ title: "Copy Error", shortcut: Keyboard.Shortcut.Common.Copy }),
      );
      await options.secondaryAction?.onAction?.(makeMockToast() as unknown as Toast);
      expect(mockClipboardCopy).toHaveBeenCalledWith("Invalid cycle preferences");
    });

    it("updates an existing progress toast with a custom action and copy secondary", async () => {
      const mockToast = makeMockToast();
      const action = { title: "Open Command Preferences", onAction: vi.fn() };
      mockShowToast.mockResolvedValueOnce(mockToast as unknown as Toast);
      const manager = new ToastManager(titles);
      await manager.setToLoading();

      await manager.setToFailure({ error: new Error("Invalid cycle preferences"), action });

      expect(mockToast.primaryAction).toBe(action);
      expect(mockToast.secondaryAction).toEqual(
        expect.objectContaining({ title: "Copy Error", shortcut: Keyboard.Shortcut.Common.Copy }),
      );
      await mockToast.secondaryAction?.onAction?.(makeMockToast() as unknown as Toast);
      expect(mockClipboardCopy).toHaveBeenCalledWith("Invalid cycle preferences");
    });

    it("updates the progress toast in place and keeps it visible", async () => {
      const mockToast = makeMockToast();
      mockShowToast.mockResolvedValueOnce(mockToast as unknown as Toast);
      const manager = new ToastManager(titles);
      await manager.setToLoading();
      vi.clearAllMocks();

      await manager.setToFailure({ titleOverride: "AirPods not connected", error: new Error("Connect them") });

      expect(mockShowToast).not.toHaveBeenCalled();
      expect(mockToast.style).toBe(Toast.Style.Failure);
      expect(mockToast.title).toBe("AirPods not connected");
      expect(mockToast.message).toBe("Connect them");
      expect(mockToast.primaryAction).toEqual(
        expect.objectContaining({ title: "Copy Error", shortcut: Keyboard.Shortcut.Common.Copy }),
      );
      expect(mockToast.show).toHaveBeenCalled();
      expect(mockToast.hide).not.toHaveBeenCalled();
      expect(mockShowHUD).not.toHaveBeenCalled();
    });

    it("uses a non-empty thrown string as the error message", async () => {
      const manager = new ToastManager(titles);

      await manager.setToFailure({ error: "  CLI failed  " });

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "CLI failed",
        }),
      );
    });

    it("supports a failure title suffix", async () => {
      const manager = new ToastManager(titles);

      await manager.setToFailure({ titleSuffix: "Device 1", error: new Error("Failed") });

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: `${titles.failure} - Device 1`,
        }),
      );
    });

    it("returns the manager for chaining", async () => {
      const manager = new ToastManager(titles);

      await expect(manager.setToFailure()).resolves.toBe(manager);
    });
  });

  describe("hide", () => {
    it("hides an existing toast", async () => {
      const mockToast = makeMockToast();
      mockShowToast.mockResolvedValueOnce(mockToast as unknown as Toast);
      const manager = new ToastManager(titles);
      await manager.setToLoading();

      await manager.hide();

      expect(mockToast.hide).toHaveBeenCalled();
    });

    it("does nothing when no toast exists", async () => {
      const manager = new ToastManager(titles);

      await expect(manager.hide()).resolves.not.toThrow();
    });

    it("creates a new toast after hiding the previous one", async () => {
      const mockToast = makeMockToast();
      mockShowToast.mockResolvedValueOnce(mockToast as unknown as Toast);
      const manager = new ToastManager(titles);
      await manager.setToLoading();
      await manager.hide();
      vi.clearAllMocks();

      await manager.setToLoading();

      expect(mockShowToast).toHaveBeenCalled();
    });
  });
});
