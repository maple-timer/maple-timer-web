import { describe, expect, it } from "vitest";
import {
  getCaptureSurface,
  shouldRecommendGameViewportSetup,
} from "./gameViewportSetupRecommendation";

function createStream(displaySurface: MediaTrackSettings["displaySurface"]): MediaStream {
  return {
    getVideoTracks: () => [
      {
        getSettings: () => ({ displaySurface }),
      },
    ],
  } as unknown as MediaStream;
}

describe("gameViewportSetupRecommendation", () => {
  it("keeps a known game window on the unchanged path", () => {
    const stream = createStream("window");

    expect(getCaptureSurface(stream)).toBe("window");
    expect(
      shouldRecommendGameViewportSetup({
        captureSize: { width: 1368, height: 800 },
        stream,
      }),
    ).toBe(false);
  });

  it("recommends setup for a full monitor even at a known resolution", () => {
    expect(
      shouldRecommendGameViewportSetup({
        captureSize: { width: 1920, height: 1080 },
        stream: createStream("monitor"),
      }),
    ).toBe(true);
  });

  it("recommends setup for a nonstandard captured window", () => {
    expect(
      shouldRecommendGameViewportSetup({
        captureSize: { width: 1766, height: 968 },
        stream: createStream("window"),
      }),
    ).toBe(true);
  });
});
