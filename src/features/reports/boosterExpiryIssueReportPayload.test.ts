import { describe, expect, it } from "vitest";
import type { BoosterExpirySnapshot } from "../../lib/boosterExpiry/boosterExpiryTypes";
import { createBoosterExpiryRuntimeState } from "../../lib/boosterExpiry/boosterExpiryRuntime";
import { createDefaultBoosterExpiryAlert } from "../../lib/storage";
import { createAlertIncidentJournal } from "../../application/reporting/alertIncidentJournal";
import {
  BOOSTER_EXPIRY_INCIDENT_EVIDENCE_SCHEMA_VERSION,
} from "../../runtime/booster-expiry/evidence/boosterExpiryIncidentEvidenceTypes";
import type { BoosterExpiryIncidentReportEvidence } from "../../runtime/booster-expiry/evidence/boosterExpiryIncidentReportEvidence";
import { buildBoosterExpiryIssueReportPayload } from "./alertReportPayloads";

describe("boosterExpiryIssueReportPayload", () => {
  it("preserves runtime worker failures separately from empty timer results", () => {
    const runtimeFailure = {
      stage: "feature-analysis" as const,
      code: "feature-analysis-failed",
      technicalMessage: "worker channel closed",
      occurredAt: 10_000,
    };
    const snapshot: BoosterExpirySnapshot = {
      sampledAt: 10_000,
      rawPreviewUrl: "data:image/png;base64,raw",
      timerPreviewUrl: null,
      regionLabel: "top-center",
      rawTime: null,
      time: null,
      timeRect: null,
      flow: null,
      performance: null,
      runtimeTrace: [],
      timerEvidence: [],
      confirmationEvidence: [],
      runtimeFailure,
    };
    const payload = buildBoosterExpiryIssueReportPayload({
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
      config: { ...createDefaultBoosterExpiryAlert(), enabled: true },
      snapshot,
      state: createBoosterExpiryRuntimeState(),
      issue: { reason: "booster-expiry-reading", label: "시간이 이상해요" },
    });

    expect(payload.sample.result.runtimeFailure).toEqual(runtimeFailure);
    expect(payload.sample.result.detected).toBe(false);
    expect(payload.incident.completeness.stateBeforeAfter).toBe(false);
  });

  it("includes compact booster expiry timer diagnostics in issue reports", () => {
    const snapshot: BoosterExpirySnapshot = {
      sampledAt: 12_000,
      rawPreviewUrl: "data:image/png;base64,top",
      timerPreviewUrl: "data:image/png;base64,timer",
      regionLabel: "top-center 1280x180",
      rawTime: {
        ok: true,
        reason: "ok",
        rect: { x: 400, y: 32, width: 112, height: 30 },
        digitCount: 4,
        seconds: 15,
        text: "15.00",
        format: "ss.cc",
        selectedBy: "decimal",
      },
      time: {
        ok: true,
        reason: "ok",
        rect: { x: 400, y: 32, width: 112, height: 30 },
        digitCount: 4,
        seconds: 15,
        text: "15.00",
        format: "ss.cc",
        selectedBy: "decimal",
      },
      timeRect: {
        ok: true,
        reason: "ok",
        rect: { x: 400, y: 32, width: 112, height: 30 },
        matchCount: 1,
        candidateCount: 2,
      },
      flow: {
        locked: true,
        source: "raw-lock",
        predictedSeconds: 15,
        rawDeltaSeconds: -1,
        timestampMs: 12_000,
      },
      performance: {
        recognitionMs: 4.2,
        totalMs: 5.1,
      },
      runtimeTrace: [
        {
          sampledAt: 11_000,
          status: "armed",
          rawText: "16.00",
          displayText: "16.00",
          rawRemainingSeconds: 16,
          remainingSeconds: 16,
          estimatedExpiresAt: 27_000,
          alertAt: 17_000,
          cycleCandidateObservationCount: 3,
          cycleCandidateDecreaseSeconds: 2,
          confirmedAt: 10_000,
          confirmedExpiresAt: 27_000,
          confirmedLastSupportedAt: 11_000,
          confirmedContradictionCount: 0,
          alerted: false,
          flowSource: "raw-lock",
          locked: true,
          decision: "raw-locked",
          rect: { x: 400, y: 32, width: 112, height: 30 },
          performance: {
            recognitionMs: 4,
            totalMs: 5,
          },
        },
      ],
      timerEvidence: [
        {
          sampledAt: 11_000,
          dataUrl: "data:image/png;base64,evidence",
          rect: { x: 400, y: 32, width: 112, height: 30 },
          rawText: "16.00",
          displayText: "16.00",
          rawRemainingSeconds: 16,
          remainingSeconds: 16,
          predictedExpiresAt: 27_000,
          confirmedExpiresAt: 27_000,
          alertAt: 17_000,
          flowSource: "raw-lock",
          locked: true,
          decision: "raw-locked",
          format: "ss.cc",
          selectedBy: "decimal",
          stateBefore: {
            status: "confirming",
            decision: "raw-locked",
            rawRemainingSeconds: 17,
            remainingSeconds: 17,
            estimatedExpiresAt: 27_000,
            alertAt: 17_000,
            alertedAt: null,
            confirmedAt: null,
            confirmedExpiresAt: null,
            locked: true,
            flowSource: "raw-lock",
          },
          stateAfter: {
            status: "armed",
            decision: "raw-locked",
            rawRemainingSeconds: 16,
            remainingSeconds: 16,
            estimatedExpiresAt: 27_000,
            alertAt: 17_000,
            alertedAt: null,
            confirmedAt: 11_000,
            confirmedExpiresAt: 27_000,
            locked: true,
            flowSource: "raw-lock",
          },
        },
      ],
      confirmationEvidence: [
        {
          sampledAt: 10_000,
          dataUrl: "data:image/png;base64,confirm",
          rect: { x: 400, y: 32, width: 112, height: 30 },
          rawText: "17.00",
          displayText: "17.00",
          rawRemainingSeconds: 17,
          remainingSeconds: 17,
          predictedExpiresAt: 27_000,
          confirmedExpiresAt: 27_000,
          alertAt: 17_000,
          flowSource: "raw-lock",
          locked: true,
          decision: "raw-locked",
          format: "ss.cc",
          selectedBy: "decimal",
        },
      ],
    };
    const state = {
      ...createBoosterExpiryRuntimeState(),
      status: "armed" as const,
      lastSampledAt: 12_000,
      lastDetectedAt: 12_000,
      lastRawDetectedAt: 12_000,
      rawText: "15.00",
      displayText: "15.00",
      rawRemainingSeconds: 15,
      remainingSeconds: 15,
      estimatedExpiresAt: 27_000,
      alertAt: 17_000,
      flowSource: "raw-lock",
      locked: true,
      confidence: 1,
      consecutiveRawDetections: 2,
      lastDecision: "raw-locked" as const,
    };

    const payload = buildBoosterExpiryIssueReportPayload({
      submittedAt: "2026-06-01T00:00:00.000Z",
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
      config: { ...createDefaultBoosterExpiryAlert(), enabled: true, alertLeadSeconds: 10 },
      snapshot,
      state,
      issue: {
        reason: "booster-expiry-missed",
        label: "부스터가 꺼졌는데 알림이 안 울려요",
      },
    });

    expect(payload.reportContract).toEqual({
      schema: "maple-timer.alert-report",
      version: 1,
    });
    expect(payload.incident.evidenceManifest.references.map((entry) => entry.id)).toEqual([
      "booster-expiry-source",
      "booster-expiry-trace",
      "booster-expiry-state-binding",
      "booster-expiry-decision",
      "booster-expiry-playback",
      "booster-expiry-config",
      "booster-expiry-runtime",
    ]);
    expect(payload.kind).toBe("booster-expiry-issue");
    expect(payload.sample).toMatchObject({
      rawDataUrl: "data:image/png;base64,top",
      timerDataUrl: "data:image/png;base64,timer",
      result: {
        value: "15.00",
        confidence: null,
        detected: true,
      },
      runtimeTrace: [
        {
          sampledAt: 11_000,
          status: "armed",
          rawText: "16.00",
          displayText: "16.00",
          remainingSeconds: 16,
          confirmedLastSupportedAt: 11_000,
          locked: true,
          decision: "raw-locked",
        },
      ],
      timerEvidence: [
        {
          sampledAt: 11_000,
          dataUrl: "data:image/png;base64,evidence",
          rawText: "16.00",
          predictedExpiresAt: 27_000,
          decision: "raw-locked",
        },
      ],
      confirmationEvidence: [
        {
          sampledAt: 10_000,
          dataUrl: "data:image/png;base64,confirm",
          rawText: "17.00",
          predictedExpiresAt: 27_000,
          decision: "raw-locked",
        },
      ],
    });
    expect(payload.boosterExpiry.summary).toMatchObject({
      enabled: true,
      runtimeStatus: "armed",
      locked: true,
      displayText: "15.00",
      remainingSeconds: 15,
      alertAt: 17_000,
    });
    expect(payload.boosterExpiry.lastSnapshot).toMatchObject({
      sampledAt: 12_000,
      flowSource: "raw-lock",
      locked: true,
      runtimeTraceFrameCount: 1,
      timerEvidenceCount: 1,
      confirmationEvidenceCount: 1,
      latestTimerEvidence: {
        sampledAt: 11_000,
        rawText: "16.00",
        displayText: "16.00",
        predictedExpiresAt: 27_000,
        decision: "raw-locked",
      },
    });
    expect(payload.incident).toMatchObject({
      evidence: { stateBinding: "before-after" },
      completeness: { stateBeforeAfter: true },
    });
    expect(payload.sample.timerEvidence[0]).toMatchObject({
      stateBefore: { status: "confirming", remainingSeconds: 17 },
      stateAfter: { status: "armed", remainingSeconds: 16 },
    });
  });

  it("reports raw booster expiry text instead of stale flow text during rejected predictions", () => {
    const snapshot: BoosterExpirySnapshot = {
      sampledAt: 12_000,
      rawPreviewUrl: "data:image/png;base64,top",
      timerPreviewUrl: "data:image/png;base64,timer",
      regionLabel: "top-center 1280x180",
      rawTime: {
        ok: true,
        reason: "ok",
        rect: { x: 400, y: 32, width: 112, height: 30 },
        digitCount: 4,
        seconds: 58.66,
        text: "58.66",
        format: "ss.cc",
        selectedBy: "decimal",
      },
      time: {
        ok: true,
        reason: "flow-rejected-raw",
        rect: { x: 400, y: 32, width: 112, height: 30 },
        digitCount: 4,
        seconds: 1219,
        text: "20:19",
        format: "mm:ss",
        selectedBy: "time-flow",
      },
      timeRect: {
        ok: true,
        reason: "ok",
        rect: { x: 400, y: 32, width: 112, height: 30 },
        matchCount: 1,
        candidateCount: 1,
      },
      flow: {
        locked: true,
        source: "predicted-rejected-raw",
        predictedSeconds: 1219,
        rawDeltaSeconds: -1160.34,
        timestampMs: 12_000,
      },
      performance: null,
      runtimeTrace: [],
      timerEvidence: [
        {
          sampledAt: 12_000,
          eventType: "flow-conflict",
          dataUrl: "data:image/png;base64,conflict",
          rect: { x: 400, y: 32, width: 112, height: 30 },
          rawText: "58.66",
          displayText: "20:19",
          rawRemainingSeconds: 58.66,
          remainingSeconds: 1219,
          predictedExpiresAt: 70_660,
          confirmedExpiresAt: null,
          alertAt: null,
          flowSource: "predicted-rejected-raw",
          locked: true,
          decision: "raw-locked",
          format: "ss.cc",
          selectedBy: "decimal",
        },
      ],
      confirmationEvidence: [],
    };
    const state = {
      ...createBoosterExpiryRuntimeState(),
      status: "confirming" as const,
      lastSampledAt: 12_000,
      rawText: "58.66",
      displayText: "20:19",
      rawRemainingSeconds: 58.66,
      remainingSeconds: 1219,
      flowSource: "predicted-rejected-raw",
      locked: true,
      consecutiveRawDetections: 2,
      lastDecision: "raw-locked" as const,
    };

    const payload = buildBoosterExpiryIssueReportPayload({
      submittedAt: "2026-06-01T00:00:00.000Z",
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
      config: { ...createDefaultBoosterExpiryAlert(), enabled: true, alertLeadSeconds: 10 },
      snapshot,
      state,
      issue: {
        reason: "booster-expiry-reading",
        label: "부스터 시간이 이상하게 감지돼요",
      },
    });

    expect(payload.sample.result.value).toBe("58.66");
    expect(payload.sample.timerEvidence[0]).toMatchObject({
      eventType: "flow-conflict",
      rawText: "58.66",
      displayText: "20:19",
    });
    expect(payload.boosterExpiry.lastSnapshot.latestTimerEvidence).toMatchObject({
      eventType: "flow-conflict",
      rawText: "58.66",
      displayText: "20:19",
    });
  });

  it("caps booster expiry evidence images while keeping compact evidence metadata", () => {
    const timerEvidence = Array.from({ length: 20 }, (_, index) => ({
      sampledAt: 10_000 + index * 1_000,
      eventType: "flow-conflict" as const,
      dataUrl: `data:image/png;base64,evidence-${index}`,
      rect: { x: 400, y: 32, width: 112, height: 30 },
      rawText: `${80 - index}.00`,
      displayText: `${80 - index}.00`,
      rawRemainingSeconds: 80 - index,
      remainingSeconds: 80 - index,
      predictedExpiresAt: 90_000,
      confirmedExpiresAt: null,
      alertAt: null,
      flowSource: "predicted-rejected-raw",
      locked: true,
      decision: "raw-locked" as const,
      format: "ss.cc" as const,
      selectedBy: "decimal",
    }));
    const snapshot: BoosterExpirySnapshot = {
      sampledAt: 32_000,
      rawPreviewUrl: "data:image/png;base64,top",
      timerPreviewUrl: "data:image/png;base64,timer",
      regionLabel: "top-center 1280x180",
      rawTime: null,
      time: null,
      timeRect: null,
      flow: null,
      performance: null,
      runtimeTrace: [],
      timerEvidence,
      confirmationEvidence: [],
    };
    const state = createBoosterExpiryRuntimeState();

    const payload = buildBoosterExpiryIssueReportPayload({
      submittedAt: "2026-06-01T00:00:00.000Z",
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
      config: { ...createDefaultBoosterExpiryAlert(), enabled: true, alertLeadSeconds: 10 },
      snapshot,
      state,
      issue: {
        reason: "booster-expiry-reading",
        label: "부스터 시간이 이상하게 감지돼요",
      },
    });

    expect(payload.sample.timerEvidence).toHaveLength(20);
    expect(payload.sample.timerEvidence.filter((entry) => entry.dataUrl !== null)).toHaveLength(12);
    expect(payload.sample.timerEvidence.filter((entry) => entry.dataUrl === null)).toHaveLength(8);
  });

  it("locks incident metadata and references to the selected runtime evidence", () => {
    const incidentEvidence = createIncidentEvidence();
    const snapshot: BoosterExpirySnapshot = {
      sampledAt: 99_000,
      rawPreviewUrl: "data:image/png;base64,report-time-raw",
      timerPreviewUrl: "data:image/png;base64,report-time-timer",
      regionLabel: "report-time",
      rawTime: null,
      time: null,
      timeRect: null,
      flow: null,
      performance: null,
      runtimeTrace: [],
      timerEvidence: [],
      confirmationEvidence: [],
    };
    const journal = createAlertIncidentJournal();
    journal.record({
      id: "journal-state",
      feature: "booster-expiry",
      targetId: null,
      kind: "decision",
      occurredAt: 20_100,
      frameId: null,
      cycleId: null,
      status: "legacy",
      decision: "legacy",
      value: null,
      details: { stateBefore: { status: "old" }, stateAfter: { status: "new" } },
    });

    const payload = buildBoosterExpiryIssueReportPayload({
      submittedAt: "2026-07-19T00:00:00.000Z",
      url: "https://maple-timer.com/",
      clientId: "client-runtime-atomic",
      viewportDiagnostics: {
        userAgent: "test",
        viewport: { width: 1280, height: 720 },
      },
      captureDiagnostics: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
      config: { ...createDefaultBoosterExpiryAlert(), enabled: true },
      snapshot,
      state: createBoosterExpiryRuntimeState(),
      incidentEvidence,
      issue: {
        reason: "booster-expiry-missed",
        label: "부스터가 꺼졌는데 알림이 안 울려요",
        scenario: "not-recognized",
        occurrence: "current",
      },
      journalSelection: journal.freeze({ feature: "booster-expiry" }, 20_500),
    });

    expect(payload.incident.evidence).toMatchObject({
      source: "runtime-atomic",
      sampledAt: 20_000,
      windowStartedAt: 19_000,
      windowEndedAt: 20_000,
      frameCount: 1,
      stateBinding: "before-after",
      mediaCount: 1,
    });
    expect(payload.incident.correlation).toMatchObject({
      frameIds: ["frame:runtime"],
      cycleIds: [],
      playbackIds: [],
      configRevisions: ["config:runtime"],
    });
    expect(payload.incident.evidenceManifest.references.flatMap(
      (entry) => entry.paths,
    )).toEqual(expect.arrayContaining([
      "sample.boosterExpiryEvidence.media",
      "sample.boosterExpiryEvidence.frames",
      "sample.boosterExpiryEvidence.observations",
    ]));
    expect(payload.incident.evidenceManifest.references.flatMap(
      (entry) => entry.paths,
    )).not.toContain("incident.journal.entries");
    expect(payload.sample.boosterExpiryEvidence).toEqual(incidentEvidence);
    expect(payload.sample.rawDataUrl).toBeNull();
    expect(payload.sample.timerDataUrl).toBeNull();
    expect(payload.sample.runtimeTrace).toEqual([]);
    expect(payload.sample.timerEvidence).toEqual([]);
    expect(payload.sample.confirmationEvidence).toEqual([]);
    expect(payload.boosterExpiry.lastSnapshot).toMatchObject({
      runtimeTraceFrameCount: 0,
      timerEvidenceCount: 0,
      confirmationEvidenceCount: 0,
    });
  });
});

