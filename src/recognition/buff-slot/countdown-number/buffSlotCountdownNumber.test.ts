import { afterEach, describe, expect, it, vi } from "vitest";
import { recognizeCenterRoiOcrV4 } from "./center-roi-ocr-v4.mjs";
import { createBuffSlotCountdownNumberRecognizer } from "./buffSlotCountdownNumber";

vi.mock("./center-roi-ocr-v4.mjs", () => ({
  recognizeCenterRoiOcrV4: vi.fn(),
}));

describe("buff slot countdown number recognizer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(recognizeCenterRoiOcrV4).mockReset();
  });

  it("loads the shared model once and exposes the unchanged observation contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ version: "center-roi-ocr-v4" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(recognizeCenterRoiOcrV4).mockReturnValue({
      kind: "exact",
      text: "42",
      totalSeconds: 42,
      format: "seconds",
      textRegion: "center",
      confidence: 0.87654,
      status: "high",
      candidates: [],
      route: {
        routeClass: "s2",
        confidence: 0.74129,
        probabilities: {},
      },
    });

    const recognizer = createBuffSlotCountdownNumberRecognizer();

    expect(recognizer.getStatus()).toBe("idle");
    await expect(recognizer.preload()).resolves.toBe("ready");
    await expect(recognizer.preload()).resolves.toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(recognizer.recognizeIfReady(createIcon())).toEqual({
      kind: "exact",
      text: "42",
      totalSeconds: 42,
      format: "seconds",
      textRegion: "center",
      confidence: 0.877,
      status: "high",
      routerTarget: "s2",
      routerConfidence: 0.741,
      routerStatus: "medium",
    });
  });

  it("keeps a failed model load in the error state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const recognizer = createBuffSlotCountdownNumberRecognizer();

    await expect(recognizer.preload()).resolves.toBe("error");
    expect(recognizer.getStatus()).toBe("error");
    expect(recognizer.recognizeIfReady(createIcon())).toBeNull();
  });
});

function createIcon() {
  return {
    width: 32,
    height: 32,
    data: new Uint8ClampedArray(32 * 32 * 4),
  };
}
