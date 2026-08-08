import { describe, expect, it } from "vitest";
import type { SkillSnapshot } from "../../alertTypes";
import { createSkill } from "../../lib/profileFactory";
import { createRuntimeState } from "../../lib/timer";
import { freezeSkillIncidentEvidence } from "../../runtime/skill-alert/evidence/skillIncidentEvidenceArchive";
import { createSkillIncidentReportEvidence } from "../../runtime/skill-alert/evidence/skillIncidentReportEvidence";
import {
  createSkillIncidentRuntimeRecorder,
  recordSkillIncidentPlaybackRequested,
  recordSkillIncidentSample,
} from "../../runtime/skill-alert/evidence/skillIncidentRuntimeRecorder";
import type { SkillReportIncidentSelection } from "../../runtime/skill-alert/evidence/skillIncidentEvidenceSelection";
import type { SkillIncidentRuntimeState } from "../../runtime/skill-alert/evidence/skillIncidentEvidenceTypes";
import { buildSkillIssueReportPayload } from "./alertReportPayloads";

describe("skillIssueReportPayload", () => {
  it("preserves quick-slot runtime failures in the report payload", () => {
    const skill = createSkill({ id: "skill-runtime-failure", name: "테스트 스킬" });
    const state = createRuntimeState(skill.id);
    const runtimeFailure = {
      stage: "recognizer" as const,
      code: "recognizer-failed",
      technicalMessage: "session crashed",
      occurredAt: 10_000,
    };
    const payload = buildSkillIssueReportPayload({
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
      skill,
      currentRegion: skill.region,
      snapshot: {
        sampledAt: 10_000,
        rawPreviewUrl: "data:image/png;base64,raw",
        previewUrl: "data:image/png;base64,processed",
        regionLabel: "32x32",
        result: {
          value: null,
          confidence: 0,
          debug: { reason: "recognizer-failed" },
        },
        runtimeFailure,
      },
      state,
      estimatedRemainingSeconds: null,
      alertInSeconds: null,
      timeline: {
        samples: [
          {
            sampledAt: 10_000,
            ocrValue: null,
            confidence: 0,
            recognizedText: null,
            reason: "recognizer-failed",
            digitCount: null,
            foregroundRatio: null,
            statusBefore: "idle",
            statusAfter: "detecting",
            observedRemainingSeconds: null,
            estimatedRemainingSeconds: null,
            alertThresholdSeconds: skill.alertThresholdSeconds,
            alertInSeconds: null,
            estimatedExpiresAt: null,
            rejectedReading: null,
            pendingShortAnchorCount: null,
            shouldFireAlert: false,
            shouldRepeatAlert: false,
            alertDecision: null,
            runtimeFailure,
          },
        ],
        alertEvents: [],
        frames: [
          {
            sampledAt: 10_000,
            reasons: ["runtime-failure"],
            rawDataUrl: "data:image/png;base64,frame-raw",
            processedDataUrl: "data:image/png;base64,frame-processed",
            recognition: {
              value: null,
              confidence: 0,
              reason: "recognizer-failed",
            },
            decision: null,
            stateBefore: {
              status: "idle",
              observedRemainingSeconds: null,
              observedRemainingCount: null,
              estimatedExpiresAt: null,
              alertedAt: null,
              lastRepeatedAlertAt: null,
              repeatedAlertCount: 0,
              rejectedReading: null,
            },
            stateAfter: {
              status: "detecting",
              observedRemainingSeconds: null,
              observedRemainingCount: null,
              estimatedExpiresAt: null,
              alertedAt: null,
              lastRepeatedAlertAt: null,
              repeatedAlertCount: 0,
              rejectedReading: null,
            },
          },
        ],
      },
      issue: { reason: "skill-not-detected", label: "감지되지 않아요" },
    });

    expect(payload.sample.result.runtimeFailure).toEqual(runtimeFailure);
    expect(payload.skill.lastSnapshot.runtimeFailure).toEqual(runtimeFailure);
    expect(payload.skill.runtimeTimeline.samples[0].runtimeFailure).toEqual(
      runtimeFailure,
    );
    expect(payload.incident).toMatchObject({
      evidence: {
        source: "runtime-atomic",
        sampledAt: 10_000,
        stateBinding: "before-after",
      },
      completeness: {
        sourceImage: true,
        stateBeforeAfter: true,
        decision: true,
      },
    });
    expect(payload.skill.runtimeTimeline.frames[0]).toMatchObject({
      reasons: ["runtime-failure"],
      stateBefore: { status: "idle" },
      stateAfter: { status: "detecting" },
    });
  });

  it("includes skill timing diagnostics for mid-cycle alert setting reports", () => {
    const skill = createSkill({
      id: "skill-1",
      name: "솔 야누스 : 새벽",
      alertThresholdSeconds: 10,
      recognitionStartSeconds: 55,
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 5,
    });
    const state = {
      ...createRuntimeState(skill.id),
      status: "alerted" as const,
      observedRemainingSeconds: 58,
      observedAt: 1_000,
      estimatedExpiresAt: 59_000,
      alertedAt: 50_000,
      lastRepeatedAlertAt: 52_000,
      lastAlertCycleStartedAt: 1_000,
      rejectedReading: 8,
      pendingShortAnchor: {
        observedRemainingSeconds: 12,
        maxObservedRemainingSeconds: 12,
        observedAt: 48_000,
        estimatedExpiresAt: 60_000,
        count: 1,
      },
      confidence: 0.91,
    };
    const snapshot: SkillSnapshot = {
      sampledAt: 55_000,
      rawPreviewUrl: "data:image/png;base64,raw",
      previewUrl: "data:image/png;base64,processed",
      regionLabel: "36x36",
      result: {
        value: 8,
        confidence: 0.77,
        debug: {
          recognizedText: "8",
          foregroundRatio: 0.12,
          reason: "ok",
        },
      },
    };

    const payload = buildSkillIssueReportPayload({
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
      skill,
      currentRegion: skill.region,
      snapshot,
      state,
      estimatedRemainingSeconds: 4,
      alertInSeconds: 0,
      timeline: {
        samples: [
          {
            sampledAt: 54_000,
            ocrValue: 9,
            confidence: 0.7,
            recognizedText: "9",
            reason: null,
            digitCount: 1,
            foregroundRatio: 0.11,
            statusBefore: "running",
            statusAfter: "running",
            observedRemainingSeconds: 58,
            estimatedRemainingSeconds: 5,
            alertThresholdSeconds: 10,
            alertInSeconds: 0,
            estimatedExpiresAt: 59_000,
            rejectedReading: null,
            pendingShortAnchorCount: null,
            shouldFireAlert: false,
            shouldRepeatAlert: false,
            alertDecision: null,
          },
        ],
        alertEvents: [
          {
            startedAt: 50_000,
            alertCycleStartedAt: 50_000,
            soundId: skill.soundId,
            status: "finished",
            finishedAt: 51_200,
            failedAt: null,
            error: null,
          },
        ],
      },
      issue: {
        reason: "skill-alert-timing",
        label: "알림 시점이나 반복이 이상해요",
      },
    });

    expect(payload.reportContract).toEqual({
      schema: "maple-timer.alert-report",
      version: 1,
    });
    expect(payload.incident.evidenceManifest.references.map((entry) => entry.id)).toEqual([
      "skill-source",
      "skill-trace",
      "skill-state-binding",
      "skill-decision",
      "skill-playback",
      "skill-config",
      "skill-runtime",
    ]);
    expect(payload.appBuild).toEqual(
      expect.objectContaining({
        name: "maple-timer",
        shortCommit: expect.any(String),
      }),
    );
    expect(payload.skill.config).toMatchObject({
      alertThresholdSeconds: 10,
      recognitionStartSeconds: 55,
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 5,
    });
    expect(payload.skill.runtimeDiagnostics).toMatchObject({
      status: "alerted",
      observedRemainingSeconds: 58,
      estimatedRemainingSeconds: 4,
      alertThresholdSeconds: 10,
      alertInSeconds: 0,
      alertedAt: 50_000,
      lastRepeatedAlertAt: 52_000,
      pendingShortAnchor: {
        observedRemainingSeconds: 12,
        count: 1,
      },
      rejectedReading: 8,
      lastReading: {
        value: 8,
        confidence: 0.77,
        sampledAt: 55_000,
      },
    });
    expect(payload.skill.runtimeDiagnostics.lastReading.debug).toMatchObject({
      recognizedText: "8",
      foregroundRatio: 0.12,
      reason: "ok",
    });
    expect(payload.skill.runtimeTimeline.samples).toHaveLength(1);
    expect(payload.skill.runtimeTimeline.samples[0]).toMatchObject({
      ocrValue: 9,
      estimatedRemainingSeconds: 5,
      alertDecision: null,
    });
    expect(payload.skill.runtimeTimeline.alertEvents[0]).toMatchObject({
      status: "finished",
      soundId: skill.soundId,
    });
  });

  it("includes Sol Janus buff-slot candidate icons for matcher troubleshooting", () => {
    const skill = createSkill({
      id: "skill-buff-duration",
      name: "솔 야누스 : 새벽",
      presetId: "sol-janus-dawn-2min",
      detectionSource: "buff-duration",
    });
    const snapshot: SkillSnapshot = {
      sampledAt: 20_000,
      rawPreviewUrl: null,
      previewUrl: null,
      regionLabel: "24개 버프칸",
      result: {
        value: null,
        confidence: 0.431,
        debug: {
          reason: "buff-duration-janus-dawn-searching",
        },
      },
      buffDuration: {
        detected: false,
        boxCount: 24,
        parserRowCount: 1,
        parserEngine: "rule",
        parserVersion: "test-rule-v1",
        parserFallbackReason: "dl-init-failed",
        detectedCount: 0,
        displayStatus: "checking",
        displayLastSeenAt: 18_000,
        matcherEngine: "skill-bundle-v1",
        bundleId: "skill-deep-v2",
        modelVersion: "shared-test-v2",
        baseSkillId: "janus",
        rawSkillId: "janus",
        score: 1.2,
        threshold: -0.3,
        margin: 1.5,
        gateScore: 0.92,
        gateThreshold: 0.95,
        gateMargin: -0.03,
        decisionReason: "positive_gate_below_threshold",
        countdown: null,
        countdownModelStatus: "ready",
        performanceMs: 8.4,
        error: null,
        candidateIcons: [
          {
            boxIndex: 7,
            box: {
              x: 1280,
              y: 36,
              size: 32,
              confidence: 0.91,
              score: 0.88,
            },
            match: {
              matched: false,
              skillId: "janus",
              displayName: "야누스",
              detectorId: "500001002",
              matcherEngine: "skill-bundle-v1",
              bundleId: "skill-deep-v2",
              modelVersion: "shared-test-v2",
              baseSkillId: "janus",
              rawSkillId: "janus",
              score: 1.2,
              threshold: -0.3,
              margin: 1.5,
              gateScore: 0.92,
              gateThreshold: 0.95,
              gateMargin: -0.03,
              decisionReason: "positive_gate_below_threshold",
            },
            countdown: {
              kind: "exact",
              text: "41",
              totalSeconds: 41,
              format: "seconds",
              textRegion: "center",
              confidence: 0.93,
              status: "high",
              routerTarget: "center",
              routerConfidence: 0.95,
              routerStatus: "high",
            },
            imageDataUrl: "data:image/png;base64,buff-slot",
          },
        ],
      },
    };

    const payload = buildSkillIssueReportPayload({
      submittedAt: "2026-06-14T00:00:00.000Z",
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
      skill,
      currentRegion: null,
      snapshot,
      state: createRuntimeState(skill.id),
      estimatedRemainingSeconds: null,
      alertInSeconds: null,
      runtimeEvidence: {
        sampledAt: 20_000,
        source: {
          kind: "buff-slot-top-right-quadrant-v1",
          parserInputMode: "topRightQuadrant",
          coordinateSpace: "capture-pixels",
          sourceSize: { width: 1920, height: 1080 },
          roi: { x: 960, y: 0, width: 960, height: 540 },
          dataUrl: "data:image/png;base64,runtime-source",
        },
        parser: {
          engine: "rule",
          version: "test-rule-v1",
          fallbackReason: "dl-init-failed",
        },
      },
      issue: {
        reason: "skill-missed",
        label: "감지가 안돼요",
      },
    });

    expect(payload.skill.config).toMatchObject({
      presetId: "sol-janus-dawn-deep-v2",
      detectionSource: "buff-duration",
    });
    expect(payload.sample.buffDuration).toMatchObject({
      detected: false,
      boxCount: 24,
      parserRowCount: 1,
      parserEngine: "rule",
      parserVersion: "test-rule-v1",
      parserFallbackReason: "dl-init-failed",
      detectedCount: 0,
      displayStatus: "checking",
      displayLastSeenAt: 18_000,
      performanceMs: 8.4,
      countdownModelStatus: "ready",
      matcherEngine: "skill-bundle-v1",
      bundleId: "skill-deep-v2",
      modelVersion: "shared-test-v2",
      baseSkillId: "janus",
      gateScore: 0.92,
      gateThreshold: 0.95,
      gateMargin: -0.03,
      decisionReason: "positive_gate_below_threshold",
      candidateIcons: [
        {
          name: "야누스 후보",
          boxIndex: 7,
          imageDataUrl: "data:image/png;base64,buff-slot",
          countdown: {
            text: "41",
            totalSeconds: 41,
            status: "high",
          },
          match: {
            matched: false,
            matcherEngine: "skill-bundle-v1",
            bundleId: "skill-deep-v2",
            modelVersion: "shared-test-v2",
            baseSkillId: "janus",
            score: 1.2,
            gateScore: 0.92,
            gateThreshold: 0.95,
            gateMargin: -0.03,
            decisionReason: "positive_gate_below_threshold",
          },
        },
      ],
    });
    expect(payload.sample.source).toMatchObject({
      kind: "buff-slot-top-right-quadrant-v1",
      parserInputMode: "topRightQuadrant",
      roi: { x: 960, y: 0, width: 960, height: 540 },
    });
    expect(payload.sample.parser).toEqual({
      engine: "rule",
      version: "test-rule-v1",
      fallbackReason: "dl-init-failed",
    });
    expect(payload.sample.rawDataUrl).toBeNull();
  });

  it("normalizes buff-slot-only Hologram Graffiti reports as buff-duration payloads", () => {
    const skill = createSkill({
      id: "skill-hologram",
      presetId: "hologram-graffiti-barrier-vi",
      detectionSource: undefined,
    });
    const snapshot: SkillSnapshot = {
      sampledAt: 20_000,
      rawPreviewUrl: "data:image/png;base64,buff-slot-quadrant",
      previewUrl: "data:image/png;base64,hologram-icon",
      regionLabel: "24개 버프칸",
      result: {
        value: 18,
        confidence: 0.94,
        debug: {
          reason: "buff-duration-countdown-detected",
        },
      },
      buffDuration: {
        detected: true,
        boxCount: 24,
        detectedCount: 1,
        displayStatus: "detected",
        displayLastSeenAt: 19_500,
        score: 0.99,
        margin: 0.04,
        decisionReason: "matched",
        countdown: {
          kind: "exact",
          text: "18",
          totalSeconds: 18,
          format: "seconds",
          textRegion: "center",
          confidence: 0.94,
          status: "high",
          routerTarget: "center",
          routerConfidence: 0.95,
          routerStatus: "high",
        },
        countdownModelStatus: "ready",
        performanceMs: 8.4,
        error: null,
        candidateIcons: [],
      },
    };

    const payload = buildSkillIssueReportPayload({
      submittedAt: "2026-06-19T00:00:00.000Z",
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
      skill,
      currentRegion: null,
      snapshot,
      state: createRuntimeState(skill.id),
      estimatedRemainingSeconds: null,
      alertInSeconds: null,
      issue: {
        reason: "skill-missed",
        label: "감지가 안돼요",
      },
    });

    expect(payload.skill.config).toMatchObject({
      presetId: "hologram-graffiti-barrier-vi",
      detectionSource: "buff-duration",
    });
    expect(payload.sample.buffDuration).toMatchObject({
      detected: true,
      candidateIcons: [],
      countdown: {
        text: "18",
        totalSeconds: 18,
      },
    });
  });

  it("stores Yein raw count, confirmed flow state, and recognizer provenance together", () => {
    const skill = createSkill({
      id: "skill-yein",
      presetId: "maehwa-yein-vi",
      detectionSource: "buff-duration",
      alertThresholdSeconds: 3,
    });
    const state = {
      ...createRuntimeState(skill.id),
      status: "running" as const,
      observedRemainingCount: 11,
      countObservedAt: 2_000,
      confidence: 0.91,
      rejectedReading: 3,
      pendingRemainingCountDrop: {
        observedRemainingCount: 3,
        observedAt: 5_000,
        lastObservedAt: 7_000,
        count: 3,
        fromRemainingCount: 11,
        minReachableCount: 8,
      },
    };
    const remainingCount = {
      kind: "exact" as const,
      text: "3",
      count: 3,
      expectedCount: 3,
      format: "remaining-count" as const,
      textRegion: "bottom-right" as const,
      confidence: 0.91,
      status: "high" as const,
      candidates: [{ text: "3", count: 3, probability: 0.91 }],
    };
    const snapshot: SkillSnapshot = {
      sampledAt: 7_000,
      rawPreviewUrl: null,
      previewUrl: "data:image/png;base64,yein",
      regionLabel: "18개 버프칸",
      result: {
        value: 3,
        confidence: 0.91,
        debug: { reason: "remaining-count-detected" },
      },
      buffDuration: {
        targetSkillId: "maehwaYeinDeepV1",
        targetDisplayName: "매화검 3초식 : 예인 VI",
        detected: true,
        boxCount: 18,
        detectedCount: 1,
        score: 0.99,
        margin: 0.1,
        decisionReason: "target_accepted",
        countdown: null,
        countdownModelStatus: "idle",
        remainingCount,
        remainingCountModelStatus: "ready",
        performanceMs: 8,
        error: null,
        candidateIcons: [],
      },
    };

    const payload = buildSkillIssueReportPayload({
      submittedAt: "2026-07-12T00:00:00.000Z",
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
      skill,
      currentRegion: null,
      snapshot,
      state,
      estimatedRemainingSeconds: null,
      alertInSeconds: null,
      timeline: {
        samples: [
          {
            sampledAt: 7_000,
            ocrValue: 3,
            confidence: 0.91,
            recognizedText: "3",
            reason: "remaining-count-detected",
            digitCount: 1,
            foregroundRatio: null,
            statusBefore: "running",
            statusAfter: "running",
            observedRemainingSeconds: null,
            observedRemainingCount: 11,
            estimatedRemainingSeconds: null,
            alertThresholdSeconds: 3,
            alertInSeconds: null,
            alertInCount: 8,
            estimatedExpiresAt: null,
            rejectedReading: 3,
            pendingShortAnchorCount: null,
            remainingCountDecision: "implausible-drop-held",
            remainingCountExpectedMin: 6,
            remainingCountExpectedMax: 11,
            pendingRemainingCountDropObservations: 3,
            pendingRemainingCountAlertObservations: null,
            shouldFireAlert: false,
            shouldRepeatAlert: false,
            alertDecision: null,
          },
        ],
        alertEvents: [],
      },
      issue: {
        reason: "skill-alert-timing",
        label: "알림 시점이나 반복이 이상해요",
      },
    });

    expect(payload.sample.result.recognizerVersion).toBe("bottom-right-cooldown-cnn-v1");
    expect(payload.sample.buffDuration?.remainingCount).toMatchObject({ count: 3 });
    expect(payload.skill.runtimeDiagnostics).toMatchObject({
      observedRemainingCount: 11,
      rejectedReading: 3,
      pendingRemainingCountDrop: {
        observedRemainingCount: 3,
        fromRemainingCount: 11,
        count: 3,
      },
    });
    expect(payload.skill.runtimeTimeline.samples[0]).toMatchObject({
      ocrValue: 3,
      observedRemainingCount: 11,
      remainingCountDecision: "implausible-drop-held",
      remainingCountExpectedMin: 6,
      remainingCountExpectedMax: 11,
      shouldFireAlert: false,
    });
  });

  it("keeps selected runtime incident evidence separate from the report-time frame", () => {
    const skill = createSkill({ id: "skill-incident", name: "테스트 스킬" });
    const runtimeState = createRuntimeState(skill.id);
    const incidentState = createIncidentState({
      status: "alerted",
      observedValue: 5,
      estimatedExpiresAt: 15_000,
      alertedAt: 10_000,
      lastAlertCycleStartedAt: 10_000,
    });
    const recorded = recordSkillIncidentSample({
      previous: createSkillIncidentRuntimeRecorder({ now: 9_000 }),
      input: {
        sampledAt: 10_000,
        monotonicAt: 10_000,
        skillId: skill.id,
        enabled: true,
        mode: "quickslot-countdown",
        targetId: `quickslot:${skill.id}`,
        epochIdentityKey: "capture:1",
        cycleConfigurationKey: "threshold:5",
        epochReason: "normal-runtime-sample",
        provider: "wasm",
        recognizerVersion: "fixture-v1",
        stateBefore: createIncidentState(),
        stateAfter: incidentState,
        recognitionDecision: "accepted",
        parser: null,
        matcher: null,
        value: {
          kind: "countdown",
          rawValue: 5,
          text: "5",
          confidence: 0.99,
          decision: "accepted",
          reason: "recognized",
        },
        flow: {
          confirmedValue: 5,
          expectedMin: null,
          expectedMax: null,
          decisionReason: "anchor",
          pendingDropObservations: null,
          pendingAlertObservations: null,
        },
        runtimeFailure: null,
        configuration: { threshold: 5 },
        frameReasons: ["alert-decision"],
        media: [
          {
            reason: "alert-decision",
            variant: "quickslot-raw",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,incident",
          },
        ],
        alertDecision: {
          kind: "initial",
          outcome: "requested",
          dueAt: 10_000,
          dueMonotonicAt: 10_000,
          reason: "runtime-initial-alert-due",
        },
      },
    });
    const playback = recordSkillIncidentPlaybackRequested({
      previous: recorded.recorder,
      decisionId: recorded.decisionId!,
      requestedAt: 10_010,
      requestedMonotonicAt: 10_010,
      soundId: skill.soundId,
      featureVolume: 1,
      masterVolume: 0.5,
      effectiveVolume: 0.5,
      visibilityState: "visible",
    });
    const frozen = freezeSkillIncidentEvidence({
      archive: playback.recorder.archive,
      selectedSkillId: skill.id,
      frozenAt: 10_500,
      leaseId: "skill-lease-fixed",
    });
    const selection: SkillReportIncidentSelection = {
      policy: "skill-alert-scenario-selection-v1",
      status: "matched",
      support: "definitive",
      anchorKind: "cycle",
      selectedEventAt: 10_000,
      selectedSkillId: skill.id,
      mode: "quickslot-countdown",
      targetId: `quickslot:${skill.id}`,
      epochId: frozen.epochs[0].id,
      candidateIds: [recorded.cycleId!],
      frameIds: [recorded.frameId!],
      observationIds: [recorded.observationId!],
      cycleIds: [recorded.cycleId!],
      decisionIds: [recorded.decisionId!],
      arbitrationIds: [],
      attemptIds: [playback.attemptId],
      eventIds: [],
      configurationRevisionIds: [],
      mediaIds: frozen.media.map((entry) => entry.id),
      ambiguous: false,
      playbackStartEvidence: "not-recorded",
      physicalAudibility: "unknown",
      degradationReasons: [],
    };
    const skillEvidence = createSkillIncidentReportEvidence({
      evidence: frozen,
      selection,
      reportSampledAt: 20_000,
    });

    const payload = buildSkillIssueReportPayload({
      submittedAt: "2026-07-19T00:00:00.000Z",
      url: "https://maple-timer.com/",
      clientId: "client-incident",
      viewportDiagnostics: {
        userAgent: "test",
        viewport: { width: 1280, height: 720 },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      skill,
      currentRegion: skill.region,
      snapshot: {
        sampledAt: 20_000,
        rawPreviewUrl: "data:image/png;base64,report-time",
        previewUrl: "data:image/png;base64,report-time-processed",
        regionLabel: "32x32",
        result: { value: 4, confidence: 0.9 },
      },
      state: runtimeState,
      estimatedRemainingSeconds: 4,
      alertInSeconds: 0,
      skillEvidence,
      issue: {
        reason: "skill-alert-timing",
        label: "알림 시점이나 반복이 이상해요",
        scenario: "recognized-no-alert",
      },
    });

    expect(payload.sample.skillEvidence).toMatchObject({
      leaseId: "skill-lease-fixed",
      selectedSkillId: skill.id,
      frames: [{ id: recorded.frameId, sampledAt: 10_000 }],
      playbackAttempts: [{ id: playback.attemptId, status: "requested" }],
      reportFrame: { source: "report-time", sampledAt: 20_000 },
    });
    expect(payload.incident.evidence).toMatchObject({
      source: "runtime-atomic",
      sampledAt: 10_000,
      stateBinding: "before-after",
    });
    expect(payload.incident.cycleId).toBe(recorded.cycleId);
    expect(
      payload.incident.evidenceManifest.references.find(
        (entry) => entry.id === "skill-playback",
      )?.paths,
    ).toContain("sample.skillEvidence.playbackAttempts");
  });
});

function createIncidentState(
  overrides: Partial<SkillIncidentRuntimeState> = {},
): SkillIncidentRuntimeState {
  return {
    status: "idle",
    observedValue: null,
    estimatedExpiresAt: null,
    alertedAt: null,
    lastRepeatedAlertAt: null,
    repeatedAlertCount: 0,
    lastAlertCycleStartedAt: null,
    initialAlertDelaySeconds: null,
    initialAlertDelayCycleStartedAt: null,
    rejectedValue: null,
    pendingReason: null,
    ...overrides,
  };
}
