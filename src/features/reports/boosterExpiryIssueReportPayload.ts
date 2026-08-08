import type {
  BoosterExpiryRuntimeState,
  BoosterExpiryRuntimeTraceFrame,
  BoosterExpirySnapshot,
  BoosterExpiryTimerEvidence,
} from "../../lib/boosterExpiry/boosterExpiryTypes";
import { createAlertReportPayload } from "../../contracts/reporting/alertReportContract";
import type { BoosterExpiryAlertConfig } from "../../types";
import { getAppBuildReportInfo } from "../../platform/runtime-build/currentAppBuildInfo";
import {
  getBoosterExpiryConfigSnapshot,
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
import type { BoosterExpiryIncidentReportEvidence } from "../../runtime/booster-expiry/evidence/boosterExpiryIncidentReportEvidence";

const BOOSTER_EXPIRY_REPORT_RUNTIME_TRACE_LIMIT = 300;
const BOOSTER_EXPIRY_REPORT_TIMER_EVIDENCE_LIMIT = 80;
const BOOSTER_EXPIRY_REPORT_CONFIRMATION_EVIDENCE_LIMIT = 12;
const BOOSTER_EXPIRY_REPORT_TIMER_EVIDENCE_DATA_URL_LIMIT = 12;
const BOOSTER_EXPIRY_REPORT_TIMER_EVIDENCE_DATA_URL_MAX_LENGTH = 24_000;

export function buildBoosterExpiryIssueReportPayload({
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
  config: BoosterExpiryAlertConfig;
  snapshot: BoosterExpirySnapshot;
  state: BoosterExpiryRuntimeState;
  incidentEvidence?: BoosterExpiryIncidentReportEvidence | null;
  issue: AlertIssueReportDetails;
  journalSelection?: AlertIncidentJournalSelection | null;
}) {
  const legacyRuntimeTrace = incidentEvidence ? [] : snapshot.runtimeTrace ?? [];
  const legacyTimerEvidence = incidentEvidence ? [] : snapshot.timerEvidence ?? [];
  const legacyConfirmationEvidence = incidentEvidence
    ? []
    : snapshot.confirmationEvidence ?? [];
  const latestTimerEvidence = getLatestBoosterExpiryTimerEvidence(
    legacyTimerEvidence,
  );
  const runtimeTrace = serializeBoosterExpiryRuntimeTrace(legacyRuntimeTrace);
  const timerEvidence = serializeBoosterExpiryTimerEvidence(
    legacyTimerEvidence,
    BOOSTER_EXPIRY_REPORT_TIMER_EVIDENCE_LIMIT,
  );
  const confirmationEvidence = serializeBoosterExpiryTimerEvidence(
    legacyConfirmationEvidence,
    BOOSTER_EXPIRY_REPORT_CONFIRMATION_EVIDENCE_LIMIT,
  );
  const hasAtomicTimerEvidence = timerEvidence.some(
    (entry) => Boolean(entry.stateBefore && entry.stateAfter),
  );
  const selectedIncidentTimestamps = incidentEvidence
    ? getBoosterExpiryIncidentTimestamps(incidentEvidence)
    : null;
  const selectedStateBinding = incidentEvidence?.observations.some(
    (entry) => Boolean(entry.stateBefore && entry.stateAfter),
  );
  const selectedMediaCount = incidentEvidence
    ? incidentEvidence.media.filter((entry) =>
        entry.imageDataUrl.startsWith("data:image/"),
      ).length
    : null;
  const selectedCycleId = incidentEvidence
    ? getLast(incidentEvidence.selection.cycleIds)
    : null;
  const incident = buildReportIncident({
    feature: "booster-expiry",
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
        ...timerEvidence.map((entry) => entry.sampledAt),
        ...confirmationEvidence.map((entry) => entry.sampledAt),
        state.lastAlertPlayback?.requestedAt,
        state.lastAlertPlayback?.startedAt,
        state.lastAlertPlayback?.finishedAt,
      ],
    frameCount: incidentEvidence?.frames.length,
    stateBinding: incidentEvidence
      ? selectedStateBinding
        ? "before-after"
        : "unavailable"
      : hasAtomicTimerEvidence
        ? "before-after"
        : "mixed",
    mediaCount:
      selectedMediaCount ??
      countPresentReportMedia(snapshot.rawPreviewUrl, snapshot.timerPreviewUrl) +
        timerEvidence.filter((entry) => Boolean(entry.dataUrl)).length +
        confirmationEvidence.filter((entry) => Boolean(entry.dataUrl)).length,
    cycleId:
      selectedCycleId ??
      state.lastAlertPlayback?.cycleId ??
      state.confirmedAt ??
      null,
    journalSelection,
    evidenceReferences: incidentEvidence
      ? createBoosterExpiryIncidentEvidenceReferences(incidentEvidence)
      : [
      createReportEvidenceReference({
        id: "booster-expiry-source",
        kind: "sourceImage",
        paths: [
          "sample.rawDataUrl",
          "sample.timerDataUrl",
          "sample.timerEvidence",
          "sample.confirmationEvidence",
        ],
        capturedAt: snapshot.sampledAt,
        frameId: `frame:${snapshot.sampledAt}`,
        cycleId: state.lastAlertPlayback?.cycleId ?? state.confirmedAt ?? null,
      }),
      createReportEvidenceReference({
        id: "booster-expiry-trace",
        kind: "temporalTrace",
        paths: ["sample.runtimeTrace"],
        capturedAt: snapshot.sampledAt,
        frameId: null,
        cycleId: state.confirmedAt,
      }),
      createReportEvidenceReference({
        id: "booster-expiry-state-binding",
        kind: "stateBeforeAfter",
        paths: hasAtomicTimerEvidence
          ? ["sample.timerEvidence", "sample.confirmationEvidence"]
          : [],
        capturedAt: latestTimerEvidence?.sampledAt ?? snapshot.sampledAt,
        frameId: null,
        cycleId: state.confirmedAt,
      }),
      createReportEvidenceReference({
        id: "booster-expiry-decision",
        kind: "decision",
        paths: ["sample.timerEvidence", "sample.result"],
        capturedAt: snapshot.sampledAt,
        frameId: null,
        cycleId: state.confirmedAt,
      }),
      createReportEvidenceReference({
        id: "booster-expiry-playback",
        kind: "playback",
        paths: ["boosterExpiry.state.lastAlertPlayback"],
        capturedAt: state.lastAlertPlayback?.requestedAt ?? null,
        frameId: null,
        cycleId: state.lastAlertPlayback?.cycleId ?? null,
      }),
      createReportEvidenceReference({
        id: "booster-expiry-config",
        kind: "configuration",
        paths: ["boosterExpiry.config"],
        capturedAt: snapshot.sampledAt,
        frameId: null,
        cycleId: null,
      }),
      createReportEvidenceReference({
        id: "booster-expiry-runtime",
        kind: "runtime",
        paths: ["sample.result.recognizerVersion"],
        capturedAt: snapshot.sampledAt,
        frameId: null,
        cycleId: null,
      }),
      ],
    completeness: incidentEvidence
      ? createBoosterExpiryIncidentCompleteness(incidentEvidence)
      : {
          sourceImage: Boolean(
            snapshot.rawPreviewUrl ||
              snapshot.timerPreviewUrl ||
              timerEvidence.some((entry) => entry.dataUrl),
          ),
          temporalTrace: runtimeTrace.length > 1,
          stateBeforeAfter: hasAtomicTimerEvidence,
          decision: runtimeTrace.length > 0 || timerEvidence.length > 0,
          playback: Object.prototype.hasOwnProperty.call(
            state,
            "lastAlertPlayback",
          ),
          affectedTarget: true,
        },
  });

  const payload = createAlertReportPayload({
    kind: "booster-expiry-issue",
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
      sampledAt: snapshot.sampledAt,
      rawDataUrl: incidentEvidence ? null : snapshot.rawPreviewUrl,
      timerDataUrl: incidentEvidence ? null : snapshot.timerPreviewUrl,
      regionLabel: snapshot.regionLabel,
      rawTime: snapshot.rawTime,
      time: snapshot.time,
      timeRect: snapshot.timeRect,
      flow: snapshot.flow,
      runtimeTrace,
      timerEvidence,
      confirmationEvidence,
      boosterExpiryEvidence: incidentEvidence,
      result: {
        value: getBoosterExpiryReportValue(snapshot),
        confidence: null,
        detected: Boolean(snapshot.time?.ok || snapshot.rawTime?.ok),
        recognizerVersion: snapshot.recognizerVersion ?? null,
        error: snapshot.error ?? null,
        performance: snapshot.performance ?? null,
        runtimeFailure: snapshot.runtimeFailure ?? null,
      },
    },
    boosterExpiry: {
      config: getBoosterExpiryConfigSnapshot(config),
      state,
      summary: {
        enabled: config.enabled,
        runtimeStatus: state.status,
        locked: state.locked,
        rawText: state.rawText,
        displayText: state.displayText,
        remainingSeconds: state.remainingSeconds,
        estimatedExpiresAt: state.estimatedExpiresAt,
        alertAt: state.alertAt,
        alertedAt: state.alertedAt,
        flowSource: state.flowSource,
      },
      lastSnapshot: {
        sampledAt: snapshot.sampledAt,
        recognizerVersion: snapshot.recognizerVersion ?? null,
        regionLabel: snapshot.regionLabel,
        rawText: snapshot.rawTime?.text ?? null,
        displayText: snapshot.time?.text ?? null,
        flowSource: snapshot.flow?.source ?? null,
        locked: snapshot.flow?.locked ?? false,
        runtimeTraceFrameCount: runtimeTrace.length,
        timerEvidenceCount: timerEvidence.length,
        confirmationEvidenceCount: confirmationEvidence.length,
        latestTimerEvidence,
        performance: snapshot.performance ?? null,
      },
      reportReason: issue.reason,
    },
  });
  if (incidentEvidence) {
    lockBoosterExpiryIncidentToSelectedEvidence(
      payload.incident,
      incidentEvidence,
    );
  }
  return payload;
}

