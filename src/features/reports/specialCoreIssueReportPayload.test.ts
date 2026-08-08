import { describe, expect, it, vi } from "vitest";
import {
  createSpecialCoreRuntimeState,
  type SpecialCoreCandidateIcon,
  type SpecialCoreSnapshot,
} from "../../lib/specialCore";
import { createDefaultSpecialCoreAlert } from "../../lib/storage";
import { buildSpecialCoreIssueReportPayload } from "./alertReportPayloads";
import { createAlertIncidentJournal } from "../../application/reporting/alertIncidentJournal";
import { freezeSpecialCoreIncidentBoundary } from "../../runtime/special-core/evidence/specialCoreIncidentBoundary";
import { freezeSpecialCoreIncidentEvidence } from "../../runtime/special-core/evidence/specialCoreIncidentEvidenceArchive";
import { selectSpecialCoreReportIncident } from "../../runtime/special-core/evidence/specialCoreIncidentEvidenceSelection";
import { createSpecialCoreIncidentReportEvidence } from "../../runtime/special-core/evidence/specialCoreIncidentReportEvidence";
import {
  createSpecialCoreIncidentFrozenState,
  createSpecialCoreIncidentRuntimeRecorder,
  recordSpecialCoreIncidentRuntimeSample,
} from "../../runtime/special-core/evidence/specialCoreIncidentRuntimeRecorder";

vi.mock("../../lib/imageData", () => ({
  imageDataToUrl: vi.fn(() => "data:image/png;base64,icon"),
}));

function makeCandidate(partial: Partial<SpecialCoreCandidateIcon> = {}): SpecialCoreCandidateIcon {
  return {
    boxIndex: partial.boxIndex ?? 3,
    box: partial.box ?? {
      x: 120,
      y: 24,
      size: 32,
      confidence: 0.94,
      score: 8.2,
    },
    icon: partial.icon ?? {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 255, 0, 255,
        0, 0, 255, 255,
        255, 255, 0, 255,
      ]),
    },
    match: partial.match ?? makeMatch(),
  };
}

function makeMatch({
  matched = true,
  score = 4.2,
  gateScore = matched ? 0.98 : 0.82,
}: {
  matched?: boolean;
  score?: number;
  gateScore?: number;
} = {}): SpecialCoreCandidateIcon["match"] {
  const basePassed = score >= 0;
  const positiveGatePassed = gateScore >= 0.94;
  return {
    matched,
    targetId: matched ? "specialCore" : null,
    bundleId: "special-core-deep-v2",
    modelId: "special-core-deep-v2",
    modelVersion: "special-core-20260711-v2",
    variantId: "test",
    gateVersion: 2,
    score,
    threshold: 0,
    margin: score,
    gateScore,
    gateThreshold: 0.94,
    gateMargin: gateScore - 0.94,
    rescueThreshold: 0.999,
    rescueMargin: gateScore - 0.999,
    basePassed,
    positiveGatePassed,
    primaryPassed: matched && basePassed && positiveGatePassed,
    rescuePassed: false,
    decisionReason: matched
      ? "base_and_positive_gate_passed"
      : basePassed
        ? "below_positive_gate_threshold"
        : "below_base_threshold",
    elapsedMs: 2.4,
  };
}

