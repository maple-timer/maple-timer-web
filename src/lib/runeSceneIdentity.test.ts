import { describe, expect, it } from "vitest";
import {
  createRuneSceneFingerprint,
  createRuneSceneTrackerState,
  getRuneSceneFingerprintDistance,
  updateRuneSceneTracker,
} from "./runeSceneIdentity";

describe("runeSceneIdentity", () => {
  it("ignores global brightness changes", () => {
    const dark = createRuneSceneFingerprint(createPattern("vertical", 0));
    const bright = createRuneSceneFingerprint(createPattern("vertical", 45));

    expect(getRuneSceneFingerprintDistance(dark, bright)).toBeLessThan(0.02);
  });

  it("requires two stable changed frames before advancing the scene epoch", () => {
    let state = createRuneSceneTrackerState();
    let update = updateRuneSceneTracker(state, createPattern("vertical", 0), 1_000);
    state = update.state;
    expect(update.observation.sceneEpoch).toBe(0);

    update = updateRuneSceneTracker(state, createPattern("horizontal", 0), 2_000);
    state = update.state;
    expect(update.observation).toMatchObject({
      changed: false,
      sceneEpoch: 0,
      pendingStableCount: 1,
    });

    update = updateRuneSceneTracker(state, createPattern("horizontal", 2), 3_000);
    expect(update.observation).toMatchObject({
      changed: true,
      sceneEpoch: 1,
      pendingStableCount: 0,
      changedAt: 3_000,
    });
  });

  it("discards a one-frame transition when the original scene returns", () => {
    let state = updateRuneSceneTracker(
      createRuneSceneTrackerState(),
      createPattern("vertical", 0),
      1_000,
    ).state;
    state = updateRuneSceneTracker(state, createPattern("horizontal", 0), 2_000).state;
    const update = updateRuneSceneTracker(state, createPattern("vertical", 3), 3_000);

    expect(update.observation).toMatchObject({
      changed: false,
      sceneEpoch: 0,
      pendingStableCount: 0,
    });
  });

  it("reinitializes without claiming a scene change when the ROI aspect changes", () => {
    let state = updateRuneSceneTracker(
      createRuneSceneTrackerState(),
      createPattern("vertical", 0, 64, 32),
      1_000,
    ).state;
    const update = updateRuneSceneTracker(
      state,
      createPattern("horizontal", 0, 64, 64),
      2_000,
    );

    expect(update.observation).toMatchObject({ changed: false, sceneEpoch: 0 });
    expect(update.state.pendingStableCount).toBe(0);
  });
});

function createPattern(
  pattern: "vertical" | "horizontal",
  offset: number,
  width = 64,
  height = 32,
) {
  const imageData = new ImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const high = pattern === "vertical" ? x >= width / 2 : y >= height / 2;
      const value = Math.min(255, (high ? 190 : 35) + offset);
      const index = (y * width + x) * 4;
      imageData.data[index] = value;
      imageData.data[index + 1] = value;
      imageData.data[index + 2] = value;
      imageData.data[index + 3] = 255;
    }
  }
  return imageData;
}
