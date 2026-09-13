import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmedConversationAwareness,
  confirmedListeningMode,
  cycleListeningMode,
  getConversationAwareness,
  getListeningMode,
  setConversationAwareness,
  setListeningMode,
} from "./airpods-control-cli";
import { CliError, runCli } from "./cli";
import type * as CliModule from "./cli";

vi.mock("./cli", async (importOriginal) => {
  const actual = await importOriginal<typeof CliModule>();
  return { ...actual, runCli: vi.fn() };
});

const mockRunCli = vi.mocked(runCli);

describe("airpods-control CLI shim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["off", "off"],
    ["transparency", "transparency"],
    ["adaptive", "adaptive"],
    ["anc", "noise-cancellation"],
  ] as const)("sets %s using the canonical CLI token", async (mode, token) => {
    mockRunCli.mockResolvedValue({ result: "ok", device: "AirPods", listeningMode: token });

    await expect(setListeningMode(mode)).resolves.toBe(mode);

    expect(mockRunCli).toHaveBeenCalledWith(["listening-mode", "set", token]);
  });

  it("treats a no-op with the requested confirmed mode as success", async () => {
    mockRunCli.mockRejectedValue(
      new CliError("no-op", { result: "error", device: "AirPods", listeningMode: "noise-cancellation" }),
    );

    await expect(setListeningMode("anc")).resolves.toBe("anc");
  });

  it("rejects a successful set response that confirms a different mode", async () => {
    mockRunCli.mockResolvedValue({ result: "ok", device: "AirPods", listeningMode: "transparency" });

    await expect(setListeningMode("anc")).rejects.toMatchObject({
      code: "no-op",
      payload: expect.objectContaining({ listeningMode: "transparency" }),
    });
  });

  it("cycles a selected set in CLI order supplied by the workflow", async () => {
    mockRunCli.mockResolvedValue({ result: "ok", device: "AirPods", listeningMode: "adaptive" });

    await expect(cycleListeningMode(["off", "adaptive", "anc"])).resolves.toBe("adaptive");

    expect(mockRunCli).toHaveBeenCalledWith(["listening-mode", "cycle", "--modes", "off,adaptive,noise-cancellation"]);
  });

  it("uses a bare CLI cycle when no selected set is supplied", async () => {
    mockRunCli.mockResolvedValue({ result: "ok", device: "AirPods", listeningMode: "off" });

    await cycleListeningMode();

    expect(mockRunCli).toHaveBeenCalledWith(["listening-mode", "cycle"]);
  });

  it("gets and maps the current listening mode", async () => {
    mockRunCli.mockResolvedValue({ result: "ok", device: "AirPods", listeningMode: "noise-cancellation" });

    await expect(getListeningMode()).resolves.toBe("anc");
  });

  it.each([null, "", "future-mode", "toString", "constructor", "__proto__"])(
    "rejects invalid listening mode %s",
    async (listeningMode) => {
      mockRunCli.mockResolvedValue({ result: "ok", device: "AirPods", listeningMode });

      await expect(getListeningMode()).rejects.toMatchObject({ code: "invalid-response" });
    },
  );

  it("gets Conversation Awareness", async () => {
    mockRunCli.mockResolvedValue({ result: "ok", device: "AirPods", conversationAwareness: "on" });

    await expect(getConversationAwareness()).resolves.toBe("on");
    expect(mockRunCli).toHaveBeenCalledWith(["conversation-awareness", "get"]);
  });

  it("treats unavailable Conversation Awareness as unsupported", async () => {
    mockRunCli.mockResolvedValue({ result: "ok", device: "Other Headphones", conversationAwareness: null });

    await expect(getConversationAwareness()).rejects.toMatchObject({ code: "unsupported" });
  });

  it("rejects a response that omits Conversation Awareness state", async () => {
    mockRunCli.mockResolvedValue({ result: "ok", device: "AirPods" });

    await expect(getConversationAwareness()).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("rejects an unknown Conversation Awareness state", async () => {
    mockRunCli.mockResolvedValue({ result: "ok", device: "AirPods", conversationAwareness: "automatic" });

    await expect(getConversationAwareness()).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("sets and confirms Conversation Awareness", async () => {
    mockRunCli.mockResolvedValue({ result: "ok", device: "AirPods", conversationAwareness: "off" });

    await expect(setConversationAwareness("off")).resolves.toBe("off");
    expect(mockRunCli).toHaveBeenCalledWith(["conversation-awareness", "set", "off"]);
  });

  it("treats a confirmed Conversation Awareness no-op as success", async () => {
    mockRunCli.mockRejectedValue(
      new CliError("no-op", { result: "error", device: "AirPods", conversationAwareness: "on" }),
    );

    await expect(setConversationAwareness("on")).resolves.toBe("on");
  });

  it("rejects unknown Conversation Awareness state", async () => {
    mockRunCli.mockResolvedValue({ result: "ok", device: "AirPods", conversationAwareness: "automatic" });

    await expect(setConversationAwareness("on")).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("extracts confirmed state only from known payload values", () => {
    expect(confirmedListeningMode({ result: "error", device: "AirPods", listeningMode: "transparency" })).toBe(
      "transparency",
    );
    expect(confirmedListeningMode({ result: "error", device: "AirPods", listeningMode: "future-mode" })).toBeNull();
    expect(confirmedConversationAwareness({ result: "error", device: "AirPods", conversationAwareness: "off" })).toBe(
      "off",
    );
    expect(
      confirmedConversationAwareness({ result: "error", device: "AirPods", conversationAwareness: "automatic" }),
    ).toBeNull();
  });
});
