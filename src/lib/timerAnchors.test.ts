import { describe, expect, it } from "vitest";
import { createRuntimeState } from "./timer";
import {
  updateShortAnchorCandidate,
  updateStableAnchorCandidate,
} from "./timerAnchors";

const anchorConfig = {
  alertThresholdSeconds: 5,
  countdownSource: "duration" as const,
  durationSeconds: 60,
  cooldownDurationSeconds: undefined,
};

describe("timer anchor helpers", () => {
  it("promotes repeated short readings into a ready anchor", () => {
    const first = updateShortAnchorCandidate(
      createRuntimeState("skill-anchor"),
      20,
      anchorConfig,
      1_000,
    );
    const second = updateShortAnchorCandidate(
      { ...createRuntimeState("skill-anchor"), pendingShortAnchor: first.pendingShortAnchor },
      20,
      anchorConfig,
      1_450,
    );
    const third = updateShortAnchorCandidate(
      { ...createRuntimeState("skill-anchor"), pendingShortAnchor: second.pendingShortAnchor },
      19,
      anchorConfig,
      1_900,
    );

    expect(first).toMatchObject({ ready: false, pendingShortAnchor: { count: 1 } });
    expect(second).toMatchObject({ ready: false, pendingShortAnchor: { count: 2 } });
    expect(third).toMatchObject({
      ready: true,
      pendingShortAnchor: {
        observedRemainingSeconds: 19,
        maxObservedRemainingSeconds: 20,
        count: 3,
      },
    });
  });

  it("restarts anchoring when the next stable reading jumps too far", () => {
    const first = updateStableAnchorCandidate(createRuntimeState("skill-anchor"), 56, 1_000);
    const jumped = updateStableAnchorCandidate(
      { ...createRuntimeState("skill-anchor"), pendingShortAnchor: first.pendingShortAnchor },
      40,
      1_450,
    );

    expect(jumped).toMatchObject({
      ready: false,
      pendingShortAnchor: {
        observedRemainingSeconds: 40,
        maxObservedRemainingSeconds: 40,
        count: 1,
      },
    });
  });
});
