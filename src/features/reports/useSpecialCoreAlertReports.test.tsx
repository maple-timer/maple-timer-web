import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSpecialCoreRuntimeState,
  type SpecialCoreRuntimeState,
  type SpecialCoreSnapshot,
} from "../../lib/specialCore";
import {
  createDefaultProfile,
  createDefaultSpecialCoreAlert,
} from "../../lib/storage";
import {
  createSpecialCoreIncidentRuntimeRecorder,
  recordSpecialCoreIncidentRuntimeSample,
  type SpecialCoreIncidentRuntimeRecorder,
} from "../../runtime/special-core/evidence/specialCoreIncidentRuntimeRecorder";
import { useSpecialCoreAlertReports } from "./useSpecialCoreAlertReports";

const mocks = vi.hoisted(() => ({
  postDebugSample: vi.fn(),
}));

vi.mock("./reportClient", () => ({
  getOrCreateReportClientId: () => "test-client",
  postDebugSample: mocks.postDebugSample,
}));

describe("useSpecialCoreAlertReports", () => {
  beforeEach(() => {
    mocks.postDebugSample.mockReset();
  });

  it("freezes the normal runtime incident at dialog open and reuses it on retry", async () => {
    mocks.postDebugSample
      .mockRejectedValueOnce(new Error("temporary-upload-failure"))
      .mockResolvedValueOnce({ id: "sample-1" });
    const profile = {
      ...createDefaultProfile(),
      specialCoreAlert: {
        ...createDefaultSpecialCoreAlert(),
        enabled: true,
      },
    };
    const video = {
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    const runtimeRef = {
      current: createSpecialCoreRuntimeState({
        status: "waiting",
        lastSampledAt: 20_000,
      }),
    };
    const snapshotRef = { current: createRuntimeSnapshot(20_000) };
    const recorderRef = {
      current: recordRuntimeSample({
        previous: createSpecialCoreIncidentRuntimeRecorder(0),
        sampledAt: 20_000,
        state: runtimeRef.current,
        snapshot: snapshotRef.current,
      }),
    };
    const onMessage = vi.fn();
    const { result } = renderHook(() =>
      useSpecialCoreAlertReports({
        videoRef: { current: video },
        profileRef: { current: profile },
        specialCoreRuntimeRef: runtimeRef,
        specialCoreSnapshotRef: snapshotRef,
        specialCoreIncidentRecorderRef: recorderRef,
        currentLayoutKey: "1920x1080",
        onMessage,
      }),
    );

    act(() => {
      result.current.freezeSpecialCoreIssueReportEvidence(21_000);
    });

    runtimeRef.current = createSpecialCoreRuntimeState({
      status: "unavailable",
      lastSampledAt: 22_000,
      unsupportedReason: "mutated-after-open",
    });
    snapshotRef.current = createRuntimeSnapshot(22_000);
    recorderRef.current = recordRuntimeSample({
      previous: recorderRef.current,
      sampledAt: 22_000,
      state: runtimeRef.current,
      snapshot: snapshotRef.current,
    });
    profile.specialCoreAlert!.soundId = "mutated-after-open";

    const issue = {
      reason: "special-core-missed",
      label: "특수 코어 발동 아이콘을 찾지 못했어요",
      scenario: "not-recognized" as const,
      occurrence: "current" as const,
    };
    let firstResult = true;
    await act(async () => {
      firstResult = await result.current.submitSpecialCoreIssueReport(issue);
    });
    expect(firstResult).toBe(false);

    let retryResult = false;
    await act(async () => {
      retryResult = await result.current.submitSpecialCoreIssueReport(issue);
    });
    expect(retryResult).toBe(true);
    expect(mocks.postDebugSample).toHaveBeenCalledTimes(2);

    const firstPayload = mocks.postDebugSample.mock.calls[0]?.[0];
    const retryPayload = mocks.postDebugSample.mock.calls[1]?.[0];
    expect(firstPayload.sample.specialCoreEvidence).toEqual(
      retryPayload.sample.specialCoreEvidence,
    );
    expect(firstPayload.sample.specialCoreEvidence).toMatchObject({
      frozenAt: 21_000,
      reportFrame: null,
      selection: {
        resetEpochId: expect.any(String),
        frameIds: [expect.any(String)],
        operatorConclusion: "recognition-missing",
      },
      frames: [
        expect.objectContaining({
          sampledAt: 20_000,
        }),
      ],
      media: [
        expect.objectContaining({
          imageDataUrl: "data:image/png;base64,runtime-special-core-20000",
        }),
      ],
    });
    expect(firstPayload.sample.specialCoreEvidence.frames).toHaveLength(1);
    expect(firstPayload.sample.rawDataUrl).toBeNull();
    expect(firstPayload.specialCore.config.soundId).not.toBe(
      "mutated-after-open",
    );
    expect(firstPayload.specialCore.state.status).toBe("waiting");
    expect(firstPayload.specialCore.recentEvidence).toEqual([]);
    expect(onMessage).toHaveBeenLastCalledWith("제보를 보냈습니다.");
  });
});

function recordRuntimeSample({
  previous,
  sampledAt,
  state,
  snapshot,
}: {
  previous: SpecialCoreIncidentRuntimeRecorder;
  sampledAt: number;
  state: SpecialCoreRuntimeState;
  snapshot: SpecialCoreSnapshot;
}): SpecialCoreIncidentRuntimeRecorder {
  return recordSpecialCoreIncidentRuntimeSample({
    previous,
    input: {
      sampledAt,
      configuration: {
        enabled: true,
        cooldownSeconds: 30,
        alertLeadSeconds: 5,
        soundId: "countdown",
        featureVolume: 1,
        masterVolume: 1,
        effectiveVolume: 1,
      },
      parserRuntimeGeneration: "webgpu:runtime:parser-v1",
      layoutKey: "1920x1080",
      sourceGeometryRevision: "1920x1080:top-right",
      stateBefore: state,
      stateAfter: state,
      snapshot,
      source: {
        kind: "normal-shared-parser",
        parserInputMode: "fullFrame",
        coordinateSpace: "capture-pixels",
        sourceDimensions: { width: 1920, height: 1080 },
        parserInputRegion: { x: 0, y: 0, width: 1920, height: 1080 },
        storedMediaKind: "buff-slot-top-right-quadrant-v1",
        storedMediaRegion: { x: 960, y: 0, width: 960, height: 540 },
        regionLabel: "960x540",
      },
      parser: {
        engine: "dl",
        version: "buff-slot-parser-test-v1",
        fallbackReason: null,
        runtime: null,
      },
      parsedBoxes: [],
      rowGroups: [],
      eligibleBoxIndexes: [],
      timings: {
        totalMs: 5,
        detectMs: 2,
        matchMs: 3,
        sharedParserTotalMs: 2,
        sharedParserDetectMs: 2,
        resultAgeMs: 0,
        droppedSampleCount: 0,
      },
      runtimeFailure: null,
      media: {
        imageDataUrl: `data:image/png;base64,runtime-special-core-${sampledAt}`,
        reason: "rejected-observation",
      },
    },
  });
}

function createRuntimeSnapshot(sampledAt: number): SpecialCoreSnapshot {
  return {
    sampledAt,
    error: null,
    parserEngine: "dl",
    parserVersion: "buff-slot-parser-test-v1",
    parserFallbackReason: null,
    boxCount: 0,
    detectedCount: 0,
    detectedIcon: null,
    candidateIcons: [],
    performance: {
      totalMs: 5,
      detectMs: 2,
      matchMs: 3,
      boxCount: 0,
    },
  };
}
