import { describe, expect, it } from "vitest";
import type { BuffExpirySnapshot } from "../../lib/buffExpiry/buffExpiryTypes";
import type {
  BuffExpiryPrecisionBestGroupCandidate,
  BuffExpiryPrecisionCountdownObservation,
  BuffExpiryPrecisionIconObservation,
} from "../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";
import { SUPPORTED_BUFF_EXPIRY_BUFF_IDS } from "../../lib/buffExpiry/buffExpiryCatalog";
import { BUFF_EXPIRY_PRECISION_TARGET_GROUPS } from "../../domain/buff-expiry/precisionTrackingPolicy";
import { createBuffExpiryRuntimeState } from "../../lib/buffExpiry/buffExpiryRuntimeState";
import { createDefaultBuffExpiryAlert } from "../../lib/storage";
import { buildBuffExpiryIssueReportPayload } from "./alertReportPayloads";

type BuffExpiryReportPayloadForTest = {
  kind: string;
  reportContract: { schema: string; version: number };
  schemaVersion?: number;
  incident: Record<string, any>;
  sample: Record<string, any>;
  buffExpiry: Record<string, any>;
};

describe("buffExpiryIssueReportPayload", () => {
  it("preserves post-parser runtime failures separately from zero detections", () => {
    const runtimeFailure = {
      stage: "feature-analysis" as const,
      code: "feature-analysis-failed",
      technicalMessage: "matcher worker failed",
      occurredAt: 10_000,
    };
    const snapshot: BuffExpirySnapshot = {
      sampledAt: 10_000,
      parserEngine: "dl",
      parserFallbackReason: null,
      roi: { x: 960, y: 0, width: 960, height: 486 },
      rawPreviewUrl: "data:image/png;base64,raw",
      processedPreviewUrl: null,
      fullFramePreviewUrl: null,
      boxes: [],
      acceptedMatches: [],
      rejectedMatches: [],
      tracks: [],
      pendingTracks: [],
      unsupportedReason: "matcher worker failed",
      performance: null,
      runtimeFailure,
    };
    const payload = buildBuffExpiryIssueReportPayload({
      submittedAt: "2026-07-19T00:00:00.000Z",
      url: "https://maple-timer.com/",
      clientId: "client-runtime-failure",
      viewportDiagnostics: {
        userAgent: "test",
        viewport: { width: 1280, height: 720 },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      config: { ...createDefaultBuffExpiryAlert(), enabled: true },
      snapshot,
      state: createBuffExpiryRuntimeState(),
      issue: { reason: "buff-expiry-missed", label: "알림이 안 울려요" },
    }) as BuffExpiryReportPayloadForTest;

    expect(payload.sample.result.runtimeFailure).toEqual(runtimeFailure);
    expect(payload.sample.result.detected).toBe(false);
  });

  it("includes buff expiry ROI, matches, tracks, and performance diagnostics", () => {
    const snapshot: BuffExpirySnapshot = {
      sampledAt: 55_000,
      roi: { x: 960, y: 0, width: 960, height: 486 },
      rawPreviewUrl: "data:image/png;base64,buff-roi",
      processedPreviewUrl: "data:image/png;base64,buff-annotated",
      fullFramePreviewUrl: "data:image/png;base64,full",
      boxes: [
        { x: 1600, y: 38, width: 34, height: 34, confidence: 0.97, side: 34 },
      ],
      acceptedMatches: [
        {
          box: { x: 1600, y: 38, width: 34, height: 34, confidence: 0.97, side: 34 },
          buffId: "exp_coupon",
          name: "경험치 쿠폰",
          seconds: 45,
          score: 0.99,
          buffMargin: 0.12,
          secondMargin: 0.04,
          reason: "accepted",
          strength: "strong",
          topMatches: [],
        },
      ],
      rejectedMatches: [
        {
          box: { x: 1620, y: 38, width: 34, height: 34, confidence: 0.95, side: 34 },
          candidateBuffId: "exp_coupon",
          candidateName: "경험치 쿠폰",
          candidateSeconds: 46,
          score: 0.91,
          reason: "low-score",
          topMatches: [],
        },
      ],
      tracks: [
        {
          id: "exp_coupon:55000:1600:38",
          buffId: "exp_coupon",
          name: "경험치 쿠폰",
          box: { x: 1600, y: 38, width: 34, height: 34, confidence: 0.97, side: 34 },
          detectedSeconds: 45,
          detectedAt: 55_000,
          expiresAt: 100_000,
          lastSeenAt: 55_000,
          alertedAt: null,
          score: 0.99,
        },
      ],
      pendingTracks: [],
      unsupportedReason: null,
      performance: {
        totalMs: 8.4,
        detectMs: 3.2,
        normalizeAndMatchMs: 4.9,
        boxCount: 1,
        acceptedMatchCount: 1,
        activeSampleCount: 228,
      },
      debugDetectionHistory: [
        {
          sampledAt: 54_000,
          boxCount: 1,
          acceptedMatchCount: 0,
          boxes: [
            {
              box: { x: 1600, y: 38, width: 34, height: 34, confidence: 0.97, side: 34 },
              previewDataUrl: "data:image/png;base64,normalized-box",
              acceptedMatch: null,
              rejectedMatch: {
                box: { x: 1600, y: 38, width: 34, height: 34, confidence: 0.97, side: 34 },
                candidateBuffId: "exp_coupon",
                candidateName: "경험치 쿠폰",
                candidateSeconds: 46,
                score: 0.91,
                reason: "low-score",
                topMatches: [],
              },
              topMatches: [],
            },
          ],
          performance: null,
        },
      ],
      runtimeTrace: [
        {
          sampledAt: 54_500,
          status: "tracking",
          boxCount: 2,
          acceptedMatchCount: 1,
          acceptedMatches: [
            {
              box: { x: 1600, y: 38, width: 34, height: 34, confidence: 0.97, side: 34 },
              buffId: "exp_coupon",
              name: "경험치 쿠폰",
              seconds: 45,
              score: 0.99,
              buffMargin: 0.12,
              secondMargin: 0.04,
              reason: "accepted",
              strength: "strong",
              topMatches: [
                {
                  buffId: "exp_coupon",
                  name: "경험치 쿠폰",
                  kind: "countdown",
                  seconds: 45,
                  file: "exp_coupon_45.png",
                  score: 0.99,
                  distance: 0.01,
                  timerPixels: 42,
                  digitPixels: 18,
                },
              ],
            },
          ],
          rejectedMatches: [
            {
              box: { x: 1620, y: 38, width: 34, height: 34, confidence: 0.95, side: 34 },
              candidateBuffId: "exp_coupon",
              candidateName: "경험치 쿠폰",
              candidateSeconds: 46,
              score: 0.91,
              reason: "low-score",
              topMatches: [],
            },
          ],
          tracks: [],
          pendingTracks: [],
          shouldAlert: false,
          alertedTrackIds: [],
          unsupportedReason: null,
          performance: null,
        },
      ],
      alertDecisionHistory: [
        {
          sampledAt: 70_000,
          alertLeadSeconds: 30,
          shouldAlert: false,
          reason: "existing-alert-group",
          dueTracks: [
            {
              id: "exp_coupon:55000:1600:38",
              buffId: "exp_coupon",
              name: "경험치 쿠폰",
              slotKey: "pos:202:7",
              remainingSeconds: 30,
              expiresAt: 100_000,
              alertedAt: null,
            },
          ],
          newAlertTrackIds: [],
          suppressedTrackIds: ["exp_coupon:55000:1600:38"],
          deferredTrackIds: [],
          markedTrackIds: ["exp_coupon:55000:1600:38"],
          dueGroupExpiresAt: null,
          nearestExistingAlertGroup: {
            trackId: "union_wealth:42000:1568:38",
            buffId: "union_wealth",
            name: "유니온의 부",
            expiresAt: 99_000,
            alertedAt: 69_000,
            distanceMs: 1_000,
          },
        },
      ],
      iconEvidence: [
        {
          sampledAt: 54_700,
          source: "near-miss",
          slotKey: "1620:38:34:34",
          buffId: "exp_coupon",
          name: "경험치 쿠폰",
          seconds: 46,
          score: 0.91,
          reason: "low-score",
          box: { x: 1620, y: 38, width: 34, height: 34, confidence: 0.95, side: 34 },
          topMatches: [46, 45, 44, 43].map((seconds, index) => ({
            buffId: "exp_coupon",
            name: "경험치 쿠폰",
            kind: "countdown",
            seconds,
            file: `exp_coupon_${seconds}.png`,
            score: 0.91 - index * 0.01,
            distance: 0.09 + index * 0.01,
            timerPixels: 40,
            digitPixels: 18,
          })),
          normalizedIconDataUrl: "data:image/png;base64,normalized-evidence",
        },
      ],
    };

    const state = {
      ...createBuffExpiryRuntimeState(),
      status: "tracking" as const,
      tracks: snapshot.tracks,
      lastSampledAt: 55_000,
      lastDetectedAt: 55_000,
      boxCount: 1,
      acceptedMatchCount: 1,
      performance: snapshot.performance,
    };

    const payload = buildBuffExpiryIssueReportPayload({
      submittedAt: "2026-05-17T00:00:00.000Z",
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: {
        userAgent: "test",
        viewport: { width: 1280, height: 720 },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      config: createDefaultBuffExpiryAlert(),
      snapshot,
      state,
      issue: {
        reason: "buff-expiry-missed",
        label: "버프가 꺼졌는데 알림이 안 울려요",
      },
    }) as BuffExpiryReportPayloadForTest;

    expect(payload.reportContract).toEqual({
      schema: "maple-timer.alert-report",
      version: 1,
    });
    expect(
      payload.incident.evidenceManifest.references.map((entry: any) => entry.id),
    ).toEqual([
      "buff-expiry-source",
      "buff-expiry-trace",
      "buff-expiry-state-binding",
      "buff-expiry-decision",
      "buff-expiry-playback",
      "buff-expiry-config",
      "buff-expiry-runtime",
    ]);
    expect(payload.kind).toBe("buff-expiry-issue");
    expect(payload.sample).toMatchObject({
      rawDataUrl: "data:image/png;base64,buff-roi",
      processedDataUrl: "data:image/png;base64,buff-annotated",
      fullFrameDataUrl: "data:image/png;base64,full",
      roi: { x: 960, y: 0, width: 960, height: 486 },
      result: {
        value: "경험치 쿠폰",
        confidence: null,
        detected: true,
        candidateCount: 1,
      },
    });
    expect(payload.sample.acceptedMatches).toBeUndefined();
    expect(payload.sample.rejectedMatches).toBeUndefined();
    expect(payload.sample.debugDetectionHistory).toBeUndefined();
    expect(payload.sample.iconEvidence).toBeUndefined();
    expect(payload.sample.next).toMatchObject({
      parser: {
        boxCount: 1,
        displayBoxCount: 1,
      },
      identity: {
        observations: [],
        targetObservations: [],
      },
      countdown: {
        recognizedCount: 0,
        targetRecognizedCount: 0,
      },
      tracking: {
        tracks: [
          {
            id: "exp_coupon:55000:1600:38",
            buffId: "exp_coupon",
            name: "경험치 쿠폰",
          },
        ],
        pendingTracks: [],
      },
    });
    expect(payload.sample.alertDecisionHistory?.[0]).toMatchObject({
      sampledAt: 70_000,
      alertLeadSeconds: 30,
      shouldAlert: false,
      reason: "existing-alert-group",
      dueTracks: [
        {
          id: "exp_coupon:55000:1600:38",
          buffId: "exp_coupon",
          remainingSeconds: 30,
          expiresAt: 100_000,
        },
      ],
      suppressedTrackIds: ["exp_coupon:55000:1600:38"],
      markedTrackIds: ["exp_coupon:55000:1600:38"],
      nearestExistingAlertGroup: {
        trackId: "union_wealth:42000:1568:38",
        distanceMs: 1_000,
      },
    });
    expect(payload.sample.alertTimingDiagnostics).toMatchObject({
      alertLeadSeconds: 20,
      sampledAt: 55_000,
      runtimeStatus: "tracking",
      trackCount: 1,
      unalertedTrackCount: 1,
      dueTrackCount: 0,
      overdueTrackCount: 0,
      nextAlertAt: 80_000,
      nextAlertInMs: 25_000,
      nextAlertTrack: {
        id: "exp_coupon:55000:1600:38",
        buffId: "exp_coupon",
        remainingSeconds: 45,
        expiresAt: 100_000,
      },
      latestAlertDecision: {
        sampledAt: 70_000,
        shouldAlert: false,
        reason: "existing-alert-group",
        dueTrackCount: 1,
      },
    });
    expect(JSON.stringify(payload.sample.runtimeTrace)).not.toContain("exp_coupon_45.png");
    expect(JSON.stringify(payload.sample.runtimeTrace)).not.toContain("previewDataUrl");
    expect(payload.buffExpiry.lastSnapshot).toMatchObject({
      boxCount: 1,
      targetObservationCount: 0,
      countdownObservationCount: 0,
      runtimeTraceFrameCount: 1,
      alertDecisionCount: 1,
      alertTimingDiagnostics: {
        nextAlertAt: 80_000,
        nextAlertInMs: 25_000,
      },
      performance: {
        totalMs: 8.4,
        activeSampleCount: 228,
      },
    });
    expect(payload.buffExpiry.summary).toMatchObject({
      enabled: false,
      runtimeStatus: "tracking",
      snapshotBoxCount: 1,
      snapshotDisplayBoxCount: 1,
      targetObservationCount: 0,
      countdownObservationCount: 0,
      trackCount: 1,
      pendingTrackCount: 0,
      alertTimingDiagnostics: {
        trackCount: 1,
        unalertedTrackCount: 1,
        nextAlertAt: 80_000,
      },
    });
    expect(payload.buffExpiry.state).toMatchObject({
      status: "tracking",
      acceptedMatchCount: 1,
    });
    expect(payload.buffExpiry.config).toMatchObject({
      supportedBuffIds: [...SUPPORTED_BUFF_EXPIRY_BUFF_IDS],
      selectedBuffIds: [...SUPPORTED_BUFF_EXPIRY_BUFF_IDS],
      selectedPrecisionTargetGroups: [...BUFF_EXPIRY_PRECISION_TARGET_GROUPS],
    });
  });

  it("keeps precision buff expiry issue reports separate from legacy matcher payload fields", () => {
    const nextCountdown: BuffExpiryPrecisionCountdownObservation = {
      kind: "exact",
      text: "41",
      totalSeconds: 41,
      format: "seconds",
      textRegion: "center",
      confidence: 0.96,
      status: "high",
      routerTarget: "center",
      routerConfidence: 0.97,
      routerStatus: "ready",
    };
    const nextBox = {
      x: 1600,
      y: 38,
      size: 32,
      row: 0,
      col: 11,
      confidence: 0.94,
      score: 1.42,
    };
    const buffBox = {
      x: nextBox.x,
      y: nextBox.y,
      width: nextBox.size,
      height: nextBox.size,
      confidence: nextBox.confidence,
      side: nextBox.size,
      row: nextBox.row,
      col: nextBox.col,
    };
    const nextObservation: BuffExpiryPrecisionIconObservation = {
      id: "r0:c11",
      boxIndex: 11,
      box: nextBox,
      identity: {
        kind: "target",
        group: "potion",
        score: 2.35,
        margin: 1.12,
        bundleId: "buff-group-potion-deep-v1",
        modelVersion: "potion-20260711-v1",
        gateScore: 0.97,
        gateMargin: 0.04,
        decisionReason: "target_accepted",
        bestTargetName: "potion",
        bestExcludedName: null,
        candidates: [
          {
            group: "potion",
            bundleId: "buff-group-potion-deep-v1",
            modelVersion: "potion-20260711-v1",
            accepted: true,
            score: 2.35,
            threshold: 1.23,
            margin: 1.12,
            gateScore: 0.97,
            gateThreshold: 0.93,
            gateMargin: 0.04,
            decisionReason: "target_accepted",
          },
        ],
      },
      countdown: nextCountdown,
    };
    const nextBestByGroup: BuffExpiryPrecisionBestGroupCandidate = {
      group: "potion",
      boxIndex: 11,
      box: nextBox,
      accepted: true,
      matcherAccepted: true,
      winningGroup: "potion",
      score: 2.35,
      margin: 1.12,
      bundleId: "buff-group-potion-deep-v1",
      modelVersion: "potion-20260711-v1",
      gateScore: 0.97,
      gateMargin: 0.04,
      decisionReason: "target_accepted",
      countdown: nextCountdown,
    };
    const nextModuleVersions = {
      runtime: "buff-expiry-precision-runtime-v3",
      parser: "buff-icon-parser-v1",
      matcher: "buff-group-bundle-v1",
      matcherModel: "buff-group-bundles-20260711",
      matcherBundles: [
        {
          group: "potion" as const,
          bundleId: "buff-group-potion-deep-v1",
          modelVersion: "potion-20260711-v1",
        },
      ],
      countdown: "center-roi-ocr-v4",
      localizer: "buff-slot-cluster-localizer-v1",
    };
    const snapshot: BuffExpirySnapshot = {
      sampledAt: 84_000,
      roi: { x: 960, y: 0, width: 960, height: 486 },
      rawPreviewUrl: "data:image/png;base64,next-roi",
      processedPreviewUrl: "data:image/png;base64,next-annotated",
      fullFramePreviewUrl: "data:image/png;base64,next-full",
      boxes: [buffBox],
      displayBoxes: [buffBox],
      boxPreviewUrls: {
        "1600:38:32:32": "data:image/png;base64,next-icon",
      },
      nextIconObservations: [nextObservation],
      nextBestByGroup: [nextBestByGroup],
      nextModuleVersions,
      nextBuffSlotLocalization: {
        version: "buff-slot-cluster-localizer-v1",
        status: "selected",
        reason: "source-edge-anchor",
        parserBoxCount: 4,
        parserRowCount: 3,
        localizedBoxCount: 1,
        localizedRowCount: 1,
        spatialExcludedBoxCount: 3,
      },
      acceptedMatches: [
        {
          box: buffBox,
          buffId: "legacy_should_not_leak",
          name: "legacy should not leak",
          seconds: 41,
          score: 0.99,
          buffMargin: 0.1,
          secondMargin: 0.1,
          reason: "legacy",
          strength: "strong",
          topMatches: [],
        },
      ],
      rejectedMatches: [
        {
          box: buffBox,
          candidateBuffId: "legacy_rejected_should_not_leak",
          candidateName: "legacy rejected should not leak",
          candidateSeconds: 42,
          score: 0.8,
          reason: "legacy-rejected",
          topMatches: [],
        },
      ],
      tracks: [
        {
          id: "next:potion:r0:c11",
          buffId: "next:potion",
          name: "비약",
          box: buffBox,
          detectedSeconds: 41,
          detectedAt: 84_000,
          expiresAt: 125_000,
          lastSeenAt: 84_000,
          alertedAt: null,
          score: 2.35,
        },
      ],
      pendingTracks: [
        {
          id: "next:unionWealth:r0:c10",
          buffId: "next:unionWealth",
          name: "유니온의 부",
          box: { ...buffBox, x: 1568, col: 10 },
          firstSeenAt: 83_000,
          lastSeenAt: 84_000,
          observations: [
            {
              seconds: 40,
              observedAt: 84_000,
              score: 1.9,
              strength: "strong",
              reason: "linear-v1-target",
            },
          ],
          score: 1.9,
        },
      ],
      unsupportedReason: null,
      performance: {
        totalMs: 11.4,
        detectMs: 3.3,
        normalizeAndMatchMs: 0,
        countdownMs: 4.1,
        countdownCount: 1,
        countdownModelStatus: "ready",
        boxCount: 1,
        acceptedMatchCount: 0,
        activeSampleCount: 0,
      },
      debugDetectionHistory: [
        {
          sampledAt: 83_000,
          boxCount: 1,
          acceptedMatchCount: 1,
          boxes: [],
          performance: null,
        },
      ],
      runtimeTrace: [
        {
          sampledAt: 84_000,
          status: "tracking",
          boxCount: 1,
          acceptedMatchCount: 1,
          acceptedMatches: [],
          rejectedMatches: [],
          tracks: [],
          pendingTracks: [],
          shouldAlert: false,
          alertedTrackIds: [],
          next: {
            targetObservationCount: 1,
            countdownObservationCount: 1,
            bestByGroup: [
              {
                group: "potion",
                boxIndex: 11,
                accepted: true,
                winningGroup: "potion",
                score: 2.35,
                margin: 1.12,
                decisionReason: "linear-v1-target",
                countdownText: "41",
                countdownSeconds: 41,
                countdownStatus: "high",
              },
            ],
            targetObservations: [
              {
                boxIndex: 11,
                group: "potion",
                score: 2.35,
                margin: 1.12,
                decisionReason: "linear-v1-target",
                countdownText: "41",
                countdownSeconds: 41,
                countdownStatus: "high",
              },
            ],
            moduleVersions: nextModuleVersions,
          },
          unsupportedReason: null,
          performance: null,
        },
      ],
      alertDecisionHistory: [
        {
          sampledAt: 105_000,
          alertLeadSeconds: 20,
          shouldAlert: true,
          reason: "new-alert-group",
          dueTracks: [
            {
              id: "next:potion:r0:c11",
              buffId: "next:potion",
              name: "비약",
              slotKey: "r0:c11",
              remainingSeconds: 20,
              expiresAt: 125_000,
              alertedAt: null,
            },
          ],
          newAlertTrackIds: ["next:potion:r0:c11"],
          suppressedTrackIds: [],
          deferredTrackIds: [],
          markedTrackIds: ["next:potion:r0:c11"],
          dueGroupExpiresAt: 125_000,
          nearestExistingAlertGroup: null,
        },
      ],
      lastAlertEvidence: {
        alertedAt: 105_000,
        alertLeadSeconds: 20,
        clusterId: "next-cluster:125",
        dueAt: 105_000,
        triggeredTracks: [
          {
            id: "next:potion:r0:c11",
            buffId: "next:potion",
            name: "비약",
            box: buffBox,
            expiresAt: 125_000,
            remainingSeconds: 20,
            normalizedIconDataUrl: "data:image/png;base64,next-icon",
          },
        ],
      },
      iconEvidence: [
        {
          sampledAt: 84_000,
          source: "near-miss",
          slotKey: "legacy-evidence",
          buffId: "legacy_evidence_should_not_leak",
          name: "legacy evidence should not leak",
          seconds: 41,
          score: 0.99,
          reason: "legacy",
          box: buffBox,
          topMatches: [],
          normalizedIconDataUrl: "data:image/png;base64,legacy-evidence",
        },
      ],
    };
    const state = {
      ...createBuffExpiryRuntimeState(),
      status: "tracking" as const,
      tracks: snapshot.tracks,
      pendingTracks: snapshot.pendingTracks,
      confirmationCandidateCount: 1,
      lastSampledAt: 84_000,
      lastDetectedAt: 84_000,
      boxCount: 1,
      acceptedMatchCount: 0,
      performance: snapshot.performance,
    };

    const payload = buildBuffExpiryIssueReportPayload({
      submittedAt: "2026-05-17T00:00:00.000Z",
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: {
        userAgent: "test",
        viewport: { width: 1280, height: 720 },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      config: {
        ...createDefaultBuffExpiryAlert(),
        enabled: true,
        alertLeadSeconds: 20,
      },
      snapshot,
      state,
      runtimeEvidence: {
        source: {
          kind: "buff-slot-top-right-quadrant-v1",
          parserInputMode: "topRightQuadrant",
          coordinateSpace: "capture-pixels",
          sourceSize: { width: 1920, height: 1080 },
          roi: { x: 960, y: 0, width: 960, height: 540 },
          dataUrl: "data:image/png;base64,runtime-buff-roi",
        },
        parser: {
          engine: "dl",
          version: "buff-slot-parser-dl-v2",
          fallbackReason: null,
        },
      },
      issue: {
        reason: "other",
        label: "기타",
      },
    }) as BuffExpiryReportPayloadForTest;

    expect(payload.kind).toBe("buff-expiry-issue");
    expect(payload.schemaVersion).toBe(2);
    expect(payload.sample).toMatchObject({
      source: {
        parserInputMode: "topRightQuadrant",
        dataUrl: "data:image/png;base64,runtime-buff-roi",
      },
      parser: {
        engine: "dl",
        version: "buff-slot-parser-dl-v2",
        fallbackReason: null,
      },
      rawDataUrl: null,
      processedDataUrl: null,
      fullFrameDataUrl: null,
    });
    expect(payload.buffExpiry.config).toMatchObject({
      alertLeadSeconds: 20,
    });
    expect(payload.sample.next.moduleVersions).toEqual(nextModuleVersions);
    expect(payload.sample.next.parser.localization).toEqual(
      snapshot.nextBuffSlotLocalization,
    );
    expect(payload.sample.runtimeTrace[0]).toMatchObject({
      sampledAt: 84_000,
      next: {
        targetObservationCount: 1,
        countdownObservationCount: 1,
        moduleVersions: nextModuleVersions,
      },
    });
    expect(payload.sample.next.identity.targetObservations[0]).toMatchObject({
      identity: {
        kind: "target",
        group: "potion",
        bundleId: "buff-group-potion-deep-v1",
        modelVersion: "potion-20260711-v1",
        gateMargin: 0.04,
        decisionReason: "target_accepted",
      },
      countdown: {
        text: "41",
        totalSeconds: 41,
      },
    });
    expect(payload.sample.next.identity.groupSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: "potion",
          targetCount: 1,
          countdownCount: 1,
        }),
      ]),
    );
    expect(payload.sample.next.countdown).toMatchObject({
      recognizedCount: 1,
      targetRecognizedCount: 1,
    });
    expect(payload.sample.next.iconEvidence[0]).toMatchObject({
      roles: expect.arrayContaining(["target-observation", "best-by-group", "tracked"]),
      group: "potion",
      bundleId: "buff-group-potion-deep-v1",
      modelVersion: "potion-20260711-v1",
      gateMargin: 0.04,
      decisionReason: "target_accepted",
      countdownText: "41",
      normalizedIconDataUrl: "data:image/png;base64,next-icon",
    });
    expect(payload.sample.lastAlertEvidence).toMatchObject({
      alertedAt: 105_000,
      alertLeadSeconds: 20,
      clusterId: "next-cluster:125",
      dueAt: 105_000,
      triggeredTracks: [
        {
          id: "next:potion:r0:c11",
          buffId: "next:potion",
          name: "비약",
          remainingSeconds: 20,
          normalizedIconDataUrl: "data:image/png;base64,next-icon",
        },
      ],
    });
    expect(payload.buffExpiry.next).toMatchObject({
      parserBoxCount: 4,
      localizedBoxCount: 1,
      spatialExcludedBoxCount: 3,
      identityObservationCount: 1,
      targetObservationCount: 1,
      countdownObservationCount: 1,
      bestByGroupCount: 1,
      iconEvidenceCount: 2,
    });
    expect(payload.buffExpiry.summary.buffSlotLocalization).toEqual(
      snapshot.nextBuffSlotLocalization,
    );
    expect(payload.buffExpiry.summary.lastAlertEvidence).toMatchObject({
      alertedAt: 105_000,
      alertLeadSeconds: 20,
      triggeredTrackCount: 1,
    });
    expect(JSON.stringify(payload)).not.toContain("legacy_should_not_leak");
    expect(JSON.stringify(payload)).not.toContain("legacy_rejected_should_not_leak");
    expect(JSON.stringify(payload)).not.toContain("legacy_evidence_should_not_leak");
  });
});
