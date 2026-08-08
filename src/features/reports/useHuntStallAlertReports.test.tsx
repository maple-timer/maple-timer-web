import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HuntStallSnapshot } from "../../alertTypes";
import { createHuntStallIncidentConfiguration } from "../../application/reporting/huntStallIncidentConfiguration";
import type { AlertIncidentJournalSelection } from "../../application/reporting/alertIncidentJournal";
import { createHuntStallRuntimeState } from "../../lib/huntStallRuntimeState";
import { createDefaultHuntStallAlert, createDefaultProfile } from "../../lib/storage";
import {
  createHuntStallIncidentRegionRevision,
  createHuntStallIncidentRuntimeRecorder,
  recordHuntStallIncidentSample,
} from "../../runtime/hunt-stall/evidence/huntStallIncidentRuntimeRecorder";
import { useHuntStallAlertReports } from "./useHuntStallAlertReports";

const mocks = vi.hoisted(() => ({
  createHuntStallReportSnapshot: vi.fn(),
  postDebugSample: vi.fn(),
}));

vi.mock("./huntStallReportSnapshot", () => ({
  createHuntStallReportSnapshot: mocks.createHuntStallReportSnapshot,
}));

vi.mock("./reportClient", () => ({
  getOrCreateReportClientId: () => "test-client",
  postDebugSample: mocks.postDebugSample,
}));

describe("useHuntStallAlertReports", () => {
  beforeEach(() => {
    mocks.createHuntStallReportSnapshot.mockReset();
    mocks.postDebugSample.mockReset();
    mocks.postDebugSample.mockResolvedValue({ id: "sample-1" });
  });

  it("submits the frozen normal-loop incident without report-time recognition", async () => {
    const config = {
      ...createDefaultHuntStallAlert(),
      enabled: true,
      mode: "manual-experience" as const,
      stallThresholdSeconds: 5,
      manualExperienceRegion: {
        x: 0.1,
        y: 0.8,
        width: 0.7,
        height: 0.08,
      },
    };
    const profileRef = {
      current: {
        ...createDefaultProfile(),
        huntStallAlert: config,
      },
    };
    const stateBefore = createHuntStallRuntimeState();
    const stateAtOpen = {
      ...stateBefore,
      status: "watching" as const,
      lastSampledAt: 1_000,
      lastReadableAt: 1_000,
      lastChangedAt: 1_000,
      recognizedText: "100",
      lastDecision: "stable" as const,
      confidence: 0.98,
    };
    const region = { x: 192, y: 864, width: 1_344, height: 86 };
    const recorderRef = {
      current: recordHuntStallIncidentSample({
        previous: createHuntStallIncidentRuntimeRecorder(0),
        input: {
          sampledAt: 1_000,
          configuration: createHuntStallIncidentConfiguration(
            config,
            profileRef.current.masterVolume,
          ),
          mode: "manual-experience",
          layoutKey: "1920x1080",
          regionRevision: createHuntStallIncidentRegionRevision({
            mode: "manual-experience",
            layoutKey: "1920x1080",
            region,
          }),
          sourceDimensions: { width: 1920, height: 1080 },
          region,
          sourceToCrop: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 },
          stateBefore,
          stateAfter: stateAtOpen,
          recognition: {
            decision: "accepted",
            reason: null,
            rawText: "100",
            rawValue: 100,
            correctedValue: 100,
            fingerprint: "fingerprint-open",
            confidence: 0.98,
            foregroundRatio: 0.12,
            visualActivityScore: null,
            visualChangeScore: 0,
            usedVisualFallback: false,
            readableStreak: 2,
            visualActivityStreak: 0,
            failure: null,
          },
          recognizer: {
            engine: "experience-ocr",
            modelId: "hunt-ocr",
            modelVersion: "open-v1",
            workerVersion: "worker-v1",
            provider: "wasm",
          },
          shouldAlert: false,
          media: {
            rawDataUrl: "data:image/png;base64,open-raw",
            processedDataUrl: "data:image/png;base64,open-processed",
          },
        },
      }),
    };
    const runtimeRef = { current: stateAtOpen };
    const snapshotRef = {
      current: createSnapshot(1_000, "data:image/png;base64,open-snapshot"),
    };
    const video = {
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    const journalSelection = createJournalSelection(1_500);
    const { result } = renderHook(() =>
      useHuntStallAlertReports({
        videoRef: { current: video },
        profileRef,
        huntStallRuntimeRef: runtimeRef,
        huntStallIncidentRecorderRef: recorderRef,
        huntStallSnapshotRef: snapshotRef,
        currentLayoutKey: "1920x1080",
        onMessage: vi.fn(),
      }),
    );

    act(() => {
      result.current.freezeHuntStallIssueReportEvidence(
        1_500,
        journalSelection,
      );
    });
    profileRef.current = {
      ...profileRef.current,
      huntStallAlert: { ...config, stallThresholdSeconds: 30 },
    };
    runtimeRef.current = {
      ...stateAtOpen,
      lastSampledAt: 2_000,
      recognizedText: "later",
    };
    snapshotRef.current = createSnapshot(
      2_000,
      "data:image/png;base64,later-snapshot",
    );

    let submission!: Promise<boolean>;
    act(() => {
      submission = result.current.submitHuntStallIssueReport(
        {
          reason: "hunt-stall-reading",
          label: "읽은 값이 이상해요",
          scenario: "wrong-target",
          scenarioLabel: "다른 영역을 읽었어요",
          occurrence: "current",
        },
        journalSelection,
      );
    });

    await expect(submission).resolves.toBe(true);
    expect(mocks.createHuntStallReportSnapshot).not.toHaveBeenCalled();
    expect(mocks.postDebugSample).toHaveBeenCalledTimes(1);
    const payload = mocks.postDebugSample.mock.calls[0]?.[0];
    expect(payload.huntStall.config.stallThresholdSeconds).toBe(5);
    expect(payload.huntStall.state).toMatchObject({
      lastSampledAt: 1_000,
      recognizedText: "100",
    });
    expect(payload.sample.huntStallEvidence).toMatchObject({
      frozenAt: 1_500,
      reportFrame: null,
      selection: {
        operatorConclusion: "sampled-region-found",
        frameIds: [expect.stringContaining(":1")],
      },
      configurations: [
        expect.objectContaining({
          values: expect.objectContaining({ thresholdSeconds: 5 }),
        }),
      ],
      relatedPlayback: [],
    });
    expect(payload.sample.huntStallEvidence.frames).toHaveLength(1);
    expect(payload.sample.huntStallEvidence.frames[0]).toMatchObject({
      sampledAt: 1_000,
      recognizer: { modelVersion: "open-v1" },
    });
    expect(payload.sample.rawDataUrl).toBeNull();
    expect(payload.sample.processedDataUrl).toBeNull();
    expect(payload.sample.fullFrameDataUrl).toBeNull();
    expect(payload.sample.cropCandidates).toEqual([]);
    expect(payload.sample.runtimeTrace).toEqual([]);
    expect(payload.sample.cropHistory).toEqual([]);
    expect(payload.incident.evidence.source).toBe("runtime-atomic");
    expect(payload.incident.completeness.playback).toBe(false);
    expect(payload.incident.correlation.playbackIds).toEqual([]);
    expect(payload.incident.journal.entries).toEqual([
      expect.objectContaining({ id: "older-hunt-playback" }),
    ]);
  });
});

