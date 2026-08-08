import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBoosterExpiryRuntimeState,
} from "../../lib/boosterExpiry/boosterExpiryRuntime";
import type {
  BoosterExpiryRuntimeState,
  BoosterExpirySnapshot,
} from "../../lib/boosterExpiry/boosterExpiryTypes";
import {
  createDefaultBoosterExpiryAlert,
  createDefaultProfile,
} from "../../lib/storage";
import {
  createBoosterExpiryIncidentRuntimeRecorder,
  recordBoosterExpiryIncidentRuntimeSample,
  type BoosterExpiryIncidentRuntimeRecorder,
} from "../../runtime/booster-expiry/evidence/boosterExpiryIncidentRuntimeRecorder";
import { useBoosterExpiryAlertReports } from "./useBoosterExpiryAlertReports";

const mocks = vi.hoisted(() => ({
  postDebugSample: vi.fn(),
}));

vi.mock("./reportClient", () => ({
  getOrCreateReportClientId: () => "test-client",
  postDebugSample: mocks.postDebugSample,
}));

describe("useBoosterExpiryAlertReports", () => {
  beforeEach(() => {
    mocks.postDebugSample.mockReset();
  });

  it("submits only frozen normal-loop evidence and reuses it on retry", async () => {
    mocks.postDebugSample
      .mockRejectedValueOnce(new Error("temporary-upload-failure"))
      .mockResolvedValueOnce({ id: "sample-1" });
    const profile = {
      ...createDefaultProfile(),
      boosterExpiryAlert: {
        ...createDefaultBoosterExpiryAlert(),
        enabled: true,
      },
    };
    const video = {
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    const runtimeRef = {
      current: createBoosterExpiryRuntimeState(),
    };
    const snapshotRef = { current: createSnapshot(20_000, "runtime") };
    const recorderRef = {
      current: recordRuntimeSample({
        previous: createBoosterExpiryIncidentRuntimeRecorder(0),
        sampledAt: 20_000,
        state: runtimeRef.current,
      }),
    };
    const onMessage = vi.fn();
    const { result } = renderHook(() =>
      useBoosterExpiryAlertReports({
        videoRef: { current: video },
        profileRef: { current: profile },
        boosterExpiryRuntimeRef: runtimeRef,
        boosterExpirySnapshotRef: snapshotRef,
        boosterExpiryIncidentRecorderRef: recorderRef,
        currentLayoutKey: "1920x1080",
        onMessage,
      }),
    );

    act(() => {
      result.current.freezeBoosterExpiryIssueReportEvidence(21_000);
    });

    runtimeRef.current = {
      ...createBoosterExpiryRuntimeState(),
      status: "lost",
      lastDecision: "lost",
    };
    snapshotRef.current = createSnapshot(22_000, "mutated");
    recorderRef.current = recordRuntimeSample({
      previous: recorderRef.current,
      sampledAt: 22_000,
      state: runtimeRef.current,
    });
    profile.boosterExpiryAlert!.soundId = "mutated-after-open";

    const issue = {
      reason: "booster-expiry-missed",
      label: "부스터가 꺼졌는데 알림이 안 울려요",
      scenario: "not-recognized" as const,
      occurrence: "current" as const,
    };
    let firstResult = true;
    await act(async () => {
      firstResult = await result.current.submitBoosterExpiryIssueReport(issue);
    });
    expect(firstResult).toBe(false);

    let retryResult = false;
    await act(async () => {
      retryResult = await result.current.submitBoosterExpiryIssueReport(issue);
    });
    expect(retryResult).toBe(true);
    expect(mocks.postDebugSample).toHaveBeenCalledTimes(2);

    const firstPayload = mocks.postDebugSample.mock.calls[0]?.[0];
    const retryPayload = mocks.postDebugSample.mock.calls[1]?.[0];
    expect(firstPayload.sample.boosterExpiryEvidence).toEqual(
      retryPayload.sample.boosterExpiryEvidence,
    );
    expect(firstPayload.sample.boosterExpiryEvidence).toMatchObject({
      frozenAt: 21_000,
      reportFrame: null,
      selection: {
        resetEpochId: expect.any(String),
        frameIds: [expect.any(String)],
        operatorConclusion: "recognition-missing",
      },
      frames: [expect.objectContaining({ sampledAt: 20_000 })],
      media: [
        expect.objectContaining({
          imageDataUrl: "data:image/png;base64,runtime-20000",
        }),
      ],
    });
    expect(firstPayload.sample.sampledAt).toBe(20_000);
    expect(firstPayload.sample.rawDataUrl).toBeNull();
    expect(firstPayload.sample.timerDataUrl).toBeNull();
    expect(firstPayload.sample.runtimeTrace).toEqual([]);
    expect(firstPayload.sample.timerEvidence).toEqual([]);
    expect(firstPayload.sample.confirmationEvidence).toEqual([]);
    expect(firstPayload.sample).toEqual(retryPayload.sample);
    expect(firstPayload.boosterExpiry.config.soundId).not.toBe(
      "mutated-after-open",
    );
    expect(firstPayload.boosterExpiry.state.status).toBe("paused");
    expect(snapshotRef.current.regionLabel).toBe("mutated");
    expect(onMessage).toHaveBeenLastCalledWith("제보를 보냈습니다.");
  });
});

function recordRuntimeSample({
  previous,
  sampledAt,
  state,
}: {
  previous: BoosterExpiryIncidentRuntimeRecorder;
  sampledAt: number;
  state: BoosterExpiryRuntimeState;
}): BoosterExpiryIncidentRuntimeRecorder {
  return recordBoosterExpiryIncidentRuntimeSample({
    previous,
    input: {
      sampledAt,
      configuration: {
        enabled: true,
        alertLeadSeconds: 10,
        soundId: "booster-expiry",
        featureVolume: 1,
        masterVolume: 1,
        effectiveVolume: 1,
      },
      monitoringGeneration: 1,
      layoutKey: "1920x1080",
      sourceGeometryRevision: "1920x1080:top-quarter",
      stateBefore: state,
      stateAfter: state,
      result: null,
      source: {
        kind: "normal-monitoring-top-quarter",
        coordinateSpace: "capture-pixels",
        sourceDimensions: { width: 1920, height: 1080 },
        sampledRegion: { x: 0, y: 0, width: 1920, height: 270 },
        maxCaptureWidth: 1024,
        regionLabel: "1920x270",
      },
      performance: null,
      runtimeFailure: null,
      media: {
        imageDataUrl: `data:image/png;base64,runtime-${sampledAt}`,
        reason: "rejected-observation",
      },
    },
  });
}

function createSnapshot(
  sampledAt: number,
  label: string,
): BoosterExpirySnapshot {
  return {
    sampledAt,
    rawPreviewUrl: `data:image/png;base64,${label}-raw`,
    timerPreviewUrl: null,
    regionLabel: label,
    rawTime: null,
    time: null,
    timeRect: null,
    flow: null,
    performance: null,
    runtimeTrace: [],
    timerEvidence: [],
    confirmationEvidence: [],
  };
}