function createIncidentEvidence(): BoosterExpiryIncidentReportEvidence {
  const stateBefore = {
    capturedAt: 18_999,
    status: "paused",
    decision: "waiting",
    rawRemainingSeconds: null,
    remainingSeconds: null,
    candidateObservationCount: 0,
    confirmedExpiresAt: null,
    alertAt: null,
    alertedAt: null,
    flowSource: null,
    locked: false,
  };
  const stateAfter = {
    ...stateBefore,
    capturedAt: 19_000,
    status: "paused",
    decision: "not-found",
  };
  return {
    schemaVersion: BOOSTER_EXPIRY_INCIDENT_EVIDENCE_SCHEMA_VERSION,
    archiveUpdatedAt: 20_000,
    frozenAt: 20_000,
    leaseId: "lease:runtime",
    lease: {
      id: "lease:runtime",
      resetEpochId: "reset:runtime",
      flowEpochId: "flow:runtime",
      configRevisionId: "config:runtime",
      sequence: 1,
      frozenAt: 20_000,
      leasedThroughFrameSequence: 1,
      layoutKey: "1920x1080",
      sourceGeometryRevision: "geometry:runtime",
      candidateAttemptId: null,
      cycleId: null,
      scheduleId: null,
      decisionId: null,
      playbackAttemptId: null,
    },
    frozenState: null,
    selection: {
      policy: "booster-expiry-scenario-selection-v1",
      status: "current-snapshot",
      support: "definitive",
      anchorKind: "observation",
      selectedEventAt: 20_000,
      resetEpochId: "reset:runtime",
      candidateIds: ["recognition:observation:runtime"],
      flowEpochIds: ["flow:runtime"],
      frameIds: ["frame:runtime"],
      observationIds: ["observation:runtime"],
      candidateAttemptIds: [],
      cycleIds: [],
      scheduleIds: [],
      decisionIds: [],
      playbackAttemptIds: [],
      eventIds: [],
      configurationRevisionIds: ["config:runtime"],
      mediaFrameIds: ["frame:runtime"],
      relatedPlaybackIds: [],
      ambiguous: false,
      operatorConclusion: "recognition-missing",
      physicalAudibility: "unknown",
      degradationReasons: [],
    },
    resetEpochs: [
      {
        id: "reset:runtime",
        sessionId: "session:runtime",
        sequence: 1,
        startedAt: 19_000,
        reason: "initialized",
        continuity: {
          captureGeneration: 1,
          featureGeneration: 1,
          monitoringGeneration: 1,
          layoutKey: "1920x1080",
          sourceGeometryRevision: "geometry:runtime",
        },
      },
    ],
    configurations: [
      {
        id: "config:runtime",
        resetEpochId: "reset:runtime",
        sequence: 1,
        capturedAt: 19_000,
        fingerprint: "config",
        timingFingerprint: "timing",
        playbackFingerprint: "playback",
        values: {
          enabled: true,
          alertLeadSeconds: 10,
          soundId: "booster-expiry",
          featureVolume: 1,
          masterVolume: 1,
          effectiveVolume: 1,
        },
      },
    ],
    flowEpochs: [
      {
        id: "flow:runtime",
        resetEpochId: "reset:runtime",
        sequence: 1,
        workerGeneration: 1,
        startedAt: 19_000,
        reason: "initialized",
      },
    ],
    frames: [
      {
        id: "frame:runtime",
        resetEpochId: "reset:runtime",
        flowEpochId: "flow:runtime",
        configRevisionId: "config:runtime",
        sequence: 1,
        sampledAt: 20_000,
        layoutKey: "1920x1080",
        sourceGeometryRevision: "geometry:runtime",
        source: {
          kind: "normal-monitoring-top-quarter",
          coordinateSpace: "capture-pixels",
          sourceDimensions: { width: 1920, height: 1080 },
          sampledRegion: { x: 0, y: 0, width: 1920, height: 270 },
          maxCaptureWidth: 1024,
          regionLabel: "1920x270",
        },
        runtimeFailure: null,
        mediaFrameId: "media:runtime",
      },
    ],
    observations: [
      {
        id: "observation:runtime",
        resetEpochId: "reset:runtime",
        flowEpochId: "flow:runtime",
        frameId: "frame:runtime",
        frameSequence: 1,
        configRevisionId: "config:runtime",
        sampledAt: 20_000,
        decision: "missing",
        reason: "not-found",
        recognizerVersion: "booster-runtime-v1",
        rawTime: null,
        selectedTime: null,
        timerRect: null,
        timerCandidateCount: 0,
        timerMatchCount: 0,
        flow: null,
        strongForConfirmation: false,
        observedExpiresAt: null,
        recognitionMs: 2,
        totalMs: 3,
        stateBefore,
        stateAfter,
      },
    ],
    candidateAttempts: [],
    cycles: [],
    schedules: [],
    decisions: [],
    playbackAttempts: [],
    lifecycle: [],
    media: [
      {
        id: "media:runtime",
        frameId: "frame:runtime",
        resetEpochId: "reset:runtime",
        sampledAt: 20_000,
        reason: "rejected-observation",
        imageDataUrl: "data:image/png;base64,runtime",
      },
    ],
    relatedPlayback: [],
    omissions: [],
    reportFrame: null,
    budget: {
      version: 1,
      metadataLimitChars: 196_608,
      metadataChars: 1_000,
      mediaLimitCount: 8,
      mediaCount: 1,
      mediaLimitChars: 1_200_000,
      mediaChars: 35,
      requestTargetBytes: 2_097_152,
      requestBytes: 2_000,
      droppedMediaFrameIds: [],
      overMetadataLimit: false,
      overMediaLimit: false,
      overRequestTarget: false,
    },
  };
}
