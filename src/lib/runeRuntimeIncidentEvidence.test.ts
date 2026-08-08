import { describe, expect, it, vi } from "vitest";
import type { RuneRuntimeState } from "../alertTypes";
import type { RuneDetectionResult } from "../recognition/rune/runeDetectionTypes";
import { createRuneRuntimeState } from "./runeAlert";
import {
  createRuneRuntimeIncidentEvidenceState,
  RUNE_RUNTIME_INCIDENT_MAX_DATA_URL_BYTES,
  RUNE_RUNTIME_INCIDENT_MAX_FRAME_BYTES,
  RUNE_RUNTIME_INCIDENT_RETENTION_MS,
  updateRuneRuntimeIncidentEvidence,
} from "./runeRuntimeIncidentEvidence";

describe("rune runtime incident evidence", () => {
  it("keeps a preview prelude without encoding every neutral runtime frame", () => {
    const createRawDataUrl = vi.fn(() => image("encoded"));
    const next = updateRuneRuntimeIncidentEvidence({
      previous: createRuneRuntimeIncidentEvidenceState(),
      detection: detection(0.1),
      runtimeState: runtimeState(1_000),
      sampledAt: 1_000,
      previewRawDataUrl: image("preview"),
      createRawDataUrl,
    });

    expect(next.incident).toBeNull();
    expect(next.preludeFrame).toMatchObject({
      phase: "before",
      outcome: "not-detected",
      sampledAt: 1_000,
    });
    expect(createRawDataUrl).not.toHaveBeenCalled();
  });

  it("retains one prelude, three signal frames, and two following frames", () => {
    let state = updateRuneRuntimeIncidentEvidence({
      previous: createRuneRuntimeIncidentEvidenceState(),
      detection: detection(0.1),
      runtimeState: runtimeState(1_000),
      sampledAt: 1_000,
      previewRawDataUrl: image("before"),
      createRawDataUrl: () => image("unused"),
    });

    for (const sampledAt of [2_000, 3_000, 4_000]) {
      state = updateRuneRuntimeIncidentEvidence({
        previous: state,
        detection: detection(0.9, true),
        runtimeState: runtimeState(sampledAt, {
          status: sampledAt === 4_000 ? "alerted" : "candidate",
          stableCount: sampledAt / 1_000 - 1,
          shouldAlert: sampledAt === 4_000,
        }),
        sampledAt,
        previewRawDataUrl: null,
        createRawDataUrl: () => image(`signal-${sampledAt}`),
      });
    }
    for (const sampledAt of [5_000, 6_000]) {
      state = updateRuneRuntimeIncidentEvidence({
        previous: state,
        detection: detection(0.1),
        runtimeState: runtimeState(sampledAt),
        sampledAt,
        previewRawDataUrl: image(`preview-${sampledAt}`),
        createRawDataUrl: () => image(`after-${sampledAt}`),
      });
    }

    expect(state.incident?.frames.map((frame) => frame.phase)).toEqual([
      "before",
      "signal",
      "signal",
      "signal",
      "after",
      "after",
    ]);
    expect(state.incident).toMatchObject({
      schemaVersion: "rune-runtime-incident-v1",
      startedAt: 1_000,
      lastSignalAt: 4_000,
      updatedAt: 6_000,
      expiresAt: 6_000 + RUNE_RUNTIME_INCIDENT_RETENTION_MS,
    });
  });

  it("starts evidence for a near-threshold result but ignores a clearly negative score", () => {
    const below = updateRuneRuntimeIncidentEvidence({
      previous: createRuneRuntimeIncidentEvidenceState(),
      detection: detection(0.2),
      runtimeState: runtimeState(1_000),
      sampledAt: 1_000,
      previewRawDataUrl: null,
      createRawDataUrl: () => image("below"),
    });
    const near = updateRuneRuntimeIncidentEvidence({
      previous: below,
      detection: detection(0.4),
      runtimeState: runtimeState(2_000),
      sampledAt: 2_000,
      previewRawDataUrl: null,
      createRawDataUrl: () => image("near"),
    });

    expect(below.incident).toBeNull();
    expect(near.incident?.frames).toEqual([
      expect.objectContaining({ phase: "signal", outcome: "near-threshold" }),
    ]);
  });

  it("captures detector errors as runtime signal evidence", () => {
    const error = {
      code: "rune-worker-failed",
      phase: "worker-runtime" as const,
      message: "worker failed",
      occurredAt: 1_000,
      retryCount: 1,
    };
    const next = updateRuneRuntimeIncidentEvidence({
      previous: createRuneRuntimeIncidentEvidenceState(),
      detection: null,
      runtimeState: runtimeState(1_000, { status: "unavailable", reason: "detector-error" }),
      sampledAt: 1_000,
      previewRawDataUrl: null,
      createRawDataUrl: () => image("error"),
      detectionError: error,
    });

    expect(next.incident?.frames[0]).toMatchObject({
      outcome: "error",
      detectionError: error,
      reason: "detector-error",
    });
  });

  it("binds each retained signal frame to the runtime state transition", () => {
    const stateBefore = runtimeState(1_000, { status: "waiting" });
    const stateAfter = runtimeState(2_000, {
      status: "candidate",
      stableCount: 1,
    });
    const next = updateRuneRuntimeIncidentEvidence({
      previous: createRuneRuntimeIncidentEvidenceState(),
      detection: detection(0.9, true),
      runtimeStateBefore: stateBefore,
      runtimeState: stateAfter,
      sampledAt: 2_000,
      previewRawDataUrl: null,
      createRawDataUrl: () => image("signal"),
    });

    expect(next.incident?.frames[0]).toMatchObject({
      stateBefore: { status: "waiting", stableCount: 0 },
      stateAfter: { status: "candidate", stableCount: 1 },
    });
  });

  it("expires old incident media and enforces per-frame and total byte limits", () => {
    const largeImage = image("A".repeat(300_000));
    let state = updateRuneRuntimeIncidentEvidence({
      previous: createRuneRuntimeIncidentEvidenceState(),
      detection: detection(0.1),
      runtimeState: runtimeState(1_000),
      sampledAt: 1_000,
      previewRawDataUrl: largeImage,
      createRawDataUrl: () => largeImage,
    });
    for (const sampledAt of [2_000, 3_000, 4_000]) {
      state = updateRuneRuntimeIncidentEvidence({
        previous: state,
        detection: detection(0.9, true),
        runtimeState: runtimeState(sampledAt),
        sampledAt,
        previewRawDataUrl: null,
        createRawDataUrl: () => largeImage,
      });
    }
    for (const sampledAt of [5_000, 6_000]) {
      state = updateRuneRuntimeIncidentEvidence({
        previous: state,
        detection: detection(0.1),
        runtimeState: runtimeState(sampledAt),
        sampledAt,
        previewRawDataUrl: null,
        createRawDataUrl: () => largeImage,
      });
    }

    const retainedBytes = state.incident?.frames.reduce(
      (total, frame) => total + new TextEncoder().encode(frame.rawDataUrl).byteLength,
      0,
    ) ?? 0;
    expect(retainedBytes).toBeLessThanOrEqual(RUNE_RUNTIME_INCIDENT_MAX_DATA_URL_BYTES);
    expect(state.incident?.frames.filter((frame) => frame.phase === "signal")).toHaveLength(3);

    const expired = updateRuneRuntimeIncidentEvidence({
      previous: state,
      detection: detection(0.1),
      runtimeState: runtimeState(6_001 + RUNE_RUNTIME_INCIDENT_RETENTION_MS),
      sampledAt: 6_001 + RUNE_RUNTIME_INCIDENT_RETENTION_MS,
      previewRawDataUrl: null,
      createRawDataUrl: () => image("unused"),
    });
    expect(expired.incident).toBeNull();

    const oversized = image("A".repeat(RUNE_RUNTIME_INCIDENT_MAX_FRAME_BYTES));
    const rejected = updateRuneRuntimeIncidentEvidence({
      previous: createRuneRuntimeIncidentEvidenceState(),
      detection: detection(0.9, true),
      runtimeState: runtimeState(1_000),
      sampledAt: 1_000,
      previewRawDataUrl: null,
      createRawDataUrl: () => oversized,
    });
    expect(rejected.incident).toBeNull();
  });
});

