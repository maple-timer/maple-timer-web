import { describe, expect, it } from "vitest";
import type {
  RuneAlertTriggerEvidence,
  RuneAlertTriggerFrame,
  RuneRuntimeIncidentEvidence,
  RuneRuntimeIncidentFrame,
} from "../../alertTypes";
import { buildRuneReportRuntimeFrameTable } from "./runeRuntimeFrameTable";

describe("buildRuneReportRuntimeFrameTable", () => {
  it("stores one image when runtime and trigger evidence share a frame", () => {
    const sharedUrl = image("shared");
    const result = buildRuneReportRuntimeFrameTable({
      runtimeIncident: incident([runtimeFrame(1_000, sharedUrl)]),
      alertTrigger: trigger([triggerFrame(1_000, sharedUrl)]),
    });

    expect(result.runtimeFrames).toEqual([
      expect.objectContaining({
        frameId: "frame:1000",
        rawDataUrl: sharedUrl,
        roles: ["alert-trigger", "runtime-signal"],
        episodeIds: ["rune-episode:2:500"],
        cycleIds: ["2:1000:initial"],
        mediaConflict: false,
      }),
    ]);
    expect(result.runtimeIncident?.frames[0]).toMatchObject({
      frameId: "frame:1000",
      sampledAt: 1_000,
    });
    expect(result.alertTrigger?.frames[0]).toMatchObject({
      frameId: "frame:1000",
      sampledAt: 1_000,
    });
    expect(JSON.stringify(result.runtimeIncident)).not.toContain("rawDataUrl");
    expect(JSON.stringify(result.alertTrigger)).not.toContain("rawDataUrl");
    expect(JSON.stringify(result).match(new RegExp(sharedUrl, "g"))).toHaveLength(1);
  });

  it("keeps distinct frames in sample order with provenance", () => {
    const result = buildRuneReportRuntimeFrameTable({
      runtimeIncident: incident([
        runtimeFrame(2_000, image("signal")),
        runtimeFrame(1_000, image("before"), "before"),
      ]),
      alertTrigger: trigger([triggerFrame(3_000, image("trigger"))]),
    });

    expect(result.runtimeFrames.map((frame) => frame.frameId)).toEqual([
      "frame:1000",
      "frame:2000",
      "frame:3000",
    ]);
    expect(result.runtimeFrames[0]).toMatchObject({
      roles: ["runtime-before"],
      mediaSource: "runtime-incident",
    });
    expect(result.runtimeFrames[2]).toMatchObject({
      roles: ["alert-trigger"],
      mediaSource: "alert-trigger",
    });
  });

  it("prefers the alert-trigger image and records a same-frame conflict", () => {
    const result = buildRuneReportRuntimeFrameTable({
      runtimeIncident: incident([runtimeFrame(1_000, image("runtime"))]),
      alertTrigger: trigger([triggerFrame(1_000, image("trigger"))]),
    });

    expect(result.runtimeFrames[0]).toMatchObject({
      rawDataUrl: image("trigger"),
      mediaSource: "alert-trigger",
      mediaConflict: true,
    });
  });
});

function runtimeFrame(
  sampledAt: number,
  rawDataUrl: string,
  phase: RuneRuntimeIncidentFrame["phase"] = "signal",
): RuneRuntimeIncidentFrame {
  return {
    source: "runtime",
    phase,
    outcome: phase === "signal" ? "detected" : "not-detected",
    sampledAt,
    detectorVersion: "rune-test",
    detectionDebug: null,
    detectionError: null,
    rawDataUrl,
    detected: phase === "signal",
    confidence: 0.9,
    candidateCount: 1,
    candidate: null,
    status: "candidate",
    stableCount: 2,
    firstDetectedAt: 500,
    stableDurationMs: 500,
    confirmationSatisfied: false,
    confirmationSatisfiedBy: null,
    shouldAlert: false,
    reason: "stabilizing",
    sceneEpoch: 2,
    sceneChanged: false,
    sceneChangeScore: null,
  };
}

function triggerFrame(sampledAt: number, rawDataUrl: string): RuneAlertTriggerFrame {
  return {
    sampledAt,
    detectorVersion: "rune-test",
    detectionDebug: null,
    rawDataUrl,
    detected: true,
    confidence: 0.9,
    candidateCount: 1,
    candidate: null,
    status: "alerted",
    stableCount: 3,
    firstDetectedAt: 500,
    stableDurationMs: 500,
    confirmationSatisfied: true,
    confirmationSatisfiedBy: "frames-and-duration",
    shouldAlert: true,
    reason: "initial-alert",
    sceneEpoch: 2,
  };
}

function incident(frames: RuneRuntimeIncidentFrame[]): RuneRuntimeIncidentEvidence {
  return {
    schemaVersion: "rune-runtime-incident-v1",
    id: "2:500",
    startedAt: 500,
    lastSignalAt: frames[frames.length - 1]?.sampledAt ?? 0,
    updatedAt: frames[frames.length - 1]?.sampledAt ?? 0,
    expiresAt: 60_000,
    detectorVersion: "rune-test",
    sceneEpoch: 2,
    frames,
  };
}

function trigger(frames: RuneAlertTriggerFrame[]): RuneAlertTriggerEvidence {
  return {
    schemaVersion: "rune-alert-trigger-v1",
    cycleId: "2:1000:initial",
    decision: "initial",
    triggeredAt: 1_000,
    detectorVersion: "rune-test",
    sceneEpoch: 2,
    frames,
  };
}

function image(value: string) {
  return `data:image/png;base64,${value}`;
}
