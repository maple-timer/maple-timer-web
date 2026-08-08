import type {
  HuntStallCropHistoryFrame,
  HuntStallRuntimeState,
  HuntStallRuntimeTraceFrame,
  HuntStallSnapshot,
} from "../../alertTypes";
import { createAlertReportPayload } from "../../contracts/reporting/alertReportContract";
import type { HuntStallAlertConfig } from "../../types";
import { getAppBuildReportInfo } from "../../platform/runtime-build/currentAppBuildInfo";
import {
  COOLDOWN_DIGIT_RECOGNIZER_VERSION,
} from "../../contracts/recognition/cooldownDigitRecognition";
import { HUNT_STALL_EXPERIENCE_RECOGNIZER_VERSION } from "../../lib/recognizerVersions";
import {
  getHuntStallConfigSnapshot,
  type AlertIssueReportDetails,
  type CaptureDiagnostics,
  type ReportBase,
} from "./alertReportPayloadShared";
import {
  buildReportIncident,
  countPresentReportMedia,
  createReportEvidenceReference,
} from "./reportIncidentEvidence";
import type { AlertIncidentJournalSelection } from "../../application/reporting/alertIncidentJournal";
import type { HuntStallIncidentReportEvidence } from "../../runtime/hunt-stall/evidence/huntStallIncidentReportEvidence";

const HUNT_STALL_REPORT_RUNTIME_TRACE_LIMIT = 300;
const HUNT_STALL_REPORT_CROP_HISTORY_LIMIT = 12;
const HUNT_STALL_REPORT_RAW_CROP_DATA_URL_MAX_LENGTH = 30_000;
const HUNT_STALL_REPORT_PROCESSED_CROP_DATA_URL_MAX_LENGTH = 12_000;

export function buildHuntStallDebugReportPayload({
  submittedAt,
  url,
  clientId,
  viewportDiagnostics,
  captureDiagnostics,
  config,
  snapshot,
  state,
}: ReportBase & {
  clientId: string;
  captureDiagnostics: CaptureDiagnostics;
  config: HuntStallAlertConfig;
  snapshot: HuntStallSnapshot;
  state: HuntStallRuntimeState;
}) {
  return createAlertReportPayload({
    kind: "hunt-stall-debug",
    submittedAt,
    url,
    appBuild: getAppBuildReportInfo(),
    clientId,
    diagnostics: {
      ...viewportDiagnostics,
      capture: captureDiagnostics,
    },
    sample: buildHuntStallSamplePayload(snapshot),
    huntStall: {
      config: getHuntStallConfigSnapshot(config),
      state,
      lastSnapshot: buildHuntStallLastSnapshotPayload(snapshot),
      reportReason: "debug",
    },
  });
}