function lockBoosterExpiryIncidentToSelectedEvidence(
  incident: ReturnType<typeof buildReportIncident>,
  evidence: BoosterExpiryIncidentReportEvidence,
): void {
  const timestamps = getBoosterExpiryIncidentTimestamps(evidence).filter(
    (entry): entry is number =>
      typeof entry === "number" && Number.isFinite(entry) && entry > 0,
  );
  const selectedCycleId = getLast(evidence.selection.cycleIds);
  const hasStateBinding = evidence.observations.some(
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
    mediaCount: evidence.media.filter((entry) =>
      entry.imageDataUrl.startsWith("data:image/"),
    ).length,
  };
  incident.completeness = createBoosterExpiryIncidentCompleteness(evidence);
  incident.correlation = {
    frameIds: [...evidence.selection.frameIds],
    cycleIds: [...evidence.selection.cycleIds],
    playbackIds: [...evidence.selection.playbackAttemptIds],
    relatedPlaybackIds: [...evidence.selection.relatedPlaybackIds],
    configRevisions: [...evidence.selection.configurationRevisionIds],
  };
  incident.evidenceManifest.references =
    incident.evidenceManifest.references.map((reference) => {
      const paths = removeJournalFallbackPaths(reference.paths);
      const producedPaths = removeJournalFallbackPaths(
        reference.producedPaths,
      );
      const retainedPaths = removeJournalFallbackPaths(
        reference.retainedPaths,
      );
      return {
        ...reference,
        paths,
        produced: producedPaths.length > 0,
        producedPaths,
        retained: retainedPaths.length > 0,
        retainedPaths,
      };
    });
}

