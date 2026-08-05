import { vi, type Mock } from "vitest";
import type { Application, LocalStorage as LocalStorageType, Toast as ToastType, PreferenceValues } from "@raycast/api";

export const Toast = {
  Style: {
    Success: "SUCCESS",
    Failure: "FAILURE",
    Animated: "ANIMATED",
  } as const satisfies Record<keyof typeof ToastType.Style, string>,
};

export const openExtensionPreferences: Mock<() => Promise<void>> = vi.fn(async () => {});

export const LaunchType = {
  UserInitiated: "userInitiated",
  Background: "background",
} as const;

export const Keyboard = {
  Shortcut: {
    Common: {
      Copy: { modifiers: ["cmd"], key: "c" },
    },
  },
} as const;

export const Clipboard = {
  copy: vi.fn(async () => {}),
};

export const launchCommand: Mock<
  (options: { name: string; type: string; context?: Record<string, unknown> | null }) => Promise<void>
> = vi.fn(async () => {});

export const updateCommandMetadata: Mock<(metadata: { subtitle?: string | null }) => Promise<void>> = vi.fn(
  async () => {},
);

export const getFrontmostApplication: Mock<() => Promise<Application>> = vi.fn(async () => ({
  name: "",
  path: "",
  bundleId: "",
}));

export const open: Mock<(target: string, application?: Application | string) => Promise<void>> = vi.fn(async () => {});

export const showToast: Mock<(options: ToastType.Options) => Promise<ToastType>> = vi.fn(async (options) => ({
  style: options.style,
  title: options.title,
  message: options.message,
  primaryAction: options.primaryAction,
  secondaryAction: options.secondaryAction,
  hide: vi.fn(),
  show: vi.fn(),
  id: "",
  options,
  callbacks: {},
})) as unknown as Mock<(options: ToastType.Options) => Promise<ToastType>>;

export const showHUD: Mock<(title: string) => Promise<void>> = vi.fn(async () => {});

export const closeMainWindow: Mock<
  (options?: { clearRootSearch?: boolean; popToRootType?: unknown }) => Promise<void>
> = vi.fn(async () => {});

export const LocalStorage: {
  getItem: Mock<typeof LocalStorageType.getItem>;
  setItem: Mock<typeof LocalStorageType.setItem>;
  removeItem: Mock<typeof LocalStorageType.removeItem>;
  clear: Mock<typeof LocalStorageType.clear>;
} = {
  getItem: vi.fn(async () => undefined),
  setItem: vi.fn(async () => {}),
  removeItem: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
};

export const getPreferenceValues: Mock<<Values extends PreferenceValues = PreferenceValues>() => Values> = vi.fn(
  () => ({}) as never,
);
