import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseBuffSlots } from "../../../recognition/buff-slot/parser/parseBuffSlots";
import { BuffSlotAnalysisProcessor } from "./buffSlotAnalysisProcessor";

vi.mock("../../../recognition/buff-slot/parser/parseBuffSlots", () => ({
  parseBuffSlots: vi.fn(),
}));

const parseBuffSlotsMock = vi.mocked(parseBuffSlots);

describe("BuffSlotAnalysisProcessor", () => {
  beforeEach(() => {
    parseBuffSlotsMock.mockReset();
    parseBuffSlotsMock.mockResolvedValue({
      icons: [],
      boxes: [],
      engine: "dl",
      parserVersion: "test-dl-parser",
    });
  });

  it("returns shared buff slot analysis for a blank frame", async () => {
    const now = createClock([10, 11.2, 13.7, 15]);
    const processor = new BuffSlotAnalysisProcessor(now);
    const response = await processor.process({
      imageData: makeBlankFrameImageData(128, 96),
      sampledAt: 14_000,
      buffSlotInputMode: "croppedRoi",
      runtimeSelection: {
        executionProvider: "wasm",
        selectionSource: "benchmark",
      },
    });

    expect(response).toMatchObject({
      sampledAt: 14_000,
      unsupported: false,
      unsupportedReason: null,
      analysis: {
        icons: [],
        boxes: [],
        engine: expect.any(String),
        parserVersion: expect.any(String),
      },
      performance: {
        totalMs: 5,
        detectMs: 2.5,
        boxCount: 0,
      },
    });
    expect(parseBuffSlotsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        engine: "dl",
        fallbackToRule: false,
        outputSize: 32,
        inputMode: "croppedRoi",
        runtimeSelection: {
          executionProvider: "wasm",
          selectionSource: "benchmark",
        },
      }),
    );
  });
});

function createClock(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function makeBlankFrameImageData(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 20;
    data[offset + 1] = 20;
    data[offset + 2] = 20;
    data[offset + 3] = 255;
  }
  return { width, height, data } as ImageData;
}