function createBoosterExpiryIncidentEvidenceReferences(
  evidence: BoosterExpiryIncidentReportEvidence,
) {
  const capturedAt =
    evidence.selection.selectedEventAt ?? evidence.frozenAt;
  const frameId = getLast(evidence.selection.frameIds);
  const cycleId = getLast(evidence.selection.cycleIds);
  return [
    createReportEvidenceReference({
      id: "booster-expiry-incident-source",
      kind: "sourceImage",
      paths:
        evidence.media.length > 0
          ? ["sample.boosterExpiryEvidence.media"]
          : [],
      capturedAt,
      frameId,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "booster-expiry-incident-trace",
      kind: "temporalTrace",
      paths:
        evidence.observations.length > 0
          ? [
              "sample.boosterExpiryEvidence.frames",
              "sample.boosterExpiryEvidence.observations",
              "sample.boosterExpiryEvidence.candidateAttempts",
              "sample.boosterExpiryEvidence.cycles",
            ]
          : [],
      capturedAt,
      frameId,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "booster-expiry-incident-state-binding",
      kind: "stateBeforeAfter",
      paths: evidence.observations.some(
        (entry) => entry.stateBefore && entry.stateAfter,
      )
        ? ["sample.boosterExpiryEvidence.observations"]
        : [],
      capturedAt,
      frameId,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "booster-expiry-incident-decision",
      kind: "decision",
      paths:
        evidence.observations.length > 0 ||
        evidence.candidateAttempts.length > 0 ||
        evidence.cycles.length > 0 ||
        evidence.schedules.length > 0 ||
        evidence.decisions.length > 0
          ? [
              "sample.boosterExpiryEvidence.observations",
              "sample.boosterExpiryEvidence.candidateAttempts",
              "sample.boosterExpiryEvidence.cycles",
              "sample.boosterExpiryEvidence.schedules",
              "sample.boosterExpiryEvidence.decisions",
            ]
          : [],
      capturedAt,
      frameId,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "booster-expiry-incident-playback",
      kind: "playback",
      paths: [
        ...(evidence.playbackAttempts.length > 0
          ? ["sample.boosterExpiryEvidence.playbackAttempts"]
          : []),
        ...(evidence.relatedPlayback.length > 0
          ? ["sample.boosterExpiryEvidence.relatedPlayback"]
          : []),
      ],
      capturedAt,
      frameId,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "booster-expiry-incident-config",
      kind: "configuration",
      paths:
        evidence.configurations.length > 0
          ? ["sample.boosterExpiryEvidence.configurations"]
          : [],
      capturedAt,
      frameId: null,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "booster-expiry-incident-runtime",
      kind: "runtime",
      paths:
        evidence.frames.length > 0 || evidence.observations.length > 0
          ? [
              "sample.boosterExpiryEvidence.flowEpochs",
              "sample.boosterExpiryEvidence.frames",
              "sample.boosterExpiryEvidence.observations",
              "sample.boosterExpiryEvidence.lifecycle",
            ]
          : [],
      capturedAt,
      frameId,
      cycleId,
    }),
  ];
}

