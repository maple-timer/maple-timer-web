import { describe, expect, it } from "vitest";
import {
  digitsFromTimerFlowSeconds,
  formatTimerFlowSeconds,
  makePredictedTimerFlowTime,
} from "./timerFlowTimeFormatting";
import type { TimeReadResult } from "./timerTypes";

describe("timer flow time formatting", () => {
  it("formats countdown seconds for supported timer display formats", () => {
    expect(formatTimerFlowSeconds(181.4, "m:ss")).toBe("3:01");
    expect(formatTimerFlowSeconds(181.4, "mm:ss")).toBe("03:01");
    expect(formatTimerFlowSeconds(7.456, "ss.cc")).toBe("07.46");
    expect(formatTimerFlowSeconds(7.456, "s.cc")).toBe("7.46");
  });

  it("builds digits for supported timer display formats", () => {
    expect(digitsFromTimerFlowSeconds(181.4, "m:ss")).toEqual([3, 0, 1]);
    expect(digitsFromTimerFlowSeconds(181.4, "mm:ss")).toEqual([0, 3, 0, 1]);
    expect(digitsFromTimerFlowSeconds(7.456, "ss.cc")).toEqual([0, 7, 4, 6]);
    expect(digitsFromTimerFlowSeconds(7.456, "s.cc")).toEqual([7, 4, 6]);
  });

  it("creates predicted time results from the last accepted sample", () => {
    const sampleTime: TimeReadResult & { seconds: number; text: string } = {
      ok: true,
      reason: "ok",
      rect: { x: 1, y: 2, width: 30, height: 10 },
      digits: [3, 0, 1],
      digitResults: [{ ok: true, reason: "ok", mask: 1, digit: 1 }],
      seconds: 181,
      text: "3:01",
      format: "m:ss",
      selectedBy: "raw",
    };

    expect(
      makePredictedTimerFlowTime(
        {
          format: "m:ss",
          sampleTime,
          rect: { x: 3, y: 4, width: 30, height: 10 },
        },
        180,
        "flow-missing-raw",
      ),
    ).toMatchObject({
      ok: true,
      reason: "flow-missing-raw",
      rect: { x: 3, y: 4, width: 30, height: 10 },
      digits: [3, 0, 0],
      digitResults: [],
      seconds: 180,
      text: "3:00",
      format: "m:ss",
      selectedBy: "time-flow",
    });
  });
});
