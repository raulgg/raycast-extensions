import { beforeEach, describe, expect, it, vi } from "vitest";
import { setListeningMode } from "./controls/delegate-listening-mode";
import setAdaptive from "./set-adaptive";
import setNoiseCancellation from "./set-noise-cancellation";
import setOff from "./set-off";
import setTransparency from "./set-transparency";

vi.mock("./controls/delegate-listening-mode", () => ({ setListeningMode: vi.fn() }));

const mockSetListeningMode = vi.mocked(setListeningMode);

describe("fixed listening mode entrypoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetListeningMode.mockResolvedValue(undefined);
  });

  it.each([
    ["noise cancellation", setNoiseCancellation, "anc"],
    ["transparency", setTransparency, "transparency"],
    ["adaptive", setAdaptive, "adaptive"],
    ["off", setOff, "off"],
  ] as const)("dispatches the %s mode through the shared gateway", async (_label, entrypoint, mode) => {
    await entrypoint();

    expect(mockSetListeningMode).toHaveBeenCalledExactlyOnceWith(mode);
  });
});
