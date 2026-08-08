import { describe, expect, it } from "vitest";
import type {
  RuneAlertTriggerFrame,
  RuneRuntimeIncidentFrame,
} from "../alertTypes";
import {
  enforceRuneEvidenceMediaBudget,
  RUNE_EVIDENCE_MEDIA_MAX_FRAMES,
  RUNE_EVIDENCE_MEDIA_MAX_TOTAL_CHARS,
} from "./runeEvidenceMediaBudget";

describe("enforceRuneEvidenceMediaBudget", () => {
  it("counts a frame shared by runtime and trigger evidence only once", () => {
    const sharedUrl = image("shared");
    const result = enforceRuneEvidenceMediaBudget({
      runtimeIncident: incident([runtimeFrame(1_000, "detected", sharedUrl)]),
      pendingAlertTriggerFrames: [triggerFrame(1_000, sharedUrl)],
      lastAlertTrigger: trigger([triggerFrame(1_000, sharedUrl)]),
    });

    expect(result.budget).toMatchObject({
      retainedFrameIds: ["frame:1000"],
      retainedChars: sharedUrl.length,
      omittedCapacity: 0,
    });
  });

  it("preserves trigger and signal frames before optional context", () => {
    const result = enforceRuneEvidenceMediaBudget({
      runtimeIncident: incident([
        runtimeFrame(1_000, "not-detected", image("before"), "before"),
        runtimeFrame(2_000, "near-threshold", image("near")),
        runtimeFrame(3_000, "detected", image("signal")),
        runtimeFrame(4_000, "not-detected", image("after-1"), "after"),
        runtimeFrame(5_000, "not-detected", image("after-2"), "after"),
      ]),
      pendingAlertTriggerFrames: [],
      lastAlertTrigger: trigger([
        triggerFrame(6_000, image("trigger-1")),
        triggerFrame(7_000, image("trigger-2")),
        triggerFrame(8_000, image("trigger-3")),
      ]),
    });

    expect(result.budget.retainedFrameIds).toEqual([
      "frame:1000",
      "frame:2000",
      "frame:3000",
      "frame:6000",
      "frame:7000",
      "frame:8000",
    ]);
    expect(result.budget.omittedCapacity).toBe(2);
  });

  it("enforces the global frame and character limits", () => {
    const large = image("x".repeat(249_000));
    const result = enforceRuneEvidenceMediaBudget({
      runtimeIncident: incident(
        Array.from({ length: 8 }, (_, index) =>
          runtimeFrame(1_000 + index, "detected", `${large}${index}`),
        ),
      ),
      pendingAlertTriggerFrames: [],
      lastAlertTrigger: null,
    });

    expect(result.budget.retainedFrameIds.length).toBeLessThanOrEqual(
      RUNE_EVIDENCE_MEDIA_MAX_FRAMES,
    );
    expect(result.budget.retainedChars).toBeLessThanOrEqual(
      RUNE_EVIDENCE_MEDIA_MAX_TOTAL_CHARS,
    );
  });

  it("protects the last alert frames while a later candidate is still pending", () => {
    const lastTrigger = trigger([
      triggerFrame(1_000, image("alert-1")),
      triggerFrame(2_000, image("alert-2")),
      triggerFrame(3_000, image("alert-3")),
      triggerFrame(4_000, image("alert-4")),
    ]);
    const result = enforceRuneEvidenceMediaBudget({
      runtimeIncident: null,
      pendingAlertTriggerFrames: [
        triggerFrame(10_000, image("pending-1")),
        triggerFrame(11_000, image("pending-2")),
        triggerFrame(12_000, image("pending-3")),
        triggerFrame(13_000, image("pending-4")),
      ],
      lastAlertTrigger: lastTrigger,
    });

    expect(result.budget.retainedFrameIds).toEqual([
      "frame:1000",
      "frame:2000",
      "frame:3000",
      "frame:4000",
      "frame:12000",
      "frame:13000",
    ]);
  });
});

function runtimeFrame(
  sampledAt: number,
  outcome: RuneRuntimeIncidentFrame["outcome"],
  rawDataUrl: string,
  phase: RuneRuntimeIncidentFrame["phase"] = "signal",
): RuneRuntimeIncidentFrame {
  return {
    source: "runtime",
    phase,
    outcome,
    sampledAt,
    detectorVersion: "rune-test",
    detectionDebug: null,
    detectionError: null,
    rawDataUrl,
    detected: outcome === "detected",
    confidence: 0.9,
    candidateCount: 1,
    candidate: null,
    status: "candidate",
    stableCount: 1,
    firstDetectedAt: sampledAt,
    stableDurationMs: 0,
    confirmationSatisfied: false,
    confirmationSatisfiedBy: null,
    shouldAlert: false,
    reason: "stabilizing",
    sceneEpoch: 1,
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
    firstDetectedAt: sampledAt - 2_000,
    stableDurationMs: 2_000,
    confirmationSatisfied: true,
    confirmationSatisfiedBy: "frames-and-duration",
    shouldAlert: true,
    reason: "initial-alert",
    sceneEpoch: 1,
  };
}

function incident(frames: RuneRuntimeIncidentFrame[]) {
  return {
    schemaVersion: "rune-runtime-incident-v1" as const,
    id: "incident",
    startedAt: frames[0]?.sampledAt ?? 0,
    lastSignalAt: frames[frames.length - 1]?.sampledAt ?? 0,
    updatedAt: frames[frames.length - 1]?.sampledAt ?? 0,
    expiresAt: 60_000,
    detectorVersion: "rune-test",
    sceneEpoch: 1,
    frames,
  };
}

function trigger(frames: RuneAlertTriggerFrame[]) {
  return {
    schemaVersion: "rune-alert-trigger-v1" as const,
    cycleId: "1:8000:initial",
    decision: "initial" as const,
    triggeredAt: frames[frames.length - 1]?.sampledAt ?? 0,
    detectorVersion: "rune-test",
    sceneEpoch: 1,
    frames,
  };
}

function image(value: string) {
  return `data:image/png;base64,${value}`;
}
