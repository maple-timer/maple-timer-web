import { describe, expect, it } from "vitest";
import { getCurrentRecognitionSources } from "../../recognition/runCurrentRecognition";
import { buildTroubleshooterViewModel } from "../buildTroubleshooterViewModel";

describe("ultimaRaidEquipmentAdapter", () => {
  it("separates stored recognition, confirmation, and playback evidence", () => {
    const view = buildTroubleshooterViewModel({
      id: "ultima-sample",
      body: {
        kind: "ultima-raid-equipment-issue",
        reportIssue: {
          reason: "ultima-raid-equipment-missed",
          label: "가방이 가득 찼는데 알림이 안 울려요",
        },
        sample: {
          ultimaRaidEquipmentEvidence: {
            schemaVersion: "ultima-raid-equipment-incident-evidence-v1",
            frozenAt: 3_000,
            selection: {
              support: "full",
              scenario: "playback-missing",
              selectedEventAt: 2_000,
              selectedFrameId: "ultima-raid-equipment-frame:2",
            },
            frames: [
              {
                id: "ultima-raid-equipment-frame:1",
                sampledAt: 1_000,
                detected: true,
                shouldAlert: false,
              },
              {
                id: "ultima-raid-equipment-frame:2",
                sampledAt: 2_000,
                detected: true,
                shouldAlert: true,
                confidence: 0.94,
                detectionSource: "bag-number",
                bagFullDetected: true,
                bagWarmPixelCount: 24,
                bagForegroundPixelCount: 100,
                bagReadablePixelCount: 112,
                bagWarmPixelRatio: 0.24,
                largestBagWarmClusterSize: 20,
                largestBagWarmClusterXRatio: 0.41,
                largestBagWarmClusterYRatio: 0.52,
                bagCountRowTopRatio: 0.43,
                bagCountRowHeightRatio: 0.26,
                fullBannerDetected: false,
                detectorVersion: "ultima-raid-inventory-full-v3",
              },
            ],
            media: [
              {
                id: "ultima-raid-equipment-media:2",
                frameId: "ultima-raid-equipment-frame:2",
                sampledAt: 2_000,
                reason: "alert",
                dataUrl: "data:image/webp;base64,VUxUSU1B",
              },
            ],
            playbackAttempts: [
              {
                id: "ultima-raid-equipment-playback:1",
                requestedAt: 2_000,
                status: "failed",
                error: "NotAllowedError",
              },
            ],
          },
        },
        ultimaRaidEquipment: {
          config: { enabled: true },
          state: { status: "alerted" },
        },
      },
    });

    expect(view.feature).toBe("ultima-raid-equipment");
    expect(view.evidence).toHaveLength(1);
    expect(view.evidence[0]).toMatchObject({
      group: "source",
      src: "data:image/webp;base64,VUxUSU1B",
      capturedAt: 2_000,
    });
    expect(
      view.stages.find((entry) => entry.id === "recognition"),
    ).toMatchObject({
      status: "complete",
      summary: "가방 숫자 신호 감지",
    });
    expect(
      view.stages.find((entry) => entry.id === "confirmation"),
    ).toMatchObject({
      status: "complete",
      summary: "알림 조건 충족",
    });
    expect(
      view.stages.find((entry) => entry.id === "recognition")?.metrics,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ultima-bag-warm-pixels",
          value: "24/100픽셀",
        }),
        expect.objectContaining({
          id: "ultima-bag-readable-pixels",
          value: "112픽셀",
        }),
        expect.objectContaining({
          id: "ultima-bag-warm-cluster",
          value: "20픽셀",
        }),
        expect.objectContaining({
          id: "ultima-bag-count-row",
          value: "43~69%",
        }),
        expect.objectContaining({
          id: "ultima-bag-warm-position",
          value: "가로 41% · 세로 52%",
        }),
      ]),
    );
    expect(view.stages.find((entry) => entry.id === "alert")).toMatchObject({
      status: "blocked",
      summary: "재생 실패 · NotAllowedError",
    });
    expect(view.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ultima-playback-missing",
          tone: "critical",
        }),
      ]),
    );
    const currentSources = getCurrentRecognitionSources(view);
    expect(currentSources).toEqual([
      expect.objectContaining({
        id: view.evidence[0]!.id,
        src: "data:image/webp;base64,VUxUSU1B",
      }),
    ]);
    expect(currentSources[0]?.frames).toBeUndefined();
  });

  it("explains when only the top banner was detected", () => {
    const view = buildTroubleshooterViewModel({
      id: "ultima-banner-only",
      body: {
        kind: "ultima-raid-equipment-issue",
        reportIssue: {
          reason: "ultima-raid-equipment-missed",
          scenario: "not-recognized",
        },
        sample: {
          ultimaRaidEquipmentEvidence: {
            schemaVersion: "ultima-raid-equipment-incident-evidence-v1",
            selection: {
              support: "full",
              scenario: "not-recognized",
              selectedFrameId: "ultima-raid-equipment-frame:1",
            },
            frames: [
              {
                id: "ultima-raid-equipment-frame:1",
                sampledAt: 1_000,
                detected: true,
                detectionSource: "full-banner",
                bagFullDetected: false,
                bagWarmPixelRatio: 0.18,
                fullBannerDetected: true,
                shouldAlert: false,
              },
            ],
            media: [],
            playbackAttempts: [],
          },
        },
        ultimaRaidEquipment: {
          config: { enabled: true },
          state: { status: "waiting" },
        },
      },
    });

    expect(
      view.stages.find((entry) => entry.id === "recognition"),
    ).toMatchObject({
      status: "warning",
      summary: "상단 안내만 감지",
    });
    expect(view.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ultima-bag-signal-missed",
          tone: "warning",
        }),
      ]),
    );
  });

  it("corrects a v1 false-alert selection to the frame that requested playback", () => {
    const view = buildTroubleshooterViewModel({
      id: "ultima-v1-wrong-target",
      body: {
        kind: "ultima-raid-equipment-issue",
        reportIssue: {
          reason: "ultima-raid-equipment-false-alert",
          scenario: "wrong-target",
        },
        sample: {
          ultimaRaidEquipmentEvidence: {
            schemaVersion: "ultima-raid-equipment-incident-evidence-v1",
            selection: {
              policy: "ultima-raid-equipment-scenario-selection-v1",
              support: "full",
              scenario: "wrong-target",
              selectedEventAt: 3_000,
              selectedFrameId: "ultima-raid-equipment-frame:3",
            },
            frames: [
              {
                id: "ultima-raid-equipment-frame:1",
                sampledAt: 1_000,
                detected: true,
                detectionSource: "bag-and-banner",
                bagFullDetected: true,
                fullBannerDetected: true,
                shouldAlert: true,
              },
              {
                id: "ultima-raid-equipment-frame:2",
                sampledAt: 2_000,
                detected: false,
                bagFullDetected: false,
                fullBannerDetected: false,
                shouldAlert: false,
              },
              {
                id: "ultima-raid-equipment-frame:3",
                sampledAt: 3_000,
                detected: true,
                detectionSource: "full-banner",
                bagFullDetected: false,
                fullBannerDetected: true,
                shouldAlert: false,
              },
            ],
            media: [],
            playbackAttempts: [
              {
                id: "ultima-raid-equipment-playback:1",
                frameId: "ultima-raid-equipment-frame:1",
                requestedAt: 1_000,
                finishedAt: 1_200,
                status: "finished",
              },
            ],
          },
        },
        ultimaRaidEquipment: {
          config: { enabled: true },
          state: { status: "waiting" },
        },
      },
    });

    expect(
      view.stages.find((entry) => entry.id === "recognition"),
    ).toMatchObject({
      status: "complete",
      summary: "가방 숫자 신호 감지",
    });
    expect(
      view.stages.find((entry) => entry.id === "confirmation"),
    ).toMatchObject({
      status: "complete",
      summary: "알림 조건 충족",
    });
    expect(view.stages.find((entry) => entry.id === "alert")).toMatchObject({
      status: "complete",
      summary: "재생 완료",
    });
    expect(view.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ultima-legacy-selection-corrected",
          tone: "info",
        }),
        expect.objectContaining({
          id: "ultima-false-positive",
          tone: "warning",
        }),
      ]),
    );
  });

  it("does not attribute playback from another frame to the selected incident", () => {
    const view = buildTroubleshooterViewModel({
      id: "ultima-unrelated-playback",
      body: {
        kind: "ultima-raid-equipment-issue",
        reportIssue: {
          reason: "ultima-raid-equipment-missed",
          scenario: "recognized-no-alert",
        },
        sample: {
          ultimaRaidEquipmentEvidence: {
            schemaVersion: "ultima-raid-equipment-incident-evidence-v1",
            selection: {
              policy: "ultima-raid-equipment-scenario-selection-v2",
              support: "partial",
              scenario: "recognized-no-alert",
              selectedEventAt: 2_000,
              selectedFrameId: "ultima-raid-equipment-frame:2",
            },
            frames: [
              {
                id: "ultima-raid-equipment-frame:1",
                sampledAt: 1_000,
                detected: true,
                bagFullDetected: true,
                shouldAlert: true,
              },
              {
                id: "ultima-raid-equipment-frame:2",
                sampledAt: 2_000,
                detected: true,
                bagFullDetected: true,
                shouldAlert: false,
              },
            ],
            media: [],
            playbackAttempts: [
              {
                id: "ultima-raid-equipment-playback:1",
                frameId: "ultima-raid-equipment-frame:1",
                requestedAt: 1_000,
                finishedAt: 1_200,
                status: "finished",
              },
            ],
          },
        },
        ultimaRaidEquipment: {
          config: { enabled: true },
          state: { status: "candidate" },
        },
      },
    });

    expect(view.stages.find((entry) => entry.id === "alert")).toMatchObject({
      status: "unavailable",
      summary: "기록 없음",
    });
  });

  it("keeps boss recognition, confirmation, and playback separate from equipment evidence", () => {
    const view = buildTroubleshooterViewModel({
      id: "ultima-boss-sample",
      body: {
        kind: "ultima-raid-boss-issue",
        reportIssue: {
          reason: "ultima-raid-boss-missed",
          scenario: "playback-missing",
        },
        sample: {
          ultimaRaidEquipmentEvidence: {
            schemaVersion: "ultima-raid-equipment-incident-evidence-v2",
            selection: {
              policy: "ultima-raid-equipment-scenario-selection-v2",
              support: "full",
              target: "boss",
              scenario: "playback-missing",
              selectedEventAt: 2_000,
              selectedFrameId: "ultima-raid-equipment-frame:2",
            },
            frames: [
              {
                id: "ultima-raid-equipment-frame:1",
                sampledAt: 1_000,
                detected: true,
                shouldAlert: true,
                bossProgressState: "normal",
                bossBarDetected: false,
                bossShouldAlert: false,
              },
              {
                id: "ultima-raid-equipment-frame:2",
                sampledAt: 2_000,
                detected: false,
                shouldAlert: false,
                bossProgressState: "boss",
                bossBarDetected: true,
                normalProgressBarDetected: false,
                bossBarWidthRatio: 0.96,
                bossBarFillRatio: 0.78,
                bossDetectorVersion: "ultima-raid-boss-progress-v1",
                bossShouldAlert: true,
              },
            ],
            media: [
              {
                id: "ultima-raid-equipment-media:2",
                frameId: "ultima-raid-equipment-frame:2",
                sampledAt: 2_000,
                reason: "alert",
                dataUrl: "data:image/webp;base64,Qk9TUw==",
              },
            ],
            playbackAttempts: [
              {
                id: "ultima-raid-equipment-playback:equipment",
                target: "equipment",
                frameId: "ultima-raid-equipment-frame:1",
                requestedAt: 1_000,
                status: "finished",
              },
              {
                id: "ultima-raid-equipment-playback:boss",
                target: "boss",
                frameId: "ultima-raid-equipment-frame:2",
                requestedAt: 2_000,
                status: "failed",
                error: "NotAllowedError",
              },
            ],
          },
        },
        ultimaRaidEquipment: {
          alertTarget: "boss",
          config: {
            enabled: false,
            bossAlert: { enabled: true },
          },
          state: {
            status: "paused",
            boss: { status: "active" },
          },
        },
      },
    });

    expect(view.featureLabel).toBe("울티마 스쿼드 보스 알림");
    expect(view.modeLabel).toBe("보스 등장 감지");
    expect(
      view.stages.find((entry) => entry.id === "recognition"),
    ).toMatchObject({
      status: "complete",
      summary: "보스 등장 진행 바 감지",
    });
    expect(
      view.stages.find((entry) => entry.id === "confirmation"),
    ).toMatchObject({
      status: "complete",
      summary: "알림 조건 충족",
    });
    expect(view.stages.find((entry) => entry.id === "alert")).toMatchObject({
      status: "blocked",
      summary: "재생 실패 · NotAllowedError",
    });
    expect(view.summaryMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ultima-playback",
          value: "재생 실패 · NotAllowedError",
        }),
      ]),
    );
    expect(view.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ultima-boss-playback-missing",
          tone: "critical",
        }),
      ]),
    );
  });

  it("explains the legacy startup suppression from report c8ef17e0", () => {
    const view = buildTroubleshooterViewModel({
      id: "c8ef17e0-4991-4384-8c99-3b87ec97763e",
      body: {
        kind: "ultima-raid-boss-issue",
        reportIssue: {
          reason: "ultima-raid-boss-missed",
          scenario: "not-recognized",
        },
        sample: {
          ultimaRaidEquipmentEvidence: {
            schemaVersion: "ultima-raid-equipment-incident-evidence-v2",
            selection: {
              policy: "ultima-raid-equipment-scenario-selection-v3",
              support: "full",
              target: "boss",
              scenario: "not-recognized",
              selectedEventAt: 1_000,
              selectedFrameId: "ultima-raid-equipment-frame:1",
            },
            frames: [
              {
                id: "ultima-raid-equipment-frame:1",
                sampledAt: 1_000,
                bossProgressState: "boss",
                bossBarDetected: true,
                bossShouldAlert: false,
                stateBefore: {
                  boss: {
                    status: "initializing",
                    armed: false,
                  },
                },
              },
              {
                id: "ultima-raid-equipment-frame:2",
                sampledAt: 2_000,
                bossProgressState: "boss",
                bossBarDetected: true,
                bossShouldAlert: false,
                stateBefore: {
                  boss: {
                    status: "active",
                    armed: false,
                  },
                },
              },
            ],
            media: [],
            playbackAttempts: [],
          },
        },
        ultimaRaidEquipment: {
          alertTarget: "boss",
          config: {
            enabled: true,
            bossAlert: { enabled: true },
          },
        },
      },
    });

    expect(
      view.stages.find((entry) => entry.id === "recognition"),
    ).toMatchObject({
      status: "complete",
      summary: "보스 등장 진행 바 감지",
    });
    expect(
      view.stages.find((entry) => entry.id === "confirmation"),
    ).toMatchObject({
      status: "warning",
      summary: "알림 조건 미충족",
    });
    expect(view.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ultima-boss-started-unarmed",
          tone: "critical",
        }),
      ]),
    );
  });

  it("does not replace an explicitly missing selected frame with the latest frame", () => {
    const view = buildTroubleshooterViewModel({
      id: "ultima-missing-selected-frame",
      body: {
        kind: "ultima-raid-boss-issue",
        reportIssue: {
          reason: "ultima-raid-boss-missed",
          scenario: "recognized-no-alert",
        },
        sample: {
          ultimaRaidEquipmentEvidence: {
            schemaVersion: "ultima-raid-equipment-incident-evidence-v2",
            selection: {
              policy: "ultima-raid-equipment-scenario-selection-v2",
              support: "partial",
              target: "boss",
              selectedFrameId: "missing-frame",
            },
            frames: [
              {
                id: "latest-unrelated-frame",
                sampledAt: 3_000,
                bossProgressState: "boss",
                bossShouldAlert: true,
              },
            ],
            media: [],
            playbackAttempts: [],
          },
        },
        ultimaRaidEquipment: {
          alertTarget: "boss",
        },
      },
    });

    expect(
      view.stages.find((entry) => entry.id === "recognition"),
    ).toMatchObject({
      status: "blocked",
      summary: "진행 바 확인 불가",
    });
    expect(
      view.stages.find((entry) => entry.id === "confirmation"),
    ).toMatchObject({
      summary: "알림 조건 미충족",
    });
  });

  it("shows the configured finite repeat and the failed repeat attempt", () => {
    const view = buildTroubleshooterViewModel({
      id: "ultima-repeat-failed",
      body: {
        kind: "ultima-raid-equipment-issue",
        reportIssue: {
          reason: "ultima-raid-equipment-missed",
          scenario: "repeat-timing",
        },
        sample: {
          ultimaRaidEquipmentEvidence: {
            schemaVersion: "ultima-raid-equipment-incident-evidence-v2",
            selection: {
              policy: "ultima-raid-equipment-scenario-selection-v2",
              support: "partial",
              target: "equipment",
              scenario: "repeat-timing",
              selectedFrameId: "ultima-raid-equipment-frame:1",
            },
            frames: [
              {
                id: "ultima-raid-equipment-frame:1",
                sampledAt: 1_000,
                detected: true,
                bagFullDetected: true,
                shouldAlert: true,
              },
            ],
            media: [],
            playbackAttempts: [
              {
                id: "ultima-raid-equipment-playback:old-repeat",
                target: "equipment",
                kind: "repeat",
                cycleId: 500,
                repeatIndex: 1,
                repeatMaxCount: 1,
                repeatIntervalSeconds: 2,
                frameId: "ultima-raid-equipment-frame:old",
                requestedAt: 700,
                finishedAt: 900,
                status: "finished",
              },
              {
                id: "ultima-raid-equipment-playback:1",
                target: "equipment",
                kind: "initial",
                cycleId: 1_000,
                frameId: "ultima-raid-equipment-frame:1",
                requestedAt: 1_000,
                finishedAt: 1_200,
                status: "finished",
                repeatMaxCount: 2,
                repeatIntervalSeconds: 3,
              },
              {
                id: "ultima-raid-equipment-playback:2",
                target: "equipment",
                kind: "repeat",
                cycleId: 1_000,
                repeatIndex: 1,
                repeatMaxCount: 2,
                repeatIntervalSeconds: 3,
                frameId: "ultima-raid-equipment-frame:1",
                requestedAt: 4_200,
                failedAt: 4_250,
                status: "failed",
                error: "NotAllowedError",
              },
            ],
          },
        },
        ultimaRaidEquipment: {
          config: {
            enabled: true,
            repeatAlertEnabled: true,
            repeatAlertIntervalSeconds: 5,
            repeatAlertMaxCount: 5,
          },
          state: { status: "alerted" },
        },
      },
    });

    expect(
      view.summaryMetrics.find(
        (entry) => entry.id === "ultima-repeat-playback",
      ),
    ).toMatchObject({
      value: "0/2회 완료 · 실패 1회 · 3초 간격",
    });
    expect(view.stages.find((entry) => entry.id === "alert")).toMatchObject({
      status: "blocked",
      summary: "반복 1/2회 · 재생 실패 · NotAllowedError",
    });
    expect(view.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ultima-repeat-incomplete",
          tone: "critical",
        }),
      ]),
    );
  });
});
