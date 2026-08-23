import { vi } from "vitest";

export const Icon = new Proxy(
  {},
  {
    get: (_target, prop) => String(prop),
  },
) as Record<string, string>;

export const Color = {
  PrimaryText: "raycast-primary-text",
  SecondaryText: "raycast-secondary-text",
  Yellow: "raycast-yellow",
  Red: "raycast-red",
} as const;

export const LaunchType = {
  UserInitiated: "userInitiated",
  Background: "background",
} as const;

export const Toast = {
  Style: {
    Animated: "animated",
    Success: "success",
    Failure: "failure",
  },
} as const;

export const launchCommand = vi.fn(async () => undefined);
export const showToast = vi.fn(async () => undefined);
export const updateCommandMetadata = vi.fn(async () => undefined);

export const environment = {
  appearance: "light",
  isDevelopment: false,
} as const;

export const Keyboard = {
  Shortcut: {
    Common: {
      Copy: { modifiers: ["cmd", "shift"], key: "c" },
      Open: { modifiers: ["cmd"], key: "o" },
      OpenWith: { modifiers: ["cmd", "shift"], key: "o" },
    },
  },
} as const;

export function getPreferenceValues<T extends Record<string, unknown>>(): T {
  return {
    hidePersonalInfo: false,
    disableKeychainAccess: false,
  } as T;
}

const cacheStore = new Map<string, string>();

export class Cache {
  private namespace?: string;

  constructor(options?: { namespace?: string }) {
    this.namespace = options?.namespace;
  }

  get(key: string): string | undefined {
    return cacheStore.get(this.buildKey(key));
  }

  set(key: string, data: string): void {
    cacheStore.set(this.buildKey(key), data);
  }

  remove(key: string): boolean {
    return cacheStore.delete(this.buildKey(key));
  }

  clear(): void {
    cacheStore.clear();
  }

  private buildKey(key: string): string {
    return this.namespace ? `${this.namespace}:${key}` : key;
  }
}
