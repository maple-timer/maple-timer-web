import { describe, expect, it } from "vitest";
import type { BuffExpiryTrackedBuff } from "../../../domain/buff-expiry/precisionTrackingTypes";
import type { BuffExpiryPrecisionSampleResponse } from "../../../runtime/buff-expiry/analysis/buffExpiryPrecisionAnalysisRuntime";
import {
  createBuffExpiryPrecisionBoxes,
  createBuffExpiryPrecisionNormalizedBoxIcons,
  createBuffExpiryPrecisionPerformanceMetrics,
  getBuffExpiryPrecisionAcceptedMatchCount,
  getBuffExpiryPrecisionRuntimeStatus,
} from "./buffExpiryPrecisionSampleArtifacts";

describe("buffExpiryPrecisionSampleArtifacts", () => {
  it("maps parser boxes and icon buffers into legacy runtime artifacts", () => {
    const response = makeResponse();
    const boxes = createBuffExpiryPrecisionBoxes(response);
    const icons = createBuffExpiryPrecisionNormalizedBoxIcons({ response, boxes });

    expect(boxes).toEqual([
      {
        x: 100,
        y: 40,
        width: 32,
        height: 32,
        confidence: 0.93,
        side: 32,
        row: 0,
        col: 2,
      },
    ]);
    expect(icons).toHaveLength(1);
    expect(icons[0].box).toBe(boxes[0]);
    expect(icons[0].imageData).toMatchObject({
      width: 32,
      height: 32,
    });
    expect(icons[0].imageData.data).toEqual(new Uint8ClampedArray([1, 2, 3, 4]));
    expect(icons[0].imageData.data).not.toBe(response.icons[0].data);
  });

  it("can create normalized box icons for selected parser indexes only", () => {
    const response = makeResponse({
      boxes: [
        { x: 100, y: 40, size: 32, row: 0, col: 2, confidence: 0.93, score: 0.88 },
        { x: 140, y: 40, size: 32, row: 0, col: 3, confidence: 0.91, score: 0.84 },
        { x: 180, y: 40, size: 32, row: 0, col: 4, confidence: 0.9, score: 0.82 },
      ],
      icons: [
        { width: 1, height: 1, data: new Uint8ClampedArray([1, 1, 1, 255]) },
        { width: 1, height: 1, data: new Uint8ClampedArray([2, 2, 2, 255]) },
        { width: 1, height: 1, data: new Uint8ClampedArray([3, 3, 3, 255]) },
      ],
    });
    const boxes = createBuffExpiryPrecisionBoxes(response);
    const icons = createBuffExpiryPrecisionNormalizedBoxIcons({
      response,
      boxes,
      boxIndexes: [2, 1, 2, 99],
    });

    expect(icons).toHaveLength(2);
    expect(icons.map((icon) => icon.box.x)).toEqual([140, 180]);
    expect(icons.map((icon) => [...icon.imageData.data])).toEqual([
      [2, 2, 2, 255],
      [3, 3, 3, 255],
    ]);
  });

  it("counts only target observations as accepted matches", () => {
    const response = makeResponse({
      iconObservations: [
        makeObservation("target"),
        makeObservation("excluded"),
        makeObservation("unknown"),
      ],
    });

    expect(getBuffExpiryPrecisionAcceptedMatchCount(response)).toBe(1);
  });

  it("normalizes precision engine performance into the shared buff expiry metric shape", () => {
    const response = makeResponse({
      performance: {
        totalMs: 12.5,
        detectMs: 3.1,
        matchMs: 4.2,
        countdownMs: 5.2,
        countdownCount: 2,
        countdownModelStatus: "ready",
        boxCount: 7,
      },
    });

    expect(createBuffExpiryPrecisionPerformanceMetrics({
      response,
      acceptedMatchCount: 3,
    })).toEqual({
      totalMs: 12.5,
      detectMs: 3.1,
      normalizeAndMatchMs: 4.2,
      countdownMs: 5.2,
      countdownCount: 2,
      countdownModelStatus: "ready",
      boxCount: 7,
      acceptedMatchCount: 3,
      activeSampleCount: 0,
    });
  });

  it("derives precision engine runtime status from alerted tracks, tracked candidates, and parser boxes", () => {
    const track = makeTrack({ alertedAt: null });

    expect(getBuffExpiryPrecisionRuntimeStatus({
      tracks: [makeTrack({ alertedAt: 10_000 })],
      pendingTracks: [],
      boxCount: 1,
    })).toBe("alerted");
    expect(getBuffExpiryPrecisionRuntimeStatus({
      tracks: [track],
      pendingTracks: [],
      boxCount: 0,
    })).toBe("tracking");
    expect(getBuffExpiryPrecisionRuntimeStatus({
      tracks: [],
      pendingTracks: [{
        id: track.id,
        buffId: track.buffId,
        name: track.name,
        box: track.box,
        firstSeenAt: track.detectedAt,
        lastSeenAt: track.lastSeenAt,
        observations: [],
        score: track.score,
      }],
      boxCount: 0,
    })).toBe("tracking");
    expect(getBuffExpiryPrecisionRuntimeStatus({
      tracks: [],
      pendingTracks: [],
      boxCount: 1,
    })).toBe("tracking");
    expect(getBuffExpiryPrecisionRuntimeStatus({
      tracks: [],
      pendingTracks: [],
      boxCount: 0,
    })).toBe("waiting");
  });
});

function makeResponse(
  overrides: Partial<BuffExpiryPrecisionSampleResponse> = {},
): BuffExpiryPrecisionSampleResponse {
  return {
    boxes: [
      {
        x: 100,
        y: 40,
        size: 32,
        row: 0,
        col: 2,
        confidence: 0.93,
        score: 0.88,
      },
    ],
    icons: [
      {
        width: 32,
        height: 32,
        data: new Uint8ClampedArray([1, 2, 3, 4]),
      },
    ],
    iconObservations: [makeObservation("target")],
    bestByGroup: [],
    moduleVersions: {
      runtime: "runtime-test",
      parser: "parser-test",
      matcher: "matcher-test",
      matcherModel: "matcher-model-test",
      countdown: "countdown-test",
    },
    unsupported: false,
    unsupportedReason: null,
    performance: {
      totalMs: 1,
      detectMs: 1,
      boxCount: 1,
    },
    ...overrides,
  };
}

function makeObservation(kind: "target" | "excluded" | "unknown"): BuffExpiryPrecisionSampleResponse["iconObservations"][number] {
  return {
    id: `${kind}-0`,
    boxIndex: 0,
    box: {
      x: 100,
      y: 40,
      size: 32,
      row: 0,
      col: 2,
      confidence: 0.93,
      score: 0.88,
    },
    identity: {
      kind,
      group: kind === "target" ? "unionWealth" : null,
      score: kind === "target" ? 2.4 : -0.2,
      margin: 1.1,
      decisionReason: kind,
      bestTargetName: kind === "target" ? "유니온의 부" : null,
      bestExcludedName: kind === "excluded" ? "VIP" : null,
    },
    countdown: null,
  };
}

function makeTrack(overrides: Partial<BuffExpiryTrackedBuff> = {}): BuffExpiryTrackedBuff {
  return {
    id: "track-1",
    buffId: "next:unionWealth",
    name: "유니온의 부",
    box: {
      x: 100,
      y: 40,
      width: 32,
      height: 32,
      confidence: 0.93,
    },
    detectedSeconds: 40,
    detectedAt: 1_000,
    expiresAt: 41_000,
    lastSeenAt: 1_000,
    alertedAt: null,
    score: 2.4,
    ...overrides,
  };
}