function createBoosterExpiryIncidentCompleteness(
  evidence: BoosterExpiryIncidentReportEvidence,
) {
  return {
    sourceImage: evidence.media.some((entry) =>
      entry.imageDataUrl.startsWith("data:image/"),
    ),
    temporalTrace: evidence.observations.length > 1,
    stateBeforeAfter: evidence.observations.some(
      (entry) => Boolean(entry.stateBefore && entry.stateAfter),
    ),
    decision:
      evidence.observations.length > 0 ||
      evidence.candidateAttempts.length > 0 ||
      evidence.cycles.length > 0 ||
      evidence.schedules.length > 0 ||
      evidence.decisions.length > 0,
    playback:
      evidence.playbackAttempts.length > 0 ||
      evidence.relatedPlayback.length > 0,
    affectedTarget: true,
  };
}

function getBoosterExpiryIncidentTimestamps(
  evidence: BoosterExpiryIncidentReportEvidence,
): Array<number | null> {
  return [
    ...evidence.resetEpochs.map((entry) => entry.startedAt),
    ...evidence.configurations.map((entry) => entry.capturedAt),
    ...evidence.flowEpochs.map((entry) => entry.startedAt),
    ...evidence.frames.map((entry) => entry.sampledAt),
    ...evidence.observations.map((entry) => entry.sampledAt),
    ...evidence.candidateAttempts.flatMap((entry) => [
      entry.startedAt,
      entry.lastObservedAt,
      entry.endedAt,
    ]),
    ...evidence.cycles.flatMap((entry) => [
      entry.confirmedAt,
      entry.lastSupportedAt,
      entry.endedAt,
    ]),
    ...evidence.schedules.flatMap((entry) => [
      entry.registeredAt,
      entry.endedAt,
    ]),
    ...evidence.decisions.map((entry) => entry.occurredAt),
    ...evidence.playbackAttempts.flatMap((entry) => [
      entry.requestedAt,
      entry.browserAcceptedAt,
      entry.finishedAt,
      entry.failedAt,
    ]),
    ...evidence.relatedPlayback.flatMap((entry) => [
      entry.requestedAt,
      entry.browserAcceptedAt,
      entry.finishedAt,
      entry.failedAt,
    ]),
    ...evidence.lifecycle.map((entry) => entry.occurredAt),
  ];
}

