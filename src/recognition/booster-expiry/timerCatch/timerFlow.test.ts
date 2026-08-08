import { describe, expect, it } from "vitest";
import {
  __timerCatchFlowTestHooks,
  type Rect,
  type TimeReadResult,
} from "./timer";

function makeTime(
  seconds: number,
  text: string,
  format: NonNullable<TimeReadResult["format"]>,
  digitDefaults: Partial<TimeReadResult["digitResults"][number]> = {},
): TimeReadResult {
  return {
    ok: true,
    reason: "ok",
    rect: { x: 540, y: 88, width: 185, height: 44 },
    digits: text.replace(/\D/g, "").split("").map(Number),
    digitResults: text
      .replace(/\D/g, "")
      .split("")
      .map((digit) => ({
        ok: true,
        reason: "ok",
        mask: Number(digit),
        digit: Number(digit),
        ...digitDefaults,
      })),
    seconds,
    text,
    format,
    selectedBy: "test",
  };
}

const rect: Rect = { x: 540, y: 88, width: 185, height: 44 };

describe("timerCatch flow", () => {
  it("locks after consecutive plausible raw observations", () => {
    const state = __timerCatchFlowTestHooks.makeTimerFlowState();
    const options = {
      frameIntervalMs: 1000,
      lockToleranceSeconds: 1.5,
      minLockObservations: 2,
    };

    const first = __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      makeTime(181, "3:01", "m:ss"),
      rect,
      options,
      0,
    );
    const second = __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      makeTime(180, "3:00", "m:ss"),
      rect,
      options,
      1_000,
    );

    expect(first.source).toBe("raw-pending");
    expect(first.locked).toBe(false);
    expect(second.source).toBe("raw-lock");
    expect(second.locked).toBe(true);
    expect(second.time?.text).toBe("3:00");
  });

  it("holds predictions while raw reads are missing within max hold time", () => {
    const state = __timerCatchFlowTestHooks.makeTimerFlowState();
    const options = {
      frameIntervalMs: 1000,
      lockToleranceSeconds: 1.5,
      maxHoldSeconds: 3,
      minLockObservations: 2,
    };

    __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      makeTime(181, "3:01", "m:ss"),
      rect,
      options,
      0,
    );
    __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      makeTime(180, "3:00", "m:ss"),
      rect,
      options,
      1_000,
    );

    const held = __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      null,
      null,
      options,
      3_000,
    );
    const expired = __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      null,
      null,
      options,
      5_000,
    );

    expect(held.source).toBe("predicted-missing-raw");
    expect(held.locked).toBe(true);
    expect(held.time?.text).toBe("2:58");
    expect(expired.source).toBe("none");
    expect(expired.time).toBeNull();
  });

  it("keeps prediction when a weak decimal raw read drifts slightly downward", () => {
    const state = __timerCatchFlowTestHooks.makeTimerFlowState();
    const options = {
      frameIntervalMs: 1000,
      maxJumpSeconds: 1.25,
      lockToleranceSeconds: 1.5,
      minLockObservations: 2,
    };

    __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      makeTime(10, "10.00", "ss.cc"),
      rect,
      options,
      0,
    );
    __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      makeTime(9, "09.00", "ss.cc"),
      rect,
      options,
      1_000,
    );

    const weak = __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      makeTime(7.6, "07.60", "ss.cc", {
        selectedBy: "fuzzy",
        scoreMargin: -0.5,
        confidence: 5,
      }),
      rect,
      options,
      2_000,
    );

    expect(weak.source).toBe("predicted-weak-raw");
    expect(weak.rawDeltaSeconds).toBeCloseTo(-0.4);
    expect(weak.time?.text).toBe("08.00");
  });

  it("relocks to a stable raw countdown after a stale long prediction rejected the raw timer", () => {
    const state = __timerCatchFlowTestHooks.makeTimerFlowState();
    const options = {
      frameIntervalMs: 1000,
      maxJumpSeconds: 1.25,
      lockToleranceSeconds: 1.5,
      maxHoldSeconds: 12,
      minLockObservations: 2,
      resetJumpSeconds: 5,
    };

    const first = __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      makeTime(1278, "21:18", "mm:ss"),
      rect,
      options,
      0,
    );
    const second = __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      makeTime(1277, "21:17", "mm:ss"),
      rect,
      options,
      1_000,
    );

    expect(first.source).toBe("raw-pending");
    expect(second.source).toBe("raw-lock");

    const rejected = __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      makeTime(97.66, "97.66", "ss.cc"),
      rect,
      options,
      10_000,
    );
    const relocked = __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      makeTime(96.67, "96.67", "ss.cc"),
      rect,
      options,
      11_000,
    );

    expect(rejected.source).toBe("predicted-rejected-raw");
    expect(rejected.time?.text).toBe("21:08");
    expect(relocked.source).toBe("raw-relock");
    expect(relocked.time?.text).toBe("96.67");

    const supported = __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      makeTime(95.65, "95.65", "ss.cc"),
      rect,
      options,
      12_000,
    );

    expect(supported.source).toBe("raw");
    expect(supported.time?.text).toBe("95.65");
  });

  it("does not relock from a single low contradictory raw blip", () => {
    const state = __timerCatchFlowTestHooks.makeTimerFlowState();
    const options = {
      frameIntervalMs: 1000,
      maxJumpSeconds: 1.25,
      lockToleranceSeconds: 1.5,
      maxHoldSeconds: 12,
      minLockObservations: 2,
      resetJumpSeconds: 5,
    };

    __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      makeTime(100, "1:40", "m:ss"),
      rect,
      options,
      0,
    );
    __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      makeTime(99, "1:39", "m:ss"),
      rect,
      options,
      1_000,
    );

    const rejected = __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      makeTime(33, "33.00", "ss.cc"),
      rect,
      options,
      2_000,
    );
    const recovered = __timerCatchFlowTestHooks.updateTimerFlowState(
      state,
      makeTime(97, "1:37", "m:ss"),
      rect,
      options,
      3_000,
    );

    expect(rejected.source).toBe("predicted-rejected-raw");
    expect(recovered.source).toBe("raw");
    expect(recovered.time?.text).toBe("1:37");
  });
});
