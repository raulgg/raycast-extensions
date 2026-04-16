import { beforeEach, describe, expect, it, vi } from "vitest";

const { showToastMock, toastRef, useEffectMock, useRefMock } = vi.hoisted(() => {
  return {
    showToastMock: vi.fn(),
    toastRef: { current: undefined as string | undefined },
    useEffectMock: vi.fn((effect: () => void | (() => void)) => effect()),
    useRefMock: vi.fn(() => ({ current: undefined as string | undefined })),
  };
});

vi.mock("@raycast/api", () => ({
  showToast: showToastMock,
  Toast: {
    Style: {
      Failure: "failure",
    },
  },
}));

vi.mock("react", () => ({
  useEffect: useEffectMock,
  useRef: useRefMock,
}));

import { useProviderDetailErrorToast } from "./useProviderDetailErrorToast";

describe("useProviderDetailErrorToast", () => {
  beforeEach(() => {
    showToastMock.mockReset();
    useEffectMock.mockClear();
    useRefMock.mockReset();
    toastRef.current = undefined;
    useRefMock.mockImplementation(() => toastRef);
  });

  it("uses provider usage wording in the toast title", () => {
    useProviderDetailErrorToast({
      error: new Error("Timed out while fetching usage"),
      providerId: "codex",
      providerName: "Codex",
      onRetry: vi.fn(),
    });

    expect(showToastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        style: "failure",
        title: "Failed to load Codex usage",
        message: "Timed out while fetching usage",
      }),
    );
  });

  it("shows the same failure again after a retry clears the error state", () => {
    const onRetry = vi.fn();
    const error = new Error("Timed out while fetching usage");

    useProviderDetailErrorToast({
      error,
      providerId: "codex",
      providerName: "Codex",
      onRetry,
    });

    useProviderDetailErrorToast({
      error: undefined,
      providerId: "codex",
      providerName: "Codex",
      onRetry,
    });

    useProviderDetailErrorToast({
      error,
      providerId: "codex",
      providerName: "Codex",
      onRetry,
    });

    expect(showToastMock).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate the toast while the same error state remains active", () => {
    const onRetry = vi.fn();
    const error = new Error("Timed out while fetching usage");

    useProviderDetailErrorToast({
      error,
      providerId: "codex",
      providerName: "Codex",
      onRetry,
    });

    useProviderDetailErrorToast({
      error,
      providerId: "codex",
      providerName: "Codex",
      onRetry,
    });

    expect(showToastMock).toHaveBeenCalledTimes(1);
  });
});
