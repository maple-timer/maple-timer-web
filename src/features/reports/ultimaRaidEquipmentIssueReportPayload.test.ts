import { describe, expect, it } from "vitest";
import { createDefaultUltimaRaidEquipmentAlert } from "../../lib/storage";
import {
  createUltimaRaidEquipmentIncidentArchive,
  createUltimaRaidEquipmentIncidentReportEvidence,
  freezeUltimaRaidEquipmentIncidentEvidence,
  recordUltimaRaidEquipmentIncidentFrame,
  recordUltimaRaidEquipmentPlaybackRequested,
  recordUltimaRaidEquipmentPlaybackTransition,
} from "../../runtime/ultima-raid-equipment/evidence/ultimaRaidEquipmentIncidentEvidence";
import {
  createUltimaRaidEquipmentRuntimeState,
} from "../../runtime/ultima-raid-equipment/ultimaRaidEquipmentAlertState";
import { buildUltimaRaidEquipmentIssueReportPayload } from "./alertReportPayloads";

describe("ultimaRaidEquipmentIssueReportPayload", () => {
  it("packages frozen runtime decisions, media, and playback under the alert-report contract", () => {
    const before = {
      ...createUltimaRaidEquipmentRuntimeState("candidate"),
      recentBagDetections: [true],
    };
    const after = {
      ...createUltimaRaidEquipmentRuntimeState("alerted"),
      recentBagDetections: [true, true],
      alertedForCurrentPresence: true,
      confidence: 0.94,
      bagWarmPixelRatio: 0.22,
      detectionSource: "bag-number" as const,
      lastDetectedAt: 2_000,
      lastAlertedAt: 2_000,
    };
    let archive = recordUltimaRaidEquipmentIncidentFrame({
      previous: createUltimaRaidEquipmentIncidentArchive(0),
      sampledAt: 2_000,
      detectorVersion: "ultima-raid-inventory-full-v5",
      layoutKey: "1920x1080",
      sourceDimensions: { width: 1920, height: 1080 },
      sampledRegion: { x: 200, y: 100, width: 640, height: 280 },
      detection: {
        layoutValid: true,
        detected: true,
        confidence: 0.94,
        source: "bag-number",
        bagCountState: "full",
        bagCountReadable: true,
        bagCountOccluded: false,
        bagFullDetected: true,
        bagWarmPixelCount: 24,
        bagForegroundPixelCount: 100,
        bagWarmPixelRatio: 0.24,
        largestBagWarmClusterSize: 20,
        largestBagWarmClusterWidth: 4,
        largestBagWarmClusterHeight: 6,
        bagWarmComponentValid: true,
        bagWarmComponentTouchesBoundary: false,
        fullBannerDetected: false,
        largestBannerClusterSize: 0,
        bannerWidthRatio: 0,
        bannerHeightRatio: 0,
        bannerFillRatio: 0,
      },
      shouldAlert: true,
      stateBefore: before,
      stateAfter: after,
      mediaDataUrl: "data:image/webp;base64,VUxUSU1B",
      mediaReason: "alert",
    });
    const playback = recordUltimaRaidEquipmentPlaybackRequested({
      previous: archive,
      frameId: archive.frames[0]!.id,
      requestedAt: 2_000,
      soundId: "alarm",
      featureVolume: 0.8,
      masterVolume: 0.5,
      effectiveVolume: 0.4,
      kind: "repeat",
      cycleId: 2_000,
      repeatIndex: 1,
      repeatMaxCount: 3,
      repeatIntervalSeconds: 3,
    });
    archive = recordUltimaRaidEquipmentPlaybackTransition({
      previous: playback.archive,
      playbackId: playback.playbackId,
      status: "finished",
      occurredAt: 2_250,
    });
    const incidentEvidence =
      createUltimaRaidEquipmentIncidentReportEvidence({
        frozen: freezeUltimaRaidEquipmentIncidentEvidence({
          archive,
          frozenAt: 2_500,
        }),
        occurrence: "recent",
        scenario: "playback-missing",
      });

    const payload = buildUltimaRaidEquipmentIssueReportPayload({
      submittedAt: "2026-07-26T10:00:00.000Z",
      url: "https://maple-timer.com/",
      clientId: "client-ultima",
      viewportDiagnostics: {
        userAgent: "test",
        viewport: { width: 1440, height: 900 },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      config: {
        ...createDefaultUltimaRaidEquipmentAlert(),
        enabled: true,
        repeatAlertEnabled: true,
        repeatAlertIntervalSeconds: 3,
        repeatAlertMaxCount: 3,
      },
      state: after,
      snapshot: null,
      incidentEvidence,
      issue: {
        reason: "ultima-raid-equipment-missed",
        label: "가방이 가득 찼는데 알림이 안 울려요",
        scenario: "playback-missing",
        scenarioLabel: "알림 처리됐다고 나오지만 소리가 안 났어요",
        occurrence: "recent",
      },
    });

    expect(payload.reportContract).toEqual({
      schema: "maple-timer.alert-report",
      version: 1,
    });
    expect(payload.kind).toBe("ultima-raid-equipment-issue");
    expect(payload.incident).toMatchObject({
      feature: "ultima-raid-equipment",
      scenario: "playback-missing",
      occurrence: "recent",
      evidence: {
        source: "runtime-atomic",
        frameCount: 1,
        mediaCount: 1,
        stateBinding: "before-after",
      },
      correlation: {
        frameIds: ["ultima-raid-equipment-frame:1"],
        playbackIds: ["ultima-raid-equipment-playback:1"],
      },
      completeness: {
        sourceImage: true,
        stateBeforeAfter: true,
        decision: true,
        playback: true,
      },
    });
    expect(payload.sample).toMatchObject({
      sampledAt: 2_000,
      result: {
        value: "full",
        detected: true,
        candidateCount: 1,
        confidence: 0.94,
        bagCountState: "full",
        bagCountReadable: true,
        bagCountOccluded: false,
        bagFullDetected: true,
        bagWarmPixelRatio: 0.24,
        fullBannerDetected: false,
        shouldAlert: true,
      },
      ultimaRaidEquipmentEvidence: {
        schemaVersion: "ultima-raid-equipment-incident-evidence-v2",
        frames: [
          {
            bagCountState: "full",
            bagCountReadable: true,
            bagCountOccluded: false,
            largestBagWarmClusterWidth: 4,
            largestBagWarmClusterHeight: 6,
            bagWarmComponentValid: true,
            bagWarmComponentTouchesBoundary: false,
          },
        ],
        media: [
          {
            frameId: "ultima-raid-equipment-frame:1",
            reason: "alert",
          },
        ],
        playbackAttempts: [
          {
            status: "finished",
            effectiveVolume: 0.4,
            kind: "repeat",
            cycleId: 2_000,
            repeatIndex: 1,
            repeatMaxCount: 3,
            repeatIntervalSeconds: 3,
          },
        ],
      },
    });
    expect(payload.ultimaRaidEquipment.config).toMatchObject({
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: 3,
      bossAlert: {
        repeatAlertEnabled: false,
        repeatAlertIntervalSeconds: 3,
        repeatAlertMaxCount: 3,
      },
    });
    expect(
      payload.incident.evidenceManifest.references.map((entry) => entry.id),
    ).toEqual([
      "ultima-raid-equipment-source",
      "ultima-raid-equipment-trace",
      "ultima-raid-equipment-state",
      "ultima-raid-equipment-decision",
      "ultima-raid-equipment-playback",
      "ultima-raid-equipment-config",
      "ultima-raid-equipment-runtime",
    ]);
  });

  it("packages boss progress, confirmation, and playback as a separate report target", () => {
    const base = createUltimaRaidEquipmentRuntimeState("waiting");
    const before = {
      ...base,
      boss: {
        ...base.boss,
        status: "candidate" as const,
        armed: true,
        recentBossDetections: [true],
      },
    };
    const after = {
      ...base,
      boss: {
        ...base.boss,
        status: "active" as const,
        armed: true,
        encounterActive: true,
        recentBossDetections: [true, true],
        lastDetectedAt: 4_000,
        lastAlertedAt: 4_000,
      },
    };
    let archive = recordUltimaRaidEquipmentIncidentFrame({
      previous: createUltimaRaidEquipmentIncidentArchive(0),
      sampledAt: 4_000,
      detectorVersion: "ultima-raid-inventory-full-v3",
      layoutKey: "1920x1080",
      sourceDimensions: { width: 1920, height: 1080 },
      sampledRegion: { x: 200, y: 100, width: 640, height: 280 },
      detection: {
        layoutValid: true,
        detected: false,
        confidence: 0,
        source: "none",
        bagFullDetected: false,
        bagWarmPixelCount: 0,
        bagForegroundPixelCount: 0,
        bagWarmPixelRatio: 0,
        largestBagWarmClusterSize: 0,
        fullBannerDetected: false,
        largestBannerClusterSize: 0,
        bannerWidthRatio: 0,
        bannerHeightRatio: 0,
        bannerFillRatio: 0,
      },
      bossDetection: {
        detectorVersion: "ultima-raid-boss-progress-v1",
        progressState: "boss",
        bossBarDetected: true,
        normalBarDetected: false,
        bossBarPixelCount: 640,
        bossBarWidthRatio: 0.96,
        bossBarHeightRatio: 0.4,
        bossBarFillRatio: 0.78,
        normalBarPixelCount: 0,
        normalBarWidthRatio: 0,
      },
      shouldAlert: false,
      bossShouldAlert: true,
      stateBefore: before,
      stateAfter: after,
      mediaDataUrl: "data:image/webp;base64,Qk9TUw==",
      mediaReason: "alert",
    });
    const playback = recordUltimaRaidEquipmentPlaybackRequested({
      previous: archive,
      frameId: archive.frames[0]!.id,
      requestedAt: 4_000,
      soundId: "boss-alarm",
      featureVolume: 0.7,
      masterVolume: 0.5,
      effectiveVolume: 0.35,
      target: "boss",
    });
    archive = recordUltimaRaidEquipmentPlaybackTransition({
      previous: playback.archive,
      playbackId: playback.playbackId,
      status: "finished",
      occurredAt: 4_200,
    });
    const incidentEvidence =
      createUltimaRaidEquipmentIncidentReportEvidence({
        frozen: freezeUltimaRaidEquipmentIncidentEvidence({
          archive,
          frozenAt: 4_500,
        }),
        occurrence: "recent",
        scenario: "playback-missing",
        target: "boss",
      });

    const payload = buildUltimaRaidEquipmentIssueReportPayload({
      submittedAt: "2026-07-26T10:00:00.000Z",
      url: "https://maple-timer.com/",
      clientId: "client-boss",
      viewportDiagnostics: {
        userAgent: "test",
        viewport: { width: 1440, height: 900 },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      config: {
        ...createDefaultUltimaRaidEquipmentAlert(),
        bossAlert: {
          ...createDefaultUltimaRaidEquipmentAlert().bossAlert,
          enabled: true,
        },
      },
      state: after,
      snapshot: null,
      incidentEvidence,
      target: "boss",
      issue: {
        reason: "ultima-raid-boss-missed",
        label: "보스가 등장했는데 알림이 안 울려요",
        scenario: "playback-missing",
        scenarioLabel: "알림 처리됐다고 나오지만 소리가 안 났어요",
        occurrence: "recent",
      },
    });

    expect(payload.kind).toBe("ultima-raid-boss-issue");
    expect(payload.reportIssue.affectedTarget).toEqual({
      id: "boss",
      label: "보스 등장",
    });
    expect(payload.sample).toMatchObject({
      result: {
        value: "boss",
        detected: true,
        detectionSource: "boss-progress-bar",
        detectorVersion: "ultima-raid-boss-progress-v1",
        bossProgressState: "boss",
        bossBarDetected: true,
        bossBarWidthRatio: 0.96,
        bossBarFillRatio: 0.78,
        shouldAlert: true,
      },
      ultimaRaidEquipmentEvidence: {
        selection: {
          target: "boss",
        },
        playbackAttempts: [
          {
            target: "boss",
            status: "finished",
          },
        ],
      },
    });
    expect(payload.ultimaRaidEquipment).toMatchObject({
      alertTarget: "boss",
      state: {
        boss: {
          status: "active",
          lastAlertedAt: 4_000,
        },
      },
    });
  });
});