export function buildHuntStallIssueReportPayload({
  submittedAt,
  url,
  clientId,
  viewportDiagnostics,
  captureDiagnostics,
  config,
  snapshot,
  state,
  incidentEvidence = null,
  issue,
  journalSelection = null,
}: ReportBase & {
  clientId: string;
  captureDiagnostics: CaptureDiagnostics;
  config: HuntStallAlertConfig;
  snapshot: HuntStallSnapshot;
  state: HuntStallRuntimeState;
  incidentEvidence?: HuntStallIncidentReportEvidence | null;
  issue: AlertIssueReportDetails;
  journalSelection?: AlertIncidentJournalSelection | null;
}) {
  const runtimeTrace = serializeHuntStallRuntimeTrace(snapshot.runtimeTrace ?? []);
  const cropHistory = serializeHuntStallCropHistory(snapshot.cropHistory ?? []);
  const hasAtomicCropHistory = cropHistory.some(
    (entry) => Boolean(entry.stateBefore && entry.stateAfter),
  );
  const cropCandidates = serializeHuntStallCropCandidates(snapshot);
  const selectedIncidentTimestamps = incidentEvidence
    ? [
        ...incidentEvidence.frames.map((entry) => entry.sampledAt),
        ...incidentEvidence.decisions.map((entry) => entry.occurredAt),
        ...incidentEvidence.playbackAttempts.flatMap((entry) => [
          entry.requestedAt,
          entry.startedAt,
          entry.finishedAt,
          entry.failedAt,
        ]),
        ...incidentEvidence.lifecycle.map((entry) => entry.occurredAt),
      ]
    : null;
  const selectedStateBinding = incidentEvidence?.frames.some(
    (entry) => Boolean(entry.stateBefore && entry.stateAfter),
  );
  const selectedMediaCount = incidentEvidence
    ? incidentEvidence.media.reduce(
        (count, entry) =>
          countPresentReportMedia(entry.rawDataUrl, entry.processedDataUrl) + count,
        0,
      )
    : null;
  const selectedCycleIds = incidentEvidence?.selection.cycleIds ?? [];
  const selectedCycleId =
    selectedCycleIds[selectedCycleIds.length - 1] ?? null;
  const incident = buildReportIncident({
    feature: "hunt-stall",
    issue,
    submittedAt,
    source: incidentEvidence ? "runtime-atomic" : "mixed",
    sampledAt:
      incidentEvidence?.selection.selectedEventAt ??
      incidentEvidence?.frozenAt ??
      snapshot.sampledAt,
    timestamps:
      selectedIncidentTimestamps ?? [
        ...runtimeTrace.map((entry) => entry.sampledAt),
        ...cropHistory.map((entry) => entry.sampledAt),
        state.lastAlertPlayback?.requestedAt,
        state.lastAlertPlayback?.startedAt,
        state.lastAlertPlayback?.finishedAt,
      ],
    stateBinding: incidentEvidence
      ? selectedStateBinding
        ? "before-after"
        : "unavailable"
      : hasAtomicCropHistory
        ? "before-after"
        : "mixed",
    mediaCount:
      selectedMediaCount ??
      countPresentReportMedia(
        snapshot.rawPreviewUrl,
        snapshot.processedPreviewUrl,
        snapshot.fullFramePreviewUrl,
      ) +
        cropHistory.reduce(
          (count, entry) =>
            countPresentReportMedia(entry.rawDataUrl, entry.processedDataUrl) + count,
          0,
        ) +
        cropCandidates.reduce(
          (count, entry) =>
            countPresentReportMedia(entry.rawDataUrl, entry.processedDataUrl) + count,
          0,
        ),
    cycleId: incidentEvidence
      ? selectedCycleId
      : state.lastAlertPlayback?.cycleId ?? null,
    journalSelection,
    evidenceReferences: incidentEvidence
      ? createHuntStallIncidentEvidenceReferences(incidentEvidence)
      : [
      createReportEvidenceReference({
        id: "hunt-stall-source",
        kind: "sourceImage",
        paths: [
          "sample.rawDataUrl",
          "sample.processedDataUrl",
          "sample.cropHistory",
          "sample.cropCandidates",
        ],
        capturedAt: snapshot.sampledAt,
        frameId: `frame:${snapshot.sampledAt}`,
        cycleId: state.lastAlertPlayback?.cycleId ?? null,
      }),
      createReportEvidenceReference({
        id: "hunt-stall-trace",
        kind: "temporalTrace",
        paths: ["sample.runtimeTrace"],
        capturedAt: snapshot.sampledAt,
        frameId: null,
        cycleId: state.lastAlertPlayback?.cycleId ?? null,
      }),
      createReportEvidenceReference({
        id: "hunt-stall-state-binding",
        kind: "stateBeforeAfter",
        paths: hasAtomicCropHistory ? ["sample.cropHistory"] : [],
        capturedAt: snapshot.sampledAt,
        frameId: null,
        cycleId: state.lastAlertPlayback?.cycleId ?? null,
      }),
      createReportEvidenceReference({
        id: "hunt-stall-decision",
        kind: "decision",
        paths: ["sample.runtimeTrace", "sample.cropHistory", "sample.result"],
        capturedAt: snapshot.sampledAt,
        frameId: null,
        cycleId: state.lastAlertPlayback?.cycleId ?? null,
      }),
      createReportEvidenceReference({
        id: "hunt-stall-playback",
        kind: "playback",
        paths: ["huntStall.state.lastAlertPlayback"],
        capturedAt: state.lastAlertPlayback?.requestedAt ?? null,
        frameId: null,
        cycleId: state.lastAlertPlayback?.cycleId ?? null,
      }),
      createReportEvidenceReference({
        id: "hunt-stall-config",
        kind: "configuration",
        paths: ["huntStall.config"],
        capturedAt: snapshot.sampledAt,
        frameId: null,
        cycleId: null,
      }),
      createReportEvidenceReference({
        id: "hunt-stall-runtime",
        kind: "runtime",
        paths: ["sample.result.recognizerVersion"],
        capturedAt: snapshot.sampledAt,
        frameId: null,
        cycleId: null,
      }),
      ],
    completeness: incidentEvidence
      ? createHuntStallIncidentCompleteness(incidentEvidence)
      : {
          sourceImage: Boolean(
            snapshot.rawPreviewUrl ||
              cropHistory.some(
                (entry) => entry.rawDataUrl || entry.processedDataUrl,
              ) ||
              cropCandidates.some(
                (entry) => entry.rawDataUrl || entry.processedDataUrl,
              ),
          ),
          temporalTrace: runtimeTrace.length > 1,
          stateBeforeAfter: hasAtomicCropHistory,
          decision: runtimeTrace.length > 0,
          playback: Object.prototype.hasOwnProperty.call(
            state,
            "lastAlertPlayback",
          ),
          affectedTarget: true,
        },
  });
  const payload = createAlertReportPayload({
    kind: "hunt-stall-issue",
    submittedAt,
    url,
    appBuild: getAppBuildReportInfo(),
    clientId,
    reportIssue: issue,
    incident,
    diagnostics: {
      ...viewportDiagnostics,
      capture: captureDiagnostics,
    },
    sample: {
      ...buildHuntStallSamplePayload(snapshot, {
        runtimeTrace,
        cropHistory,
        cropCandidates,
      }),
      huntStallEvidence: incidentEvidence,
    },
    huntStall: {
      config: getHuntStallConfigSnapshot(config),
      state,
      lastSnapshot: buildHuntStallLastSnapshotPayload(snapshot),
      reportReason: issue.reason,
    },
  });
  if (incidentEvidence) {
    lockHuntStallIncidentToSelectedEvidence(payload.incident, incidentEvidence);
  }
  return payload;
}

