import { describe, expect, it } from "vitest";
import { captureFullFramePreview } from "./huntStallOcrSampling";

describe("huntStallOcrSampling", () => {
  it("skips full-frame preview capture when disabled", () => {
    const result = captureFullFramePreview({} as CanvasImageSource, 1920, 1080, false);

    expect(result).toEqual({ url: null, ms: null });
  });
});