function createSnapshot(sampledAt: number, rawPreviewUrl: string): HuntStallSnapshot {
  return {
    sampledAt,
    rawPreviewUrl,
    processedPreviewUrl: rawPreviewUrl,
    mode: "manual-experience",
    regionLabel: "1344x86",
    recognizedText: "100",
    confidence: 0.98,
    foregroundRatio: 0.12,
    changeScore: 0,
    runtimeTrace: [],
    cropHistory: [],
  };
}

function createJournalSelection(
  capturedAt: number,
): AlertIncidentJournalSelection {
  return {
    capturedAt,
    windowStartedAt: capturedAt - 60_000,
    windowEndedAt: capturedAt,
    target: { feature: "hunt-stall", targetId: null },
    entries: [
      {
        id: "older-hunt-playback",
        feature: "hunt-stall",
        targetId: null,
        kind: "playback",
        occurredAt: 900,
        frameId: null,
        cycleId: "older-cycle",
        status: "finished",
        decision: "initial",
        value: null,
        configRevision: "older-config",
        configuration: null,
        details: {
          requestedAt: 900,
          startedAt: 920,
          finishedAt: 980,
        },
      },
    ],
    relatedPlaybackEntries: [
      {
        id: "skill-playback",
        feature: "skill",
        targetId: "skill-1",
        kind: "playback",
        occurredAt: 1_100,
        frameId: null,
        cycleId: "skill-cycle",
        status: "finished",
        decision: "initial",
        value: null,
        configRevision: null,
        configuration: null,
        details: {
          requestedAt: 1_100,
          startedAt: 1_120,
          finishedAt: 1_400,
        },
      },
    ],
  };
}