function lockHuntStallIncidentToSelectedEvidence(
  incident: ReturnType<typeof buildReportIncident>,
  evidence: HuntStallIncidentReportEvidence,
): void {
  const timestamps = [
    ...evidence.frames.map((entry) => entry.sampledAt),
    ...evidence.decisions.map((entry) => entry.occurredAt),
    ...evidence.playbackAttempts.flatMap((entry) => [
      entry.requestedAt,
      entry.startedAt,
      entry.finishedAt,
      entry.failedAt,
    ]),
    ...evidence.lifecycle.map((entry) => entry.occurredAt),
  ].filter(
    (entry): entry is number =>
      typeof entry === "number" && Number.isFinite(entry) && entry > 0,
  );
  const selectedCycleId =
    evidence.selection.cycleIds[evidence.selection.cycleIds.length - 1] ?? null;
  const completeness = createHuntStallIncidentCompleteness(evidence);
  const hasStateBinding = evidence.frames.some(
    (entry) => Boolean(entry.stateBefore && entry.stateAfter),
  );

  incident.cycleId = selectedCycleId;
  incident.evidence = {
    ...incident.evidence,
    source: "runtime-atomic",
    sampledAt: evidence.selection.selectedEventAt ?? evidence.frozenAt,
    windowStartedAt: timestamps.length > 0 ? Math.min(...timestamps) : null,
    windowEndedAt: timestamps.length > 0 ? Math.max(...timestamps) : null,
    frameCount: evidence.frames.length,
    stateBinding: hasStateBinding ? "before-after" : "unavailable",
    mediaCount: evidence.media.reduce(
      (count, entry) =>
        countPresentReportMedia(entry.rawDataUrl, entry.processedDataUrl) + count,
      0,
    ),
  };
  incident.completeness = completeness;
  incident.correlation = {
    frameIds: [...evidence.selection.frameIds],
    cycleIds: [...evidence.selection.cycleIds],
    playbackIds: [...evidence.selection.attemptIds],
    relatedPlaybackIds: [...evidence.selection.relatedPlaybackIds],
    configRevisions: [...evidence.selection.configurationRevisionIds],
  };
  incident.evidenceManifest.references = incident.evidenceManifest.references.map(
    (reference) => {
      const paths = reference.paths.filter(
        (path) =>
          path !== "incident.journal.entries" &&
          path !== "incident.journal.coverage.playbackLifecycleMonitored",
      );
      const producedPaths = reference.producedPaths.filter(
        (path) =>
          path !== "incident.journal.entries" &&
          path !== "incident.journal.coverage.playbackLifecycleMonitored",
      );
      const retainedPaths = reference.retainedPaths.filter(
        (path) =>
          path !== "incident.journal.entries" &&
          path !== "incident.journal.coverage.playbackLifecycleMonitored",
      );
      return {
        ...reference,
        paths,
        produced: producedPaths.length > 0,
        producedPaths,
        retained: retainedPaths.length > 0,
        retainedPaths,
      };
    },
  );
}

