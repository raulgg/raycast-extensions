export const Icon = new Proxy(
  {},
  {
    get: (_target, prop) => String(prop),
  },
) as Record<string, string>;

export const Color = {
  PrimaryText: "raycast-primary-text",
} as const;

export const environment = {
  appearance: "light",
  isDevelopment: false,
} as const;
