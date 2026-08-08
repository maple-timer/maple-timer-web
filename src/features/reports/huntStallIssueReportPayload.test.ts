import { describe, expect, it } from "vitest";
import type { HuntStallRuntimeState, HuntStallSnapshot } from "../../alertTypes";
import { createHuntStallRuntimeState } from "../../lib/huntStallRuntimeState";
import { createDefaultHuntStallAlert } from "../../lib/storage";
import { createHuntStallRuntimeTraceFrame } from "../alerts/runtime/huntStallSampleProcessorShared";
import {
  buildHuntStallDebugReportPayload,
  buildHuntStallIssueReportPayload,
} from "./alertReportPayloads";

describe("huntStallIssueReportPayload", () => {
  it("preserves runtime analysis failures in the current result and trace", () => {
    const state = createHuntStallRuntimeState();
    const runtimeFailure = {
      stage: "feature-analysis" as const,
      code: "feature-analysis-failed",
      technicalMessage: "worker channel closed",
      occurredAt: 10_000,
    };
    const payload = buildHuntStallIssueReportPayload({
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
      config: { ...createDefaultHuntStallAlert(), enabled: true },
      snapshot: {
        sampledAt: 10_000,
        mode: "manual-experience",
        rawPreviewUrl: "data:image/png;base64,raw",
        processedPreviewUrl: "data:image/png;base64,processed",
        regionLabel: "experience",
        recognizedText: null,
        confidence: 0,
        foregroundRatio: 0,
        changeScore: 0,
        runtimeFailure,
        runtimeTrace: [
          createHuntStallRuntimeTraceFrame({
            mode: "manual-experience",
            sampledAt: 10_000,
            shouldAlert: false,
            snapshot: null,
            state,
            runtimeFailure,
          }),
        ],
      },
      state,
      issue: { reason: "hunt-stall-reading", label: "판독이 이상해요" },
    });

    expect(payload.sample.result.runtimeFailure).toEqual(runtimeFailure);
    expect(payload.sample.runtimeTrace[0].runtimeFailure).toEqual(runtimeFailure);
  });

  it("includes hunt stall performance diagnostics in debug reports", () => {
    const snapshot: HuntStallSnapshot = {
      sampledAt: 55_000,
      rawPreviewUrl: "data:image/png;base64,raw",
      processedPreviewUrl: "data:image/png;base64,processed",
      fullFramePreviewUrl: "data:image/jpeg;base64,full",
      cropCandidates: [
        {
          label: "fixed-y-wide 1922x1119 #9",
          regionLabel: "634,1109 653x7",
          pixelRegion: { x: 634, y: 1109, width: 653, height: 7 },
          score: 105,
          selected: true,
          rawPreviewUrl: "data:image/png;base64,candidate-raw",
          processedPreviewUrl: "data:image/png;base64,candidate-processed",
          recognizedText: "1,530 [12.345%]",
          debugText: "candidate",
          confidence: 0.9,
          foregroundRatio: 0.07,
          barPercent: 12.345,
          barConfidence: 0.8,
          barCoverage: "partial_bar",
          performance: {
            totalMs: 6.2,
            frameReadMs: 1.1,
            ocrMs: 4.7,
            previewMs: 0.2,
          },
        },
      ],
      regionLabel: "634,1109 653x7",
      recognizedText: "1,530 [12.345%]",
      debugText: "debug",
      confidence: 0.9,
      foregroundRatio: 0.07,
      changeScore: 0.1,
      performance: {
        totalMs: 15.4,
        barEstimateMs: 2.1,
        candidateCount: 2,
        candidateMs: 13.2,
        selectedCandidateMs: 6.2,
        selectedFrameReadMs: 1.1,
        selectedOcrMs: 4.7,
        selectedPreviewMs: 0.2,
        fullFramePreviewMs: 1.6,
        loopMs: 17.5,
      },
    };
    const state: HuntStallRuntimeState = {
      status: "active",
      lastChangedAt: 1,
      lastSampledAt: 55_000,
      lastReadableAt: 55_000,
      lastReadFailureAt: null,
      unreadableSinceAt: null,
      alertedAt: null,
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 0,
      lastAlertedAt: null,
      stableSampleCount: 2,
      unchangedSeconds: 3,
      fingerprint: "1530",
      recognizedText: "1,530 [12.345%]",
      alertedRecognizedText: null,
      pendingRecognizedText: null,
      pendingRecognizedCount: 0,
      lastRejectedRecognizedText: null,
      lastReadFailureReason: null,
      lastDecision: "stable",
      hasObservedExperienceChange: true,
      hasObservedCooldownPresence: false,
      cooldownLastDetectedAt: null,
      cooldownMissingSinceAt: null,
      cooldownMissingSeconds: 0,
      cooldownConsecutiveReadableCount: 0,
      confidence: 0.9,
      changeScore: 0.1,
    };

    const payload = buildHuntStallDebugReportPayload({
      submittedAt: "2026-05-17T00:00:00.000Z",
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: {
        userAgent: "test",
        viewport: { width: 1280, height: 720 },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1922, height: 1119 },
        layoutKey: "1922x1119",
      },
      config: createDefaultHuntStallAlert(),
      snapshot,
      state,
    });

    expect(payload.reportContract).toEqual({
      schema: "maple-timer.alert-report",
      version: 1,
    });
    expect(payload.sample.result.performance).toMatchObject({
      totalMs: 15.4,
      selectedFrameReadMs: 1.1,
      selectedOcrMs: 4.7,
      loopMs: 17.5,
    });
    expect(payload.huntStall.lastSnapshot.performance).toMatchObject({
      totalMs: 15.4,
      selectedPreviewMs: 0.2,
    });
    expect(payload.huntStall.config).toMatchObject({
      mode: "manual-experience",
      cooldownRegion: null,
      cooldownMissingThresholdSeconds: expect.any(Number),
    });
    expect(payload.sample.cropCandidates[0].performance).toMatchObject({
      frameReadMs: 1.1,
      ocrMs: 4.7,
    });
  });

  it("preserves repeat scheduling and playback evidence for manual experience reports", () => {
    const state: HuntStallRuntimeState = {
      ...createHuntStallRuntimeState(),
      status: "alerted",
      lastChangedAt: 45_000,
      lastSampledAt: 55_000,
      lastReadableAt: 55_000,
      alertedAt: 50_000,
      lastRepeatedAlertAt: 54_000,
      repeatedAlertCount: 1,
      lastAlertedAt: 54_000,
      stableSampleCount: 8,
      unchangedSeconds: 10,
      fingerprint: "manual-repeat",
      recognizedText: "12.345%",
      alertedRecognizedText: "12.345%",
      lastDecision: "stable",
      hasObservedExperienceChange: true,
      confidence: 0.9,
      lastAlertPlayback: {
        status: "finished",
        cycleId: "50000",
        soundId: "test-sound",
        requestedAt: 53_000,
        startedAt: 53_050,
        finishedAt: 54_000,
        failedAt: null,
        error: null,
      },
    };
    const snapshot: HuntStallSnapshot = {
      sampledAt: 55_000,
      mode: "manual-experience",
      rawPreviewUrl: "data:image/png;base64,raw",
      processedPreviewUrl: "data:image/png;base64,processed",
      regionLabel: "manual",
      recognizedText: "12.345%",
      confidence: 0.9,
      foregroundRatio: 0.1,
      changeScore: 0,
      performance: null,
      runtimeTrace: [
        createHuntStallRuntimeTraceFrame({
          mode: "manual-experience",
          sampledAt: 55_000,
          shouldAlert: false,
          snapshot: null,
          state,
        }),
      ],
      cropHistory: [
        {
          sampledAt: 55_000,
          mode: "manual-experience",
          reasons: ["alert"],
          rawDataUrl: "data:image/png;base64,atomic-raw",
          processedDataUrl: "data:image/png;base64,atomic-processed",
          regionLabel: "manual",
          recognizedText: "12.345%",
          confidence: 0.9,
          foregroundRatio: 0.1,
          changeScore: 0,
          cooldownVisualChangeScore: null,
          cooldownVisualChanged: false,
          cooldownUsedVisualActivity: false,
          stateBefore: {
            status: "active",
            lastDecision: "stable",
            recognizedText: "12.345%",
            alertedRecognizedText: null,
            lastRejectedRecognizedText: null,
            lastReadFailureReason: null,
            unchangedSeconds: 9,
            cooldownMissingSeconds: 0,
            alertedAt: null,
          },
          stateAfter: {
            status: "alerted",
            lastDecision: "stable",
            recognizedText: "12.345%",
            alertedRecognizedText: "12.345%",
            lastRejectedRecognizedText: null,
            lastReadFailureReason: null,
            unchangedSeconds: 10,
            cooldownMissingSeconds: 0,
            alertedAt: 50_000,
          },
          state: {
            status: "alerted",
            lastDecision: "stable",
            recognizedText: "12.345%",
            alertedRecognizedText: "12.345%",
            lastRejectedRecognizedText: null,
            lastReadFailureReason: null,
            unchangedSeconds: 10,
            cooldownMissingSeconds: 0,
            alertedAt: 50_000,
          },
        },
      ],
    };
    const config = {
      ...createDefaultHuntStallAlert(),
      enabled: true,
      mode: "manual-experience" as const,
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 5,
      repeatAlertMaxCount: 3,
    };

    const payload = buildHuntStallIssueReportPayload({
      submittedAt: "2026-07-12T00:00:00.000Z",
      url: "https://maple-timer.com/",
      clientId: "client-repeat",
      viewportDiagnostics: {
        userAgent: "test",
        viewport: { width: 1280, height: 720 },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      config,
      snapshot,
      state,
      issue: {
        reason: "other",
        label: "기타",
        note: "반복 간격 확인",
      },
    });

    expect(payload.reportContract).toEqual({
      schema: "maple-timer.alert-report",
      version: 1,
    });
    expect(payload.incident.evidenceManifest.references.map((entry) => entry.id)).toEqual([
      "hunt-stall-source",
      "hunt-stall-trace",
      "hunt-stall-state-binding",
      "hunt-stall-decision",
      "hunt-stall-playback",
      "hunt-stall-config",
      "hunt-stall-runtime",
    ]);
    expect(payload.huntStall.config).toMatchObject({
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 5,
      repeatAlertMaxCount: 3,
    });
    expect(payload.sample.runtimeTrace[0]).toMatchObject({
      lastRepeatedAlertAt: 54_000,
      repeatedAlertCount: 1,
      lastAlertedAt: 54_000,
      lastAlertPlaybackStatus: "finished",
      lastAlertPlaybackRequestedAt: 53_000,
      lastAlertPlaybackStartedAt: 53_050,
      lastAlertPlaybackFinishedAt: 54_000,
    });
    expect(payload.incident).toMatchObject({
      evidence: { stateBinding: "before-after" },
      completeness: { stateBeforeAfter: true },
    });
  });

  it("serializes hunt stall cooldown-presence diagnostics in report payloads", () => {
    const payload = buildHuntStallDebugReportPayload({
      submittedAt: "2026-05-17T00:00:00.000Z",
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: {
        userAgent: "test",
        viewport: { width: 1280, height: 720 },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1922, height: 1119 },
        layoutKey: "1922x1119",
      },
      config: {
        ...createDefaultHuntStallAlert(),
        enabled: true,
        mode: "cooldown-presence",
        cooldownRegion: { x: 0.1, y: 0.2, width: 0.03, height: 0.04 },
        cooldownMissingThresholdSeconds: 15,
      },
      snapshot: {
        sampledAt: 55_000,
        mode: "cooldown-presence",
        rawPreviewUrl: "data:image/png;base64,cooldownRaw",
        processedPreviewUrl: "data:image/png;base64,cooldownProcessed",
        regionLabel: "34x34",
        recognizedText: "7",
        confidence: 0.92,
        foregroundRatio: 0.12,
        changeScore: 0,
        cooldownVisualChangeScore: 0.031,
        cooldownVisualChanged: true,
        cooldownUsedVisualActivity: true,
        performance: null,
        runtimeTrace: [
          {
            sampledAt: 54_000,
            mode: "cooldown-presence",
            status: "alerted",
            lastDecision: "cooldown-alerted",
            shouldAlert: true,
            recognizedText: "6",
            snapshotRecognizedText: null,
            alertedRecognizedText: "6",
            pendingRecognizedText: null,
            pendingRecognizedCount: 0,
            lastRejectedRecognizedText: null,
            lastReadFailureReason: "cooldown-empty",
            confidence: 0.1,
            foregroundRatio: 0.02,
            unchangedSeconds: 15,
            stableSampleCount: 0,
            lastChangedAt: 39_000,
            lastReadableAt: 53_000,
            lastReadFailureAt: 54_000,
            alertedAt: 54_000,
            hasObservedCooldownPresence: true,
            cooldownLastDetectedAt: 53_000,
            cooldownMissingSeconds: 1,
            cooldownConsecutiveReadableCount: 0,
            cooldownVisualChangeScore: 0,
            cooldownVisualChanged: false,
            cooldownUsedVisualActivity: false,
          },
        ],
        cropHistory: [
          {
            sampledAt: 54_000,
            mode: "cooldown-presence",
            reasons: ["alert"],
            rawDataUrl: "data:image/png;base64,historyRaw",
            processedDataUrl: "data:image/png;base64,historyProcessed",
            regionLabel: "34x34",
            recognizedText: null,
            debugText: "cooldown-empty",
            confidence: 0.1,
            foregroundRatio: 0.02,
            changeScore: 0,
            cooldownVisualChangeScore: 0,
            cooldownVisualChanged: false,
            cooldownUsedVisualActivity: false,
            stateBefore: {
              status: "watching",
              lastDecision: "cooldown-missing",
              recognizedText: "6",
              alertedRecognizedText: null,
              lastRejectedRecognizedText: null,
              lastReadFailureReason: "cooldown-empty",
              unchangedSeconds: 14,
              cooldownMissingSeconds: 1,
              alertedAt: null,
            },
            stateAfter: {
              status: "alerted",
              lastDecision: "cooldown-alerted",
              recognizedText: "6",
              alertedRecognizedText: "6",
              lastRejectedRecognizedText: null,
              lastReadFailureReason: "cooldown-empty",
              unchangedSeconds: 15,
              cooldownMissingSeconds: 1,
              alertedAt: 54_000,
            },
            state: {
              status: "alerted",
              lastDecision: "cooldown-alerted",
              recognizedText: "6",
              alertedRecognizedText: "6",
              lastRejectedRecognizedText: null,
              lastReadFailureReason: "cooldown-empty",
              unchangedSeconds: 15,
              cooldownMissingSeconds: 1,
              alertedAt: 54_000,
            },
          },
        ],
      },
      state: {
        status: "active",
        lastChangedAt: 55_000,
        lastSampledAt: 55_000,
        lastReadableAt: 55_000,
        lastReadFailureAt: null,
        unreadableSinceAt: null,
        alertedAt: null,
        lastRepeatedAlertAt: null,
        repeatedAlertCount: 0,
        lastAlertedAt: null,
        stableSampleCount: 2,
        unchangedSeconds: 0,
        fingerprint: null,
        recognizedText: "7",
        alertedRecognizedText: null,
        pendingRecognizedText: null,
        pendingRecognizedCount: 0,
        lastRejectedRecognizedText: null,
        lastReadFailureReason: null,
        lastDecision: "cooldown-readable",
        hasObservedExperienceChange: false,
        hasObservedCooldownPresence: true,
        cooldownLastDetectedAt: 55_000,
        cooldownMissingSinceAt: null,
        cooldownMissingSeconds: 0,
        cooldownConsecutiveReadableCount: 2,
        cooldownVisualFingerprint: "f".repeat(256),
        cooldownVisualChangeScore: 0.031,
        cooldownVisualChangedAt: 55_000,
        cooldownConsecutiveVisualActivityCount: 1,
        cooldownUsedVisualActivity: true,
        confidence: 0.92,
        changeScore: 0,
      },
    });

    expect(payload.sample).toMatchObject({
      mode: "cooldown-presence",
      rawDataUrl: "data:image/png;base64,cooldownRaw",
      processedDataUrl: "data:image/png;base64,cooldownProcessed",
      regionLabel: "34x34",
    });
    expect(payload.huntStall.config).toMatchObject({
      mode: "cooldown-presence",
      cooldownMissingThresholdSeconds: 15,
      cooldownRegion: { x: 0.1, y: 0.2, width: 0.03, height: 0.04 },
    });
    expect(payload.huntStall.lastSnapshot).toMatchObject({
      mode: "cooldown-presence",
      recognizedText: "7",
      cooldownVisualActivity: {
        changeScore: 0.031,
        changed: true,
        usedForActivity: true,
      },
      runtimeTraceFrameCount: 1,
      cropHistoryFrameCount: 1,
    });
    expect(payload.sample.runtimeTrace[0]).toMatchObject({
      sampledAt: 54_000,
      status: "alerted",
      lastDecision: "cooldown-alerted",
      shouldAlert: true,
    });
    expect(payload.sample.cropHistory[0]).toMatchObject({
      sampledAt: 54_000,
      reasons: ["alert"],
      rawDataUrl: "data:image/png;base64,historyRaw",
      processedDataUrl: "data:image/png;base64,historyProcessed",
      rawDataUrlOmitted: false,
      processedDataUrlOmitted: false,
      state: {
        status: "alerted",
        lastDecision: "cooldown-alerted",
      },
      stateBefore: {
        status: "watching",
        lastDecision: "cooldown-missing",
      },
      stateAfter: {
        status: "alerted",
        lastDecision: "cooldown-alerted",
      },
    });
    expect(payload.sample.result.cooldownVisualActivity).toMatchObject({
      changeScore: 0.031,
      changed: true,
      usedForActivity: true,
    });
  });

  it("omits oversized hunt stall crop history images from report payloads", () => {
    const oversizedRaw = `data:image/png;base64,${"a".repeat(30_001)}`;
    const oversizedProcessed = `data:image/png;base64,${"b".repeat(12_001)}`;
    const payload = buildHuntStallIssueReportPayload({
      submittedAt: "2026-05-17T00:00:00.000Z",
      url: "https://maple-timer.com/",
      clientId: "client-1",
      viewportDiagnostics: {
        userAgent: "test",
        viewport: { width: 1280, height: 720 },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1922, height: 1119 },
        layoutKey: "1922x1119",
      },
      config: {
        ...createDefaultHuntStallAlert(),
        enabled: true,
        mode: "cooldown-presence",
      },
      issue: {
        reason: "hunt-stall-reading",
        label: "쿨타임 판독이 이상해요",
      },
      snapshot: {
        sampledAt: 55_000,
        mode: "cooldown-presence",
        rawPreviewUrl: "data:image/png;base64,currentRaw",
        processedPreviewUrl: "data:image/png;base64,currentProcessed",
        regionLabel: "34x34",
        recognizedText: "7",
        confidence: 0.92,
        foregroundRatio: 0.12,
        changeScore: 0,
        performance: null,
        cropHistory: [
          {
            sampledAt: 54_000,
            mode: "cooldown-presence",
            reasons: ["interval"],
            rawDataUrl: oversizedRaw,
            processedDataUrl: oversizedProcessed,
            regionLabel: "34x34",
            recognizedText: "7",
            confidence: 0.92,
            foregroundRatio: 0.12,
            changeScore: 0,
            cooldownVisualChangeScore: null,
            cooldownVisualChanged: false,
            cooldownUsedVisualActivity: false,
            state: {
              status: "watching",
              lastDecision: "cooldown-arming",
              recognizedText: "7",
              alertedRecognizedText: null,
              lastRejectedRecognizedText: null,
              lastReadFailureReason: null,
              unchangedSeconds: 0,
              cooldownMissingSeconds: 0,
              alertedAt: null,
            },
          },
        ],
      },
      state: {
        status: "watching",
        lastChangedAt: 55_000,
        lastSampledAt: 55_000,
        lastReadableAt: 55_000,
        lastReadFailureAt: null,
        unreadableSinceAt: null,
        alertedAt: null,
        lastRepeatedAlertAt: null,
        repeatedAlertCount: 0,
        lastAlertedAt: null,
        stableSampleCount: 1,
        unchangedSeconds: 0,
        fingerprint: null,
        recognizedText: "7",
        alertedRecognizedText: null,
        pendingRecognizedText: null,
        pendingRecognizedCount: 0,
        lastRejectedRecognizedText: null,
        lastReadFailureReason: null,
        lastDecision: "cooldown-arming",
        hasObservedExperienceChange: false,
        hasObservedCooldownPresence: false,
        cooldownLastDetectedAt: 55_000,
        cooldownMissingSinceAt: null,
        cooldownMissingSeconds: 0,
        cooldownConsecutiveReadableCount: 1,
        confidence: 0.92,
        changeScore: 0,
      },
    });

    expect(payload.sample.cropHistory[0]).toMatchObject({
      rawDataUrl: null,
      processedDataUrl: null,
      rawDataUrlOmitted: true,
      processedDataUrlOmitted: true,
    });
    expect(payload.incident.completeness.stateBeforeAfter).toBe(false);
  });
});