function createHuntStallIncidentEvidenceReferences(
  evidence: HuntStallIncidentReportEvidence,
) {
  const capturedAt =
    evidence.selection.selectedEventAt ?? evidence.frozenAt;
  const frameId =
    evidence.selection.frameIds[evidence.selection.frameIds.length - 1] ?? null;
  const cycleId =
    evidence.selection.cycleIds[evidence.selection.cycleIds.length - 1] ?? null;
  return [
    createReportEvidenceReference({
      id: "hunt-stall-incident-source",
      kind: "sourceImage",
      paths: evidence.media.length > 0 ? ["sample.huntStallEvidence.media"] : [],
      capturedAt,
      frameId,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "hunt-stall-incident-trace",
      kind: "temporalTrace",
      paths:
        evidence.observations.length > 0
          ? [
              "sample.huntStallEvidence.frames",
              "sample.huntStallEvidence.observations",
              "sample.huntStallEvidence.stallEpisodes",
            ]
          : [],
      capturedAt,
      frameId,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "hunt-stall-incident-state-binding",
      kind: "stateBeforeAfter",
      paths: evidence.frames.some((entry) => entry.stateBefore && entry.stateAfter)
        ? ["sample.huntStallEvidence.frames"]
        : [],
      capturedAt,
      frameId,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "hunt-stall-incident-decision",
      kind: "decision",
      paths:
        evidence.decisions.length > 0 || evidence.stallEpisodes.length > 0
          ? [
              "sample.huntStallEvidence.stallEpisodes",
              "sample.huntStallEvidence.decisions",
            ]
          : [],
      capturedAt,
      frameId,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "hunt-stall-incident-playback",
      kind: "playback",
      paths:
        evidence.playbackAttempts.length > 0
          ? ["sample.huntStallEvidence.playbackAttempts"]
          : [],
      capturedAt,
      frameId,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "hunt-stall-incident-config",
      kind: "configuration",
      paths:
        evidence.configurations.length > 0
          ? ["sample.huntStallEvidence.configurations"]
          : [],
      capturedAt,
      frameId: null,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "hunt-stall-incident-runtime",
      kind: "runtime",
      paths:
        evidence.frames.some((entry) => entry.recognizer)
          ? ["sample.huntStallEvidence.frames"]
          : [],
      capturedAt,
      frameId,
      cycleId,
    }),
  ];
}

function createHuntStallIncidentCompleteness(
  evidence: HuntStallIncidentReportEvidence,
) {
  return {
    sourceImage: evidence.media.some(
      (entry) => entry.rawDataUrl || entry.processedDataUrl,
    ),
    temporalTrace: evidence.observations.length > 1,
    stateBeforeAfter: evidence.frames.some(
      (entry) => Boolean(entry.stateBefore && entry.stateAfter),
    ),
    decision:
      evidence.decisions.length > 0 || evidence.stallEpisodes.length > 0,
    playback: evidence.playbackAttempts.length > 0,
    affectedTarget: true,
  };
}

