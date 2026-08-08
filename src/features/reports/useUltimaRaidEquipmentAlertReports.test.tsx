import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultProfile,
  createDefaultUltimaRaidEquipmentAlert,
} from "../../lib/storage";
import {
  createUltimaRaidEquipmentIncidentArchive,
  recordUltimaRaidEquipmentIncidentFrame,
} from "../../runtime/ultima-raid-equipment/evidence/ultimaRaidEquipmentIncidentEvidence";
import {
  createUltimaRaidEquipmentRuntimeState,
} from "../../runtime/ultima-raid-equipment/ultimaRaidEquipmentAlertState";
import type { UltimaRaidEquipmentSnapshot } from "../../runtime/ultima-raid-equipment/ultimaRaidEquipmentSnapshot";
import { useUltimaRaidEquipmentAlertReports } from "./useUltimaRaidEquipmentAlertReports";

const mocks = vi.hoisted(() => ({
  postDebugSample: vi.fn(),
  encodeEvidenceFrame: vi.fn(
    () => "data:image/webp;base64,VUxUSU1B",
  ),
}));

vi.mock("./reportClient", () => ({
  getOrCreateReportClientId: () => "test-client",
  postDebugSample: mocks.postDebugSample,
}));

vi.mock(
  "../../platform/frame-capture/ultima-raid-equipment/ultimaRaidEquipmentEvidenceCapture",
  () => ({
    encodeUltimaRaidEquipmentEvidenceFrame: mocks.encodeEvidenceFrame,
  }),
);

