import { describe, expect, it } from "vitest";
import { getRuneDetectionEpisodeId } from "./runeEpisodeIdentity";

describe("getRuneDetectionEpisodeId", () => {
  it("binds an episode to its scene and first detected frame", () => {
    expect(
      getRuneDetectionEpisodeId({ sceneEpoch: 3, firstDetectedAt: 12_345 }),
    ).toBe("rune-episode:3:12345");
  });

  it("separates the same minimap position after a scene change", () => {
    expect(
      getRuneDetectionEpisodeId({ sceneEpoch: 4, firstDetectedAt: 12_345 }),
    ).not.toBe(
      getRuneDetectionEpisodeId({ sceneEpoch: 5, firstDetectedAt: 12_345 }),
    );
  });

  it("returns null outside an active detection episode", () => {
    expect(getRuneDetectionEpisodeId({ sceneEpoch: 1, firstDetectedAt: null })).toBeNull();
  });
});