function buildHuntStallSamplePayload(
  snapshot: HuntStallSnapshot,
  serialized: {
    runtimeTrace: ReturnType<typeof serializeHuntStallRuntimeTrace>;
    cropHistory: ReturnType<typeof serializeHuntStallCropHistory>;
    cropCandidates: ReturnType<typeof serializeHuntStallCropCandidates>;
  } = {
    runtimeTrace: serializeHuntStallRuntimeTrace(snapshot.runtimeTrace ?? []),
    cropHistory: serializeHuntStallCropHistory(snapshot.cropHistory ?? []),
    cropCandidates: serializeHuntStallCropCandidates(snapshot),
  },
) {
  return {
    sampledAt: snapshot.sampledAt,
    mode: snapshot.mode ?? "manual-experience",
    rawDataUrl: snapshot.rawPreviewUrl,
    processedDataUrl: snapshot.processedPreviewUrl ?? snapshot.rawPreviewUrl,
    fullFrameDataUrl: snapshot.fullFramePreviewUrl ?? null,
    cropCandidates: serialized.cropCandidates,
    runtimeTrace: serialized.runtimeTrace,
    cropHistory: serialized.cropHistory,
    regionLabel: snapshot.regionLabel,
    pixelRegion: null,
    result: {
      recognizerVersion:
        snapshot.mode === "cooldown-presence"
          ? COOLDOWN_DIGIT_RECOGNIZER_VERSION
          : HUNT_STALL_EXPERIENCE_RECOGNIZER_VERSION,
      value: snapshot.recognizedText,
      debugText: snapshot.debugText ?? null,
      confidence: snapshot.confidence,
      foregroundRatio: snapshot.foregroundRatio,
      changeScore: snapshot.changeScore,
      cooldownVisualActivity: serializeHuntStallCooldownVisualActivity(snapshot),
      candidateCount: snapshot.cropCandidates?.length ?? null,
      performance: snapshot.performance ?? null,
      runtimeFailure: snapshot.runtimeFailure ?? null,
    },
  };
}

function buildHuntStallLastSnapshotPayload(snapshot: HuntStallSnapshot) {
  return {
    sampledAt: snapshot.sampledAt,
    mode: snapshot.mode ?? "manual-experience",
    regionLabel: snapshot.regionLabel,
    recognizedText: snapshot.recognizedText,
    debugText: snapshot.debugText ?? null,
    confidence: snapshot.confidence,
    foregroundRatio: snapshot.foregroundRatio,
    changeScore: snapshot.changeScore,
    cooldownVisualActivity: serializeHuntStallCooldownVisualActivity(snapshot),
    candidateCount: snapshot.cropCandidates?.length ?? null,
    runtimeTraceFrameCount: snapshot.runtimeTrace?.length ?? 0,
    cropHistoryFrameCount: snapshot.cropHistory?.length ?? 0,
    performance: snapshot.performance ?? null,
  };
}

function serializeHuntStallRuntimeTrace(trace: HuntStallRuntimeTraceFrame[]) {
  return trace.slice(-HUNT_STALL_REPORT_RUNTIME_TRACE_LIMIT).map((frame) => ({
    sampledAt: frame.sampledAt,
    mode: frame.mode,
    status: frame.status,
    lastDecision: frame.lastDecision,
    shouldAlert: frame.shouldAlert,
    recognizedText: frame.recognizedText,
    snapshotRecognizedText: frame.snapshotRecognizedText,
    alertedRecognizedText: frame.alertedRecognizedText,
    pendingRecognizedText: frame.pendingRecognizedText,
    pendingRecognizedCount: frame.pendingRecognizedCount,
    lastRejectedRecognizedText: frame.lastRejectedRecognizedText,
    lastReadFailureReason: frame.lastReadFailureReason,
    confidence: frame.confidence,
    foregroundRatio: frame.foregroundRatio,
    unchangedSeconds: frame.unchangedSeconds,
    stableSampleCount: frame.stableSampleCount,
    lastChangedAt: frame.lastChangedAt,
    lastReadableAt: frame.lastReadableAt,
    lastReadFailureAt: frame.lastReadFailureAt,
    alertedAt: frame.alertedAt,
    alertDecision: frame.alertDecision ?? null,
    lastRepeatedAlertAt: frame.lastRepeatedAlertAt ?? null,
    repeatedAlertCount: frame.repeatedAlertCount ?? 0,
    lastAlertedAt: frame.lastAlertedAt ?? null,
    lastAlertPlaybackStatus: frame.lastAlertPlaybackStatus ?? null,
    lastAlertPlaybackRequestedAt: frame.lastAlertPlaybackRequestedAt ?? null,
    lastAlertPlaybackStartedAt: frame.lastAlertPlaybackStartedAt ?? null,
    lastAlertPlaybackFinishedAt: frame.lastAlertPlaybackFinishedAt ?? null,
    hasObservedCooldownPresence: frame.hasObservedCooldownPresence,
    cooldownLastDetectedAt: frame.cooldownLastDetectedAt,
    cooldownMissingSeconds: frame.cooldownMissingSeconds,
    cooldownConsecutiveReadableCount: frame.cooldownConsecutiveReadableCount,
    cooldownVisualChangeScore: frame.cooldownVisualChangeScore,
    cooldownVisualChanged: frame.cooldownVisualChanged,
    cooldownUsedVisualActivity: frame.cooldownUsedVisualActivity,
    runtimeFailure: frame.runtimeFailure ?? null,
  }));
}

