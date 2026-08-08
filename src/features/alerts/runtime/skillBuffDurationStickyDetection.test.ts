import { describe, expect, it } from "vitest";
import {
  createSkillBuffDurationStickyState,
  updateSkillBuffDurationStickyFrameResult,
} from "./skillBuffDurationStickyDetection";
import type { SkillBuffDurationFrameResult } from "./skillFrameProcessor";

describe("skillBuffDurationStickyDetection", () => {
  it("keeps a recently detected icon as checking when one sample misses it", () => {
    const state = createSkillBuffDurationStickyState();

    const detected = updateSkillBuffDurationStickyFrameResult(
      state,
      makeFrame({ detected: true, previewUrl: "data:image/png;base64,janus" }),
      10_000,
    );
    const missed = updateSkillBuffDurationStickyFrameResult(
      state,
      makeFrame({ detected: false, previewUrl: null }),
      11_000,
    );

    expect(detected).toMatchObject({
      previewUrl: "data:image/png;base64,janus",
      snapshot: {
        detected: true,
        displayStatus: "detected",
        displayLastSeenAt: 10_000,
      },
    });
    expect(missed).toMatchObject({
      previewUrl: "data:image/png;base64,janus",
      snapshot: {
        detected: false,
        displayStatus: "checking",
        displayLastSeenAt: 10_000,
      },
    });
  });

  it("drops the checking icon after repeated misses exceed the hold window", () => {
    const state = createSkillBuffDurationStickyState();
    updateSkillBuffDurationStickyFrameResult(
      state,
      makeFrame({ detected: true, previewUrl: "data:image/png;base64,janus" }),
      10_000,
    );
    updateSkillBuffDurationStickyFrameResult(
      state,
      makeFrame({ detected: true, previewUrl: "data:image/png;base64,janus" }),
      11_000,
    );

    const missed = updateSkillBuffDurationStickyFrameResult(
      state,
      makeFrame({ detected: false, previewUrl: null }),
      16_500,
    );

    expect(missed).toMatchObject({
      previewUrl: null,
      snapshot: {
        detected: false,
        displayStatus: "missing",
        displayLastSeenAt: null,
      },
    });
  });

  it("clears sticky state when the buff duration mode is inactive or errors", () => {
    const state = createSkillBuffDurationStickyState();
    updateSkillBuffDurationStickyFrameResult(
      state,
      makeFrame({ detected: true, previewUrl: "data:image/png;base64,janus" }),
      10_000,
    );

    expect(updateSkillBuffDurationStickyFrameResult(state, null, 11_000)).toBeNull();

    const missedAfterClear = updateSkillBuffDurationStickyFrameResult(
      state,
      makeFrame({ detected: false, previewUrl: null }),
      12_000,
    );
    expect(missedAfterClear).toMatchObject({
      previewUrl: null,
      snapshot: {
        displayStatus: "missing",
      },
    });

    updateSkillBuffDurationStickyFrameResult(
      state,
      makeFrame({ detected: true, previewUrl: "data:image/png;base64,janus" }),
      13_000,
    );
    const error = updateSkillBuffDurationStickyFrameResult(
      state,
      makeFrame({ detected: false, previewUrl: null, error: "skill-buff-duration-worker-timeout" }),
      14_000,
    );

    expect(error).toMatchObject({
      previewUrl: null,
      snapshot: {
        error: "skill-buff-duration-worker-timeout",
        displayStatus: "missing",
      },
    });
  });
});

function makeFrame({
  detected,
  error = null,
  previewUrl,
}: {
  detected: boolean;
  error?: string | null;
  previewUrl: string | null;
}): SkillBuffDurationFrameResult {
  return {
    rawPreviewUrl: "data:image/png;base64,buff-slot-quadrant",
    previewUrl,
    regionLabel: detected ? "32px · 18개 버프칸" : "18개 버프칸",
    snapshot: {
      detected,
      boxCount: 18,
      detectedCount: detected ? 1 : 0,
      score: detected ? 0.997 : null,
      margin: detected ? 0.04 : null,
      decisionReason: detected ? "matched" : null,
      performanceMs: 12.4,
      error,
      candidateIcons: [],
    },
  };
}
