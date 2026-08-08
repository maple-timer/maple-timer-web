import { describe, expect, it } from "vitest";
import { createBuffSlotEvidenceSource } from "./buffSlotFrameCapture";

describe("createBuffSlotEvidenceSource", () => {
  it("keeps older frame samples readable", () => {
    expect(
      createBuffSlotEvidenceSource({
        rawPreviewUrl: "data:image/png;base64,legacy",
        sourceSize: { width: 1366, height: 768 },
        roi: { x: 683, y: 0, width: 683, height: 384 },
      }),
    ).toEqual({
      kind: "buff-slot-top-right-quadrant-v1",
      parserInputMode: "topRightQuadrant",
      coordinateSpace: "capture-pixels",
      sourceSize: { width: 1366, height: 768 },
      roi: { x: 683, y: 0, width: 683, height: 384 },
      dataUrl: "data:image/png;base64,legacy",
    });
  });

  it("retains calibrated source geometry for exact replay provenance", () => {
    expect(
      createBuffSlotEvidenceSource({
        rawPreviewUrl: "data:image/png;base64,calibrated",
        sourceSize: { width: 1366, height: 768 },
        captureSize: { width: 1920, height: 1080 },
        coordinateSpace: "game-viewport-pixels",
        sourceRegion: { x: 277, y: 156, width: 1366, height: 768 },
        roi: { x: 683, y: 0, width: 683, height: 384 },
      }),
    ).toEqual({
      kind: "buff-slot-top-right-quadrant-v1",
      parserInputMode: "topRightQuadrant",
      coordinateSpace: "game-viewport-pixels",
      sourceSize: { width: 1366, height: 768 },
      captureSize: { width: 1920, height: 1080 },
      sourceRegion: { x: 277, y: 156, width: 1366, height: 768 },
      roi: { x: 683, y: 0, width: 683, height: 384 },
      dataUrl: "data:image/png;base64,calibrated",
    });
  });
});