describe("specialCoreIssueReportPayload", () => {
  it("keeps selected incident evidence authoritative over generic journal fallbacks", () => {
    const sampledAt = 20_000;
    const frozenAt = 21_000;
    const config = {
      ...createDefaultSpecialCoreAlert(),
      enabled: true,
    };
    const state = createSpecialCoreRuntimeState({
      status: "waiting",
      lastSampledAt: sampledAt,
    });
    const snapshot: SpecialCoreSnapshot = {
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
    let recorder = recordSpecialCoreIncidentRuntimeSample({
      previous: createSpecialCoreIncidentRuntimeRecorder(0),
      input: {
        sampledAt,
        configuration: {
          enabled: true,
          cooldownSeconds: config.cooldownSeconds,
          alertLeadSeconds: config.alertLeadSeconds,
          soundId: config.soundId,
          featureVolume: config.volume,
          masterVolume: 1,
          effectiveVolume: config.volume,
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
          imageDataUrl: "data:image/png;base64,selected-runtime-frame",
          reason: "rejected-observation",
        },
      },
    });
    const frozenBoundary = freezeSpecialCoreIncidentBoundary({
      previous: recorder.boundary!,
      frozenAt,
    });
    recorder = { ...recorder, boundary: frozenBoundary.state };
    const frozenEvidence = freezeSpecialCoreIncidentEvidence({
      archive: recorder.archive,
      lease: frozenBoundary.lease,
      frozenState: createSpecialCoreIncidentFrozenState({
        recorder,
        capturedAt: frozenAt,
        state,
      }),
    });
    const incidentEvidence = createSpecialCoreIncidentReportEvidence({
      evidence: frozenEvidence,
      selection: selectSpecialCoreReportIncident({
        evidence: frozenEvidence,
        reason: "special-core-missed",
        scenario: "not-recognized",
        occurrence: "current",
      }),
    });
    const journal = createAlertIncidentJournal();
    journal.record({
      id: "generic-playback-only",
      feature: "special-core",
      targetId: null,
      kind: "playback",
      occurredAt: 20_500,
      frameId: null,
      cycleId: null,
      status: "finished",
      decision: "played",
      value: null,
      details: { finishedAt: 20_500 },
    });

    const payload = buildSpecialCoreIssueReportPayload({
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
      config,
      roiPreviewUrl: "data:image/png;base64,report-time-preview",
      snapshot,
      state,
      incidentEvidence,
      issue: {
        reason: "special-core-missed",
        label: "특수 코어 발동 아이콘을 찾지 못했어요",
        scenario: "not-recognized",
        occurrence: "current",
      },
      journalSelection: journal.freeze({ feature: "special-core" }, frozenAt),
    });

    expect(payload.incident.evidence.source).toBe("runtime-atomic");
    expect(payload.incident.completeness).toMatchObject({
      sourceImage: true,
      stateBeforeAfter: true,
      decision: false,
      playback: false,
    });
    expect(payload.incident.correlation.frameIds).toEqual(
      incidentEvidence.selection.frameIds,
    );
    expect(payload.incident.evidenceManifest.references.flatMap(
      (entry) => entry.paths,
    )).toEqual(expect.arrayContaining([
      "sample.specialCoreEvidence.media",
      "sample.specialCoreEvidence.frames",
      "sample.specialCoreEvidence.observations",
    ]));
    expect(payload.incident.evidenceManifest.references.flatMap(
      (entry) => entry.paths,
    )).not.toContain("incident.journal.entries");
    expect(payload.sample.rawDataUrl).toBeNull();
    expect(payload.sample.specialCoreEvidence).toEqual(incidentEvidence);
    expect(
      JSON.stringify(payload).match(/data:image\/png;base64,selected-runtime-frame/g),
    ).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain("report-time-preview");
  });

  it("serializes special core runtime, timing, and icon evidence", () => {
    const candidate = makeCandidate();
    const activationCandidate = makeCandidate({
      boxIndex: 4,
      match: {
        ...candidate.match,
        score: 4.8,
      },
    });
    const nearThresholdCandidate = makeCandidate({
      boxIndex: 8,
      match: makeMatch({ matched: false, score: -0.8, gateScore: 0.93 }),
    });
    const lowScoreCandidate = makeCandidate({
      boxIndex: 9,
      match: makeMatch({ matched: false, score: -2.1, gateScore: 0.42 }),
    });
    const config = {
      ...createDefaultSpecialCoreAlert(),
      enabled: true,
      cooldownSeconds: 45,
      alertLeadSeconds: 7,
      soundId: "ding",
      volume: 0.5,
    };
    const state = createSpecialCoreRuntimeState({
      status: "cooldown",
      lastSampledAt: 1_500,
      boxCount: 9,
      detectedCount: 1,
      activationId: 2,
      activationStartedAt: 1_000,
      activationConfirmedAt: 2_000,
      activationLastSeenAt: 2_000,
      cooldownEndsAt: 46_000,
      alertDueAt: 39_000,
      lastDetectedIcon: candidate,
      activationEvidence: {
        activationId: 2,
        activationStartedAt: 1_000,
        activationConfirmedAt: 2_000,
        confirmationIcons: [activationCandidate, candidate],
      },
      pendingDetections: [
        {
          observedAt: 1_000,
          boxIndex: 3,
          box: candidate.box,
          score: 4.2,
          margin: 1,
        },
      ],
    });
    const snapshot: SpecialCoreSnapshot = {
      sampledAt: 2_000,
      boxCount: 9,
      detectedCount: 1,
      detectedIcon: candidate,
      candidateIcons: [candidate],
      performance: {
        totalMs: 16,
        detectMs: 4,
        matchMs: 10,
        boxCount: 9,
      },
    };
    const reportSnapshot: SpecialCoreSnapshot = {
      sampledAt: 3_000,
      boxCount: 11,
      detectedCount: 1,
      detectedIcon: candidate,
      candidateIcons: [candidate, nearThresholdCandidate, lowScoreCandidate],
      performance: {
        totalMs: 18,
        detectMs: 5,
        matchMs: 11,
        boxCount: 11,
      },
    };
    const evidenceHistory: SpecialCoreSnapshot[] = Array.from(
      { length: 35 },
      (_, historyIndex) => ({
        sampledAt: 1_000 + historyIndex * 1_000,
        boxCount: 9 + historyIndex,
        detectedCount: historyIndex % 2,
        detectedIcon: historyIndex % 2 === 0 ? candidate : null,
        candidateIcons: Array.from({ length: 8 }, (_, candidateIndex) =>
          makeCandidate({
            boxIndex: candidateIndex,
            match: {
              ...candidate.match,
              score: 8 - candidateIndex,
            },
          }),
        ),
        performance: {
          totalMs: 16,
          detectMs: 4,
          matchMs: 10,
          boxCount: 9 + historyIndex,
        },
      }),
    );

    const payload = buildSpecialCoreIssueReportPayload({
      submittedAt: "2026-06-30T00:00:00.000Z",
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
      config,
      roiPreviewUrl: "data:image/png;base64,roi",
      roiRegionLabel: "960x540",
      snapshot,
      reportSnapshot,
      evidenceHistory,
      state,
      issue: {
        reason: "special-core-timing",
        label: "쿨타임/알림 시간이 이상해요",
      },
    });

    expect(payload.reportContract).toEqual({
      schema: "maple-timer.alert-report",
      version: 1,
    });
    expect(payload.incident.evidenceManifest.references.map((entry) => entry.id)).toEqual([
      "special-core-source",
      "special-core-trace",
      "special-core-state-binding",
      "special-core-decision",
      "special-core-playback",
      "special-core-config",
      "special-core-runtime",
    ]);
    expect(payload.kind).toBe("special-core-issue");
    expect(payload.sample.rawDataUrl).toBe("data:image/png;base64,roi");
    expect(payload.sample.processedDataUrl).toBeNull();
    expect(payload.sample.result).toMatchObject({
      detected: true,
      confidence: null,
      candidateCount: 3,
      debug: {
        bundleId: "special-core-deep-v2",
        modelId: "special-core-deep-v2",
        modelVersion: "special-core-20260711-v2",
        decisionReason: "base_and_positive_gate_passed",
        bestScore: 4.2,
        bestGateScore: 0.98,
        primaryPassed: true,
        rescuePassed: false,
      },
    });
    expect(payload.specialCore.config).toMatchObject({
      enabled: true,
      cooldownSeconds: 45,
      alertLeadSeconds: 7,
      soundId: "ding",
      volume: 0.5,
    });
    expect(payload.specialCore.state).toMatchObject({
      status: "cooldown",
      activationStartedAt: 1_000,
      cooldownEndsAt: 46_000,
      alertDueAt: 39_000,
    });
    expect(payload.sample.specialCore.candidateIcons).toHaveLength(3);
    expect(payload.sample.specialCore.candidateIcons[0]).toMatchObject({
      boxIndex: 3,
      match: {
        matched: true,
        score: 4.2,
      },
    });
    expect(payload.sample.specialCore.candidateIcons[1]).toMatchObject({
      boxIndex: 8,
      match: {
        matched: false,
        score: -0.8,
        gateScore: 0.93,
        decisionReason: "below_base_threshold",
      },
    });
    expect(payload.sample.specialCore.candidateIcons[2]).toMatchObject({
      boxIndex: 9,
      match: {
        matched: false,
        score: -2.1,
      },
    });
    expect("detectedIcon" in payload.sample.specialCore).toBe(false);
    expect("recentEvidence" in payload.sample.specialCore).toBe(false);
    expect(payload.specialCore.activationEvidence).toMatchObject({
      activationId: 2,
      activationStartedAt: 1_000,
      activationConfirmedAt: 2_000,
      confirmationIcons: [
        {
          boxIndex: 4,
          match: {
            score: 4.8,
          },
        },
        {
          boxIndex: 3,
          match: {
            score: 4.2,
          },
        },
      ],
    });
    expect(payload.specialCore.recentEvidence).toHaveLength(12);
    expect(payload.specialCore.recentEvidence[0]).toMatchObject({
      sampledAt: 24_000,
      boxCount: 32,
    });
    expect(payload.specialCore.recentEvidence[0]?.source).toBe("top-candidate");
    expect(payload.specialCore.recentEvidence[0]?.evidenceIcon).toMatchObject({
      boxIndex: 0,
      match: {
        score: 8,
      },
    });
    expect(payload.specialCore.recentEvidence[0]?.evidenceIcon?.imageDataUrl).toEqual(
      expect.stringMatching(/^data:image\/png;base64,/),
    );
    expect(countDataUrls(payload)).toBe(18);
  });

  it("does not attach an older runtime detection to a failed report frame", () => {
    const candidate = makeCandidate();
    const state = createSpecialCoreRuntimeState({
      status: "cooldown",
      boxCount: 9,
      detectedCount: 1,
      lastDetectedIcon: candidate,
    });
    const reportSnapshot: SpecialCoreSnapshot = {
      sampledAt: 3_000,
      error: "worker-failed",
      parserVersion: null,
      boxCount: 0,
      detectedCount: 0,
      detectedIcon: null,
      candidateIcons: [],
      performance: { totalMs: 0, detectMs: 0, matchMs: 0, boxCount: 0 },
    };

    const payload = buildSpecialCoreIssueReportPayload({
      submittedAt: "2026-06-30T00:00:00.000Z",
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
      config: createDefaultSpecialCoreAlert(),
      roiPreviewUrl: "data:image/png;base64,fresh",
      roiRegionLabel: "960x540",
      snapshot: null,
      reportSnapshot,
      state,
      issue: { reason: "special-core-missed", label: "특수 코어를 찾지 못해요" },
    });

    expect(payload.sample.result).toMatchObject({
      detected: false,
      confidence: null,
      candidateCount: 0,
      debug: { error: "worker-failed", boxCount: 0, detectedCount: 0 },
    });
  });
});

function countDataUrls(value: unknown): number {
  if (typeof value === "string") {
    return value.startsWith("data:image/") ? 1 : 0;
  }
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countDataUrls(item), 0);
  }
  if (value && typeof value === "object") {
    return Object.values(value).reduce((total, item) => total + countDataUrls(item), 0);
  }
  return 0;
}
