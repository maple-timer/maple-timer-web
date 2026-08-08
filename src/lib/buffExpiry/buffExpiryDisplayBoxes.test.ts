import { describe, expect, it } from "vitest";
import type { BuffExpiryBox } from "./buffExpiryTypes";
import { stabilizeBuffExpiryDisplayBoxes } from "./buffExpiryDisplayBoxes";

const BOX: BuffExpiryBox = {
  x: 100,
  y: 40,
  width: 32,
  height: 32,
  confidence: 0.95,
};

describe("buffExpiryDisplayBoxes", () => {
  it("displays a current-frame detection immediately", () => {
    const first = stabilizeBuffExpiryDisplayBoxes({
      previousTracks: [],
      boxes: [BOX],
      now: 0,
    });
    expect(first.displayBoxes).toEqual([BOX]);
  });

  it("updates the displayed box on each one-second sample", () => {
    const first = stabilizeBuffExpiryDisplayBoxes({
      previousTracks: [],
      boxes: [BOX],
      now: 0,
    });
    const second = stabilizeBuffExpiryDisplayBoxes({
      previousTracks: first.tracks,
      boxes: [{ ...BOX, x: BOX.x + 1 }],
      now: 1_000,
    });

    expect(second.displayBoxes).toHaveLength(1);
    expect(second.displayBoxes[0].x).toBe(BOX.x + 1);
  });

  it("removes the displayed box on the next missed one-second sample", () => {
    const first = stabilizeBuffExpiryDisplayBoxes({
      previousTracks: [],
      boxes: [BOX],
      now: 0,
    });
    const second = stabilizeBuffExpiryDisplayBoxes({
      previousTracks: first.tracks,
      boxes: [],
      now: 1_000,
    });

    expect(second.displayBoxes).toHaveLength(0);
  });

  it("displays intermittent detections only while they are present", () => {
    const first = stabilizeBuffExpiryDisplayBoxes({
      previousTracks: [],
      boxes: [BOX],
      now: 0,
    });
    const missed = stabilizeBuffExpiryDisplayBoxes({
      previousTracks: first.tracks,
      boxes: [],
      now: 1_000,
    });
    const intermittent = stabilizeBuffExpiryDisplayBoxes({
      previousTracks: missed.tracks,
      boxes: [BOX],
      now: 2_000,
    });

    expect(first.displayBoxes).toHaveLength(1);
    expect(missed.displayBoxes).toHaveLength(0);
    expect(intermittent.displayBoxes).toHaveLength(1);
  });
});