function image(value: string) {
  return `data:image/png;base64,${value}`;
}

function detection(score: number, detected = false): RuneDetectionResult {
  const candidate = {
    x: 10,
    y: 20,
    width: 12,
    height: 12,
    pixelCount: 0,
    confidence: score,
    source: "onnx-full-frame" as const,
  };
  return {
    detected,
    confidence: score,
    candidates: detected ? [candidate] : [],
    debug: {
      detectorKind: "onnx-full-frame",
      classifier: "rune-test-v1",
      modelScore: score,
      modelThreshold: 0.5,
      modelCandidate: candidate,
      reason: detected ? undefined : "score-below-threshold",
    },
  };
}

function runtimeState(
  sampledAt: number,
  overrides: {
    status?: RuneRuntimeState["status"];
    stableCount?: number;
    shouldAlert?: boolean;
    reason?: NonNullable<RuneRuntimeState["lastDecisionReason"]>;
  } = {},
): RuneRuntimeState {
  const base = createRuneRuntimeState();
  const reason = overrides.reason ?? (overrides.stableCount ? "stabilizing" : "waiting");
  return {
    ...base,
    status: overrides.status ?? "waiting",
    detectorVersion: "rune-test-v1",
    stableCount: overrides.stableCount ?? 0,
    firstDetectedAt: overrides.stableCount ? 2_000 : null,
    lastDecisionReason: reason,
    recentSamples: [
      {
        sampledAt,
        detected: Boolean(overrides.stableCount),
        confidence: overrides.stableCount ? 0.9 : 0.1,
        candidateCount: overrides.stableCount ? 1 : 0,
        candidate: null,
        status: overrides.status ?? "waiting",
        stableCount: overrides.stableCount ?? 0,
        firstDetectedAt: overrides.stableCount ? 2_000 : null,
        stableDurationMs: overrides.stableCount ? Math.max(0, sampledAt - 2_000) : 0,
        confirmationSatisfied: Boolean(overrides.shouldAlert),
        confirmationSatisfiedBy: overrides.shouldAlert ? "frames-and-duration" : null,
        shouldAlert: Boolean(overrides.shouldAlert),
        reason,
      },
    ],
  };
}