function removeJournalFallbackPaths(paths: string[]): string[] {
  return paths.filter(
    (path) =>
      path !== "incident.journal.entries" &&
      path !== "incident.journal.coverage.playbackLifecycleMonitored",
  );
}

function getLast<T>(values: T[]): T | null {
  return values[values.length - 1] ?? null;
}

function getLatestBoosterExpiryTimerEvidence(history: BoosterExpiryTimerEvidence[]) {
  const latest = history[history.length - 1] ?? null;
  if (!latest) {
    return null;
  }

  return {
    sampledAt: latest.sampledAt,
    eventType: latest.eventType ?? null,
    rawText: latest.rawText,
    displayText: latest.displayText,
    rawRemainingSeconds: latest.rawRemainingSeconds,
    remainingSeconds: latest.remainingSeconds,
    predictedExpiresAt: latest.predictedExpiresAt,
    confirmedExpiresAt: latest.confirmedExpiresAt,
    alertAt: latest.alertAt,
    flowSource: latest.flowSource,
    locked: latest.locked,
    decision: latest.decision,
    format: latest.format,
    selectedBy: latest.selectedBy,
    stateBefore: latest.stateBefore ?? null,
    stateAfter: latest.stateAfter ?? null,
  };
}

function getBoosterExpiryReportValue(
  snapshot: BoosterExpirySnapshot,
): string | null {
  if (snapshot.flow?.source === "predicted-rejected-raw") {
    return snapshot.rawTime?.text ?? null;
  }
  return snapshot.time?.text ?? snapshot.rawTime?.text ?? null;
}

function serializeBoosterExpiryRuntimeTrace(history: BoosterExpiryRuntimeTraceFrame[]) {
  return history.slice(-BOOSTER_EXPIRY_REPORT_RUNTIME_TRACE_LIMIT).map((frame) => ({
    sampledAt: frame.sampledAt,
    status: frame.status,
    rawText: frame.rawText,
    displayText: frame.displayText,
    rawRemainingSeconds: frame.rawRemainingSeconds,
    remainingSeconds: frame.remainingSeconds,
    estimatedExpiresAt: frame.estimatedExpiresAt,
    alertAt: frame.alertAt,
    cycleCandidateObservationCount: frame.cycleCandidateObservationCount,
    cycleCandidateDecreaseSeconds: frame.cycleCandidateDecreaseSeconds,
    confirmedAt: frame.confirmedAt,
    confirmedExpiresAt: frame.confirmedExpiresAt,
    confirmedLastSupportedAt: frame.confirmedLastSupportedAt,
    confirmedContradictionCount: frame.confirmedContradictionCount,
    alerted: frame.alerted,
    flowSource: frame.flowSource,
    locked: frame.locked,
    decision: frame.decision,
    rect: frame.rect,
    performance: frame.performance,
    runtimeFailure: frame.runtimeFailure ?? null,
  }));
}

function serializeBoosterExpiryTimerEvidence(
  history: BoosterExpiryTimerEvidence[],
  limit: number,
) {
  let includedDataUrlCount = 0;
  return history.slice(-limit).map((entry) => {
    const canIncludeDataUrl = Boolean(
      entry.dataUrl &&
        entry.dataUrl.length <= BOOSTER_EXPIRY_REPORT_TIMER_EVIDENCE_DATA_URL_MAX_LENGTH &&
        includedDataUrlCount < BOOSTER_EXPIRY_REPORT_TIMER_EVIDENCE_DATA_URL_LIMIT,
    );
    if (canIncludeDataUrl) {
      includedDataUrlCount += 1;
    }

    return {
      sampledAt: entry.sampledAt,
      eventType: entry.eventType ?? null,
      dataUrl: canIncludeDataUrl ? entry.dataUrl : null,
      rect: entry.rect,
      rawText: entry.rawText,
      displayText: entry.displayText,
      rawRemainingSeconds: entry.rawRemainingSeconds,
      remainingSeconds: entry.remainingSeconds,
      predictedExpiresAt: entry.predictedExpiresAt,
      confirmedExpiresAt: entry.confirmedExpiresAt,
      alertAt: entry.alertAt,
      flowSource: entry.flowSource,
      locked: entry.locked,
      decision: entry.decision,
      format: entry.format,
      selectedBy: entry.selectedBy,
      stateBefore: entry.stateBefore ?? null,
      stateAfter: entry.stateAfter ?? null,
    };
  });
}
