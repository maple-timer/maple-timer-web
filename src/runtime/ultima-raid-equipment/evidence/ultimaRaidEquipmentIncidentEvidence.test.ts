import { describe, expect, it } from "vitest";
import {
  createUltimaRaidEquipmentRuntimeState,
  type UltimaRaidEquipmentRuntimeState,
} from "../ultimaRaidEquipmentAlertState";
import {
  addUltimaRaidEquipmentReportOpenMedia,
  createUltimaRaidEquipmentIncidentArchive,
  createUltimaRaidEquipmentIncidentReportEvidence,
  freezeUltimaRaidEquipmentIncidentEvidence,
  getUltimaRaidEquipmentIncidentMediaReason,
  recordUltimaRaidEquipmentIncidentFrame,
  recordUltimaRaidEquipmentPlaybackRequested,
  recordUltimaRaidEquipmentPlaybackTransition,
  type UltimaRaidEquipmentIncidentArchive,
  type UltimaRaidEquipmentIncidentMediaReason,
} from "./ultimaRaidEquipmentIncidentEvidence";

const imageDataUrl = "data:image/webp;base64,VUxUSU1B";

describe("ultimaRaidEquipmentIncidentEvidence", () => {
  it("keeps one minute of metadata and periodic images at twenty-second intervals", () => {
    let archive = createUltimaRaidEquipmentIncidentArchive(0);
    const state = createUltimaRaidEquipmentRuntimeState();

    for (let second = 0; second <= 65; second += 1) {
      const sampledAt = second * 1_000;
      const mediaReason = getUltimaRaidEquipmentIncidentMediaReason({
        archive,
        sampledAt,
        stateBefore: state,
        stateAfter: state,
        detected: false,
        shouldAlert: false,
      });
      archive = recordFrame({
        archive,
        sampledAt,
        stateBefore: state,
        stateAfter: state,
        mediaReason,
      });
    }

    expect(archive.frames).toHaveLength(61);
    expect(archive.frames[0]?.sampledAt).toBe(5_000);
    expect(archive.frames[archive.frames.length - 1]?.sampledAt).toBe(
      65_000,
    );
    expect(archive.media.map((entry) => entry.sampledAt)).toEqual([
      20_000,
      40_000,
      60_000,
    ]);
    expect(archive.droppedMediaCount).toBe(0);
  });

  it("caps images at four while retaining the alert neighborhood and latest frame", () => {
    let archive = createUltimaRaidEquipmentIncidentArchive(0);
    const state = createUltimaRaidEquipmentRuntimeState();
    const reasons: UltimaRaidEquipmentIncidentMediaReason[] = [
      "periodic",
      "signal-start",
      "alert",
      "after-event",
      "rearmed",
      "report-open-latest-runtime",
    ];

    reasons.forEach((reason, index) => {
      archive = recordFrame({
        archive,
        sampledAt: (index + 1) * 1_000,
        stateBefore: state,
        stateAfter: state,
        mediaReason: reason,
        shouldAlert: reason === "alert",
      });
    });

    expect(archive.media).toHaveLength(4);
    expect(archive.media.map((entry) => entry.reason)).toEqual([
      "signal-start",
      "alert",
      "after-event",
      "report-open-latest-runtime",
    ]);
    expect(archive.droppedMediaCount).toBe(2);
  });

  it("retains normalized count-row and warm-component positions for later troubleshooting", () => {
    const state = createUltimaRaidEquipmentRuntimeState();
    const archive = recordFrame({
      archive: createUltimaRaidEquipmentIncidentArchive(0),
      sampledAt: 1_000,
      stateBefore: state,
      stateAfter: state,
      detected: true,
    });

    expect(archive.frames[0]).toMatchObject({
      bagCountRowTopRatio: 0.43,
      bagCountRowHeightRatio: 0.26,
      largestBagWarmClusterXRatio: 0.41,
      largestBagWarmClusterYRatio: 0.52,
    });
  });

  it("binds the report-open image to the frame that produced the stored preview", () => {
    const state = createUltimaRaidEquipmentRuntimeState();
    let archive = createUltimaRaidEquipmentIncidentArchive(0);
    archive = recordFrame({
      archive,
      sampledAt: 1_000,
      stateBefore: state,
      stateAfter: state,
    });
    archive = recordFrame({
      archive,
      sampledAt: 2_000,
      stateBefore: state,
      stateAfter: state,
    });

    archive = addUltimaRaidEquipmentReportOpenMedia({
      previous: archive,
      capturedAt: 2_500,
      frameSampledAt: 1_000,
      dataUrl: imageDataUrl,
    });

    expect(archive.media[archive.media.length - 1]).toMatchObject({
      frameId: "ultima-raid-equipment-frame:1",
      sampledAt: 1_000,
      reason: "report-open-latest-runtime",
    });
    expect(archive.updatedAt).toBe(2_500);
  });

  it("selects the first unalerted full frame after rearming for a missing repeat", () => {
    const alerted = {
      ...createUltimaRaidEquipmentRuntimeState("alerted"),
      alertedForCurrentPresence: true,
      lastAlertedAt: 500,
    };
    const rearmed = createUltimaRaidEquipmentRuntimeState("waiting");
    const candidate = {
      ...createUltimaRaidEquipmentRuntimeState("candidate"),
      recentBagDetections: [true],
      confidence: 0.9,
      detectionSource: "bag-number" as const,
      lastDetectedAt: 2_000,
    };
    let archive = createUltimaRaidEquipmentIncidentArchive(0);
    archive = recordFrame({
      archive,
      sampledAt: 1_000,
      stateBefore: alerted,
      stateAfter: rearmed,
      detected: false,
      mediaReason: "rearmed",
    });
    archive = recordFrame({
      archive,
      sampledAt: 2_000,
      stateBefore: rearmed,
      stateAfter: candidate,
      detected: true,
      mediaReason: "signal-start",
    });

    const evidence = createUltimaRaidEquipmentIncidentReportEvidence({
      frozen: freezeUltimaRaidEquipmentIncidentEvidence({
        archive,
        frozenAt: 2_500,
      }),
      occurrence: "recent",
      scenario: "repeat-missing",
    });

    expect(evidence.selection.selectedFrameId).toBe(
      "ultima-raid-equipment-frame:2",
    );
    expect(evidence.selection.support).toBe("full");
  });

  it("selects the actual alert frame before a later non-alert detection", () => {
    const state = createUltimaRaidEquipmentRuntimeState();
    let archive = createUltimaRaidEquipmentIncidentArchive(0);
    archive = recordFrame({
      archive,
      sampledAt: 1_000,
      stateBefore: state,
      stateAfter: state,
      detected: true,
      shouldAlert: true,
      mediaReason: "alert",
    });
    archive = recordFrame({
      archive,
      sampledAt: 2_000,
      stateBefore: state,
      stateAfter: state,
      detected: true,
      mediaReason: "after-event",
    });

    const evidence = createUltimaRaidEquipmentIncidentReportEvidence({
      frozen: freezeUltimaRaidEquipmentIncidentEvidence({
        archive,
        frozenAt: 2_500,
      }),
      occurrence: "recent",
      scenario: "wrong-target",
    });

    expect(evidence.selection.selectedFrameId).toBe(
      "ultima-raid-equipment-frame:1",
    );
    expect(evidence.selection.selectedEventAt).toBe(1_000);
    expect(evidence.selection.policy).toBe(
      "ultima-raid-equipment-scenario-selection-v3",
    );
  });

  it("selects a retained boss signal for a not-recognized report instead of a later unreadable frame", () => {
    const state = createUltimaRaidEquipmentRuntimeState();
    let archive = createUltimaRaidEquipmentIncidentArchive(0);
    archive = recordFrame({
      archive,
      sampledAt: 1_000,
      stateBefore: state,
      stateAfter: state,
      bossDetected: true,
      mediaReason: "signal-start",
    });
    archive = recordFrame({
      archive,
      sampledAt: 2_000,
      stateBefore: state,
      stateAfter: state,
      bossDetected: false,
      mediaReason: "after-event",
    });

    const evidence = createUltimaRaidEquipmentIncidentReportEvidence({
      frozen: freezeUltimaRaidEquipmentIncidentEvidence({
        archive,
        frozenAt: 2_500,
      }),
      occurrence: "recent",
      scenario: "not-recognized",
      target: "boss",
    });

    expect(evidence.selection.selectedFrameId).toBe(
      "ultima-raid-equipment-frame:1",
    );
    expect(evidence.selection.selectedEventAt).toBe(1_000);
  });

  it("freezes completed playback evidence without later archive mutation", () => {
    const state = createUltimaRaidEquipmentRuntimeState();
    let archive = recordFrame({
      archive: createUltimaRaidEquipmentIncidentArchive(0),
      sampledAt: 1_000,
      stateBefore: state,
      stateAfter: state,
      shouldAlert: true,
      mediaReason: "alert",
    });
    const playback = recordUltimaRaidEquipmentPlaybackRequested({
      previous: archive,
      frameId: archive.frames[0]?.id ?? null,
      requestedAt: 1_000,
      soundId: "alarm",
      featureVolume: 0.8,
      masterVolume: 0.5,
      effectiveVolume: 0.4,
      kind: "repeat",
      cycleId: 500,
      repeatIndex: 2,
      repeatMaxCount: 3,
      repeatIntervalSeconds: 5,
    });
    archive = recordUltimaRaidEquipmentPlaybackTransition({
      previous: playback.archive,
      playbackId: playback.playbackId,
      status: "finished",
      occurredAt: 1_200,
    });
    const frozen = freezeUltimaRaidEquipmentIncidentEvidence({
      archive,
      frozenAt: 1_500,
    });

    archive.playbackAttempts[0]!.status = "failed";

    expect(frozen.archive.playbackAttempts[0]).toMatchObject({
      status: "finished",
      requestedAt: 1_000,
      finishedAt: 1_200,
      effectiveVolume: 0.4,
      kind: "repeat",
      cycleId: 500,
      repeatIndex: 2,
      repeatMaxCount: 3,
      repeatIntervalSeconds: 5,
    });
  });

  it("selects the repeated playback cycle for a repeat timing report", () => {
    const state = createUltimaRaidEquipmentRuntimeState();
    let archive = recordFrame({
      archive: createUltimaRaidEquipmentIncidentArchive(0),
      sampledAt: 1_000,
      stateBefore: state,
      stateAfter: state,
      detected: true,
      shouldAlert: true,
      mediaReason: "alert",
    });
    const initial = recordUltimaRaidEquipmentPlaybackRequested({
      previous: archive,
      frameId: archive.frames[0]?.id ?? null,
      requestedAt: 1_000,
      soundId: "alarm",
      featureVolume: 1,
      masterVolume: 1,
      effectiveVolume: 1,
      kind: "initial",
      cycleId: 1_000,
      repeatMaxCount: 2,
      repeatIntervalSeconds: 3,
    });
    archive = recordUltimaRaidEquipmentPlaybackTransition({
      previous: initial.archive,
      playbackId: initial.playbackId,
      status: "finished",
      occurredAt: 1_200,
    });
    const repeat = recordUltimaRaidEquipmentPlaybackRequested({
      previous: archive,
      frameId: archive.frames[0]?.id ?? null,
      requestedAt: 4_200,
      soundId: "alarm",
      featureVolume: 1,
      masterVolume: 1,
      effectiveVolume: 1,
      kind: "repeat",
      cycleId: 1_000,
      repeatIndex: 1,
      repeatMaxCount: 2,
      repeatIntervalSeconds: 3,
    });
    archive = recordUltimaRaidEquipmentPlaybackTransition({
      previous: repeat.archive,
      playbackId: repeat.playbackId,
      status: "finished",
      occurredAt: 4_400,
    });

    const evidence = createUltimaRaidEquipmentIncidentReportEvidence({
      frozen: freezeUltimaRaidEquipmentIncidentEvidence({
        archive,
        frozenAt: 5_000,
      }),
      occurrence: "recent",
      scenario: "repeat-timing",
    });

    expect(evidence.selection.selectedFrameId).toBe(
      "ultima-raid-equipment-frame:1",
    );
    expect(evidence.selection.playbackAttemptIds).toEqual([
      initial.playbackId,
      repeat.playbackId,
    ]);
    expect(evidence.playbackAttempts[1]).toMatchObject({
      kind: "repeat",
      cycleId: 1_000,
      repeatIndex: 1,
      repeatMaxCount: 2,
      repeatIntervalSeconds: 3,
      status: "finished",
    });
  });
});