function serializeHuntStallCropHistory(history: HuntStallCropHistoryFrame[]) {
  return history.slice(-HUNT_STALL_REPORT_CROP_HISTORY_LIMIT).map((frame) => ({
    sampledAt: frame.sampledAt,
    mode: frame.mode,
    reasons: frame.reasons,
    rawDataUrl: keepHuntStallCropDataUrl(
      frame.rawDataUrl,
      HUNT_STALL_REPORT_RAW_CROP_DATA_URL_MAX_LENGTH,
    ),
    processedDataUrl: keepHuntStallCropDataUrl(
      frame.processedDataUrl,
      HUNT_STALL_REPORT_PROCESSED_CROP_DATA_URL_MAX_LENGTH,
    ),
    rawDataUrlOmitted: isHuntStallCropDataUrlOmitted(
      frame.rawDataUrl,
      HUNT_STALL_REPORT_RAW_CROP_DATA_URL_MAX_LENGTH,
    ),
    processedDataUrlOmitted: isHuntStallCropDataUrlOmitted(
      frame.processedDataUrl,
      HUNT_STALL_REPORT_PROCESSED_CROP_DATA_URL_MAX_LENGTH,
    ),
    regionLabel: frame.regionLabel,
    recognizedText: frame.recognizedText,
    debugText: frame.debugText ?? null,
    confidence: frame.confidence,
    foregroundRatio: frame.foregroundRatio,
    changeScore: frame.changeScore,
    cooldownVisualActivity: {
      changeScore: frame.cooldownVisualChangeScore,
      changed: frame.cooldownVisualChanged,
      usedForActivity: frame.cooldownUsedVisualActivity,
    },
    state: frame.state,
    stateBefore: frame.stateBefore ?? null,
    stateAfter: frame.stateAfter ?? frame.state,
  }));
}

function keepHuntStallCropDataUrl(dataUrl: string | null | undefined, maxLength: number) {
  return dataUrl && dataUrl.length <= maxLength
    ? dataUrl
    : null;
}

function isHuntStallCropDataUrlOmitted(dataUrl: string | null | undefined, maxLength: number) {
  return Boolean(dataUrl && dataUrl.length > maxLength);
}

function serializeHuntStallCropCandidates(snapshot: HuntStallSnapshot) {
  return (snapshot.cropCandidates ?? []).map((candidate, index) => ({
    index,
    label: candidate.label,
    regionLabel: candidate.regionLabel,
    pixelRegion: candidate.pixelRegion,
    score: candidate.score,
    selected: candidate.selected,
    rawDataUrl: candidate.rawPreviewUrl,
    processedDataUrl: candidate.processedPreviewUrl,
    recognizedText: candidate.recognizedText,
    debugText: candidate.debugText ?? null,
    confidence: candidate.confidence,
    foregroundRatio: candidate.foregroundRatio,
    barPercent: candidate.barPercent,
    barConfidence: candidate.barConfidence,
    barCoverage: candidate.barCoverage,
    performance: candidate.performance ?? null,
  }));
}

function serializeHuntStallCooldownVisualActivity(snapshot: HuntStallSnapshot) {
  if (snapshot.mode !== "cooldown-presence") {
    return null;
  }

  return {
    changeScore: snapshot.cooldownVisualChangeScore ?? null,
    changed: snapshot.cooldownVisualChanged === true,
    usedForActivity: snapshot.cooldownUsedVisualActivity === true,
  };
}