describe("useUltimaRaidEquipmentAlertReports", () => {
  beforeEach(() => {
    mocks.postDebugSample.mockReset();
    mocks.encodeEvidenceFrame.mockClear();
  });

  it("freezes normal-loop evidence at dialog open and reuses it on retry", async () => {
    mocks.postDebugSample
      .mockRejectedValueOnce(new Error("temporary-upload-failure"))
      .mockResolvedValueOnce({ id: "sample-1" });
    const profile = {
      ...createDefaultProfile(),
      ultimaRaidEquipmentAlert: {
        ...createDefaultUltimaRaidEquipmentAlert(),
        enabled: true,
        region: { x: 0.1, y: 0.1, width: 0.5, height: 0.3 },
      },
    };
    const video = {
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    const state = createUltimaRaidEquipmentRuntimeState("candidate");
    const runtimeRef = { current: state };
    const snapshotRef = {
      current: createSnapshot(20_000, 19_000),
    };
    const incidentArchiveRef = {
      current: recordRuntimeFrame({
        sampledAt: 19_000,
        state,
      }),
    };
    const onMessage = vi.fn();
    const { result } = renderHook(() =>
      useUltimaRaidEquipmentAlertReports({
        videoRef: { current: video },
        profileRef: { current: profile },
        runtimeRef,
        snapshotRef,
        incidentArchiveRef,
        currentLayoutKey: "1920x1080",
        onMessage,
      }),
    );

    act(() => {
      result.current.freezeUltimaRaidEquipmentIssueReportEvidence(21_000);
    });

    runtimeRef.current =
      createUltimaRaidEquipmentRuntimeState("unavailable");
    snapshotRef.current = createSnapshot(22_000, 22_000);
    incidentArchiveRef.current = recordRuntimeFrame({
      sampledAt: 22_000,
      state: runtimeRef.current,
    });
    profile.ultimaRaidEquipmentAlert.soundId = "mutated-after-open";

    const issue = {
      reason: "ultima-raid-equipment-missed",
      label: "가방이 가득 찼는데 알림이 안 울려요",
      scenario: "not-recognized" as const,
      occurrence: "current" as const,
    };
    let firstResult = true;
    await act(async () => {
      firstResult =
        await result.current.submitUltimaRaidEquipmentIssueReport(issue);
    });
    expect(firstResult).toBe(false);

    let retryResult = false;
    await act(async () => {
      retryResult =
        await result.current.submitUltimaRaidEquipmentIssueReport(issue);
    });
    expect(retryResult).toBe(true);

    expect(mocks.postDebugSample).toHaveBeenCalledTimes(2);
    const firstPayload = mocks.postDebugSample.mock.calls[0]?.[0];
    const retryPayload = mocks.postDebugSample.mock.calls[1]?.[0];
    expect(firstPayload.sample.ultimaRaidEquipmentEvidence).toEqual(
      retryPayload.sample.ultimaRaidEquipmentEvidence,
    );
    expect(firstPayload.sample.ultimaRaidEquipmentEvidence).toMatchObject({
      frozenAt: 21_000,
      selection: {
        frameIds: ["ultima-raid-equipment-frame:1"],
      },
      frames: [
        expect.objectContaining({
          sampledAt: 19_000,
        }),
      ],
      media: [
        expect.objectContaining({
          frameId: "ultima-raid-equipment-frame:1",
          sampledAt: 19_000,
          reason: "report-open-latest-runtime",
          dataUrl: "data:image/webp;base64,VUxUSU1B",
        }),
      ],
    });
    expect(firstPayload.ultimaRaidEquipment.config.soundId).not.toBe(
      "mutated-after-open",
    );
    expect(firstPayload.ultimaRaidEquipment.state.status).toBe("candidate");
    expect(firstPayload.ultimaRaidEquipment.lastSnapshot.sampledAt).toBe(
      20_000,
    );
    expect(
      firstPayload.ultimaRaidEquipment.lastSnapshot.previewImageData,
    ).toBeUndefined();
    expect(mocks.encodeEvidenceFrame).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenLastCalledWith("제보를 보냈습니다.");
  });
});

function recordRuntimeFrame({
  sampledAt,
  state,
}: {
  sampledAt: number;
  state: ReturnType<typeof createUltimaRaidEquipmentRuntimeState>;
}) {
  return recordUltimaRaidEquipmentIncidentFrame({
    previous: createUltimaRaidEquipmentIncidentArchive(0),
    sampledAt,
    detectorVersion: "ultima-raid-inventory-full-v3",
    layoutKey: "1920x1080",
    sourceDimensions: { width: 1920, height: 1080 },
    sampledRegion: { x: 200, y: 100, width: 640, height: 280 },
    detection: {
      layoutValid: true,
      detected: false,
      confidence: 0.1,
      source: "none",
      bagFullDetected: false,
      bagWarmPixelCount: 0,
      bagForegroundPixelCount: 100,
      bagWarmPixelRatio: 0,
      largestBagWarmClusterSize: 0,
      fullBannerDetected: false,
      largestBannerClusterSize: 0,
      bannerWidthRatio: 0,
      bannerHeightRatio: 0,
      bannerFillRatio: 0,
    },
    shouldAlert: false,
    stateBefore: state,
    stateAfter: state,
  });
}

function createSnapshot(
  sampledAt: number,
  previewSampledAt: number,
): UltimaRaidEquipmentSnapshot {
  return {
    sampledAt,
    previewSampledAt,
    detectorVersion: "ultima-raid-inventory-full-v3",
    layoutKey: "1920x1080",
    sourceDimensions: { width: 1920, height: 1080 },
    sampledRegion: { x: 200, y: 100, width: 640, height: 280 },
    detected: false,
    confidence: 0.1,
    layoutValid: true,
    detectionSource: "none",
    bagFullDetected: false,
    bagWarmPixelCount: 0,
    bagForegroundPixelCount: 100,
    bagWarmPixelRatio: 0,
    largestBagWarmClusterSize: 0,
    fullBannerDetected: false,
    largestBannerClusterSize: 0,
    bannerWidthRatio: 0,
    bannerHeightRatio: 0,
    bannerFillRatio: 0,
    bossDetectorVersion: "ultima-raid-boss-progress-v1",
    bossProgressState: "normal",
    bossBarDetected: false,
    normalProgressBarDetected: true,
    bossBarPixelCount: 0,
    bossBarWidthRatio: 0,
    bossBarHeightRatio: 0,
    bossBarFillRatio: 0,
    normalProgressBarPixelCount: 100,
    normalProgressBarWidthRatio: 0.2,
    previewImageData: {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 0, 255]),
    },
  };
}