function recordFrame({
  archive,
  sampledAt,
  stateBefore,
  stateAfter,
  detected = false,
  shouldAlert = false,
  bossDetected = false,
  bossShouldAlert = false,
  mediaReason = null,
}: {
  archive: UltimaRaidEquipmentIncidentArchive;
  sampledAt: number;
  stateBefore: UltimaRaidEquipmentRuntimeState;
  stateAfter: UltimaRaidEquipmentRuntimeState;
  detected?: boolean;
  shouldAlert?: boolean;
  bossDetected?: boolean;
  bossShouldAlert?: boolean;
  mediaReason?: UltimaRaidEquipmentIncidentMediaReason | null;
}) {
  return recordUltimaRaidEquipmentIncidentFrame({
    previous: archive,
    sampledAt,
    detectorVersion: "ultima-raid-inventory-full-v3",
    layoutKey: "1280x720",
    sourceDimensions: { width: 1280, height: 720 },
    sampledRegion: { x: 100, y: 100, width: 400, height: 180 },
    detection: {
      layoutValid: true,
      detected,
      confidence: detected ? 0.9 : 0.1,
      source: detected ? "bag-number" : "none",
      bagFullDetected: detected,
      bagWarmPixelCount: detected ? 24 : 0,
      bagForegroundPixelCount: 100,
      bagWarmPixelRatio: detected ? 0.24 : 0,
      largestBagWarmClusterSize: detected ? 20 : 0,
      largestBagWarmClusterXRatio: detected ? 0.41 : 0,
      largestBagWarmClusterYRatio: detected ? 0.52 : 0,
      bagCountRowTopRatio: 0.43,
      bagCountRowHeightRatio: 0.26,
      fullBannerDetected: false,
      largestBannerClusterSize: 0,
      bannerWidthRatio: 0,
      bannerHeightRatio: 0,
      bannerFillRatio: 0,
    },
    bossDetection: {
      detectorVersion: "ultima-raid-boss-progress-v1",
      progressState: bossDetected ? "boss" : "unreadable",
      bossBarDetected: bossDetected,
      normalBarDetected: false,
      bossBarPixelCount: bossDetected ? 1_100 : 0,
      bossBarWidthRatio: bossDetected ? 0.31 : 0,
      bossBarHeightRatio: bossDetected ? 0.065 : 0,
      bossBarFillRatio: bossDetected ? 0.86 : 0,
      normalBarPixelCount: 0,
      normalBarWidthRatio: 0,
    },
    shouldAlert,
    bossShouldAlert,
    stateBefore,
    stateAfter,
    mediaDataUrl: mediaReason ? imageDataUrl : null,
    mediaReason,
  });
}
