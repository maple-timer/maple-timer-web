import type {
  RuneAlertTriggerEvidence,
  RuneRuntimeIncidentEvidence,
  RuneSnapshot,
  RuneRuntimeState,
} from "../../alertTypes";
import { createAlertReportPayload } from "../../contracts/reporting/alertReportContract";
import type {
  RelativeRegion,
  RuneAlertConfig,
} from "../../types";
import type { sampleVideoRegion } from "../../lib/capture";
import { getAppBuildReportInfo } from "../../platform/runtime-build/currentAppBuildInfo";
import type { RuneDetectionResult } from "../../recognition/rune/runeDetectionTypes";
import { RUNE_CONFIRMATION_POLICY } from "../../lib/runeAlertPolicy";
import {
  buildReportIncident,
  countPresentReportMedia,
  createReportEvidenceReference,
} from "./reportIncidentEvidence";
import {
  ALERT_INCIDENT_CURRENT_WINDOW_MS,
  ALERT_INCIDENT_JOURNAL_WINDOW_MS,
  type AlertIncidentJournalSelection,
} from "../../application/reporting/alertIncidentJournal";
import {
  selectRuneReportIncident,
  type RuneReportIncidentSelection,
} from "./runeReportIncidentSelection";
import {
  buildRuneReportRuntimeFrameTable,
  type RuneReportAlertTrigger,
  type RuneReportRuntimeIncident,
} from "./runeRuntimeFrameTable";
import { getRuneDetectionEpisodeId } from "../../lib/runeEpisodeIdentity";
import { createRuneEvidenceFrameId } from "../../lib/runeEvidenceMediaBudget";
import { RUNE_LAST_ALERT_TRIGGER_RETENTION_MS } from "../../lib/runeEvidenceArchive";
import {
  getRuneConfigSnapshot,
  type AlertIssueReportDetails,
  type CaptureDiagnostics,
  type ReportBase,
} from "./alertReportPayloadShared";

type RuneSample = ReturnType<typeof sampleVideoRegion>;

export function buildRuneDebugReportPayload({
  submittedAt,
  url,
  viewportDiagnostics,
  captureSize,
  layoutKey,
  sample,
  maskPreviewUrl,
  runeConfig,
  currentRegion,
  runeState,
  lastSnapshot,
  detection,
  candidatePreviewUrl,
}: ReportBase & {
  captureSize: { width: number; height: number };
  layoutKey: string | null;
  sample: RuneSample;
  maskPreviewUrl: string;
  runeConfig: RuneAlertConfig;
  currentRegion: RelativeRegion;
  runeState: RuneRuntimeState;
  lastSnapshot: RuneSnapshot | null;
  detection: RuneDetectionResult;
  candidatePreviewUrl: string | null;
}) {
  return createAlertReportPayload({
    kind: "rune",
    submittedAt,
    url,
    appBuild: getAppBuildReportInfo(),
    diagnostics: {
      ...viewportDiagnostics,
      capture: {
        hasStream: true,
        size: captureSize,
        layoutKey,
      },
    },
    sample: {
      rawDataUrl: sample.rawPreviewUrl,
      processedDataUrl: maskPreviewUrl,
      candidateDataUrl: candidatePreviewUrl,
      regionLabel: `${sample.region.width}x${sample.region.height}`,
      pixelRegion: sample.region,
      result: {
        value: null,
        confidence: detection.confidence,
        detected: detection.detected,
        candidateCount: detection.candidates.length,
        detectorVersion: detection.debug.classifier ?? null,
      },
    },
    rune: {
      config: getRuneConfigSnapshot(runeConfig),
      confirmationPolicy: RUNE_CONFIRMATION_POLICY,
      currentRegion,
      state: runeState,
      runtimeTrace: getRuneRuntimeTraceSummary(runeState),
      lastDecisionReason: runeState.lastDecisionReason ?? null,
      lastAlertPlayback: runeState.lastAlertPlayback ?? null,
      lastSnapshot,
      detection,
    },
  });
}

export function buildRuneIssueReportPayload({
  submittedAt,
  url,
  clientId,
  viewportDiagnostics,
  captureDiagnostics,
  snapshot,
  lastAlertSnapshot,
  runeConfig,
  currentRegion,
  runeState,
  issue,
  journalSelection = null,
}: ReportBase & {
  clientId: string;
  captureDiagnostics: CaptureDiagnostics;
  snapshot: RuneSnapshot;
  lastAlertSnapshot?: RuneSnapshot | null;
  runeConfig: RuneAlertConfig;
  currentRegion: RelativeRegion | null;
  runeState: RuneRuntimeState;
  issue: AlertIssueReportDetails;
  journalSelection?: AlertIncidentJournalSelection | null;
}) {
  const runtimeEvidenceSnapshot =
    lastAlertSnapshot === undefined ? snapshot : lastAlertSnapshot;
  const availableRuntimeIncidents = getRuneRuntimeIncidentCandidates(
    runtimeEvidenceSnapshot,
  );
  const selectedIncident = selectRuneReportIncident({
    selection: journalSelection,
    scenario: issue.scenario,
    occurrence: issue.occurrence,
    runtimeIncidents: availableRuntimeIncidents,
  });
  const incidentSelection = attachRetainedRuneTriggerSelection({
    selection: selectedIncident,
    snapshot: runtimeEvidenceSnapshot,
    runeState,
    issue,
    capturedAt: journalSelection?.capturedAt ?? Date.parse(submittedAt),
  });
  const alertTriggers =
    issue.occurrence === "historical"
      ? []
      : getRuneAlertTriggerEvidence(runtimeEvidenceSnapshot, {
          incidentSelection,
          requireCorrelation: Boolean(journalSelection),
        });
  const alertTrigger = alertTriggers[alertTriggers.length - 1] ?? null;
  const runtimeIncidents =
    (issue.reason === "rune-missed" || issue.reason === "rune-false-positive") &&
    issue.occurrence !== "historical"
      ? getRuneRuntimeIncidentEvidence(runtimeEvidenceSnapshot, {
          occurrence: issue.occurrence,
          journalSelection,
          submittedAt,
          incidentSelection,
          requireCorrelation: Boolean(journalSelection),
        })
      : [];
  const runtimeIncident = runtimeIncidents[runtimeIncidents.length - 1] ?? null;
  const reportRuntimeEvidence = buildRuneReportRuntimeFrameTable({
    runtimeIncident,
    runtimeIncidents,
    alertTrigger,
    alertTriggers,
  });
  const alertAttempts = buildRuneAlertAttempts(
    reportRuntimeEvidence.alertTriggers,
    incidentSelection,
  );
  const episodes = buildRuneEpisodeDescriptors({
    runtimeIncidents: reportRuntimeEvidence.runtimeIncidents,
    alertAttempts,
  });
  const lastAlertEvidence =
    issue.reason === "rune-false-positive"
      ? getRuneLastAlertEvidence({
          snapshot: runtimeEvidenceSnapshot,
          reportSnapshot: snapshot,
          runtimeFrames: reportRuntimeEvidence.runtimeFrames,
          selectedTriggers: alertTriggers,
          requireCorrelation: Boolean(journalSelection),
        })
      : null;
  const runtimeTrace = getRuneRuntimeTraceSummary(runeState);
  const selectedPlaybackEvents = alertAttempts.flatMap(
    (attempt) => attempt.playbackEvents,
  );
  const latestSelectedPlaybackEvent =
    selectedPlaybackEvents[selectedPlaybackEvents.length - 1] ?? null;
  const triggerFrames = alertTriggers.flatMap((entry) => entry.frames);
  const runtimeIncidentFrames = runtimeIncidents.flatMap((entry) => entry.frames);
  const runtimeFrames = reportRuntimeEvidence.runtimeFrames;
  const hasAtomicRuntimeIncident = runtimeIncidentFrames.some(
    (entry) => Boolean(entry.stateBefore && entry.stateAfter),
  );
  const selectedRuntimeCapturedAt =
    alertTrigger?.triggeredAt ??
    runtimeIncident?.lastSignalAt ??
    incidentSelection.selectedEventAt;
  const selectedRuntimeFrameId =
    selectedRuntimeCapturedAt === null
      ? null
      : createRuneEvidenceFrameId(selectedRuntimeCapturedAt);
  const incident = buildReportIncident({
    feature: "rune",
    issue,
    submittedAt,
    source: alertTriggers.length > 0
      ? "runtime-snapshot"
      : runtimeIncidents.length > 0
        ? "mixed"
        : "report-capture",
    sampledAt:
      alertTrigger?.triggeredAt ?? runtimeIncident?.lastSignalAt ?? snapshot.sampledAt,
    timestamps: [
      ...runtimeTrace.map((entry) => entry.sampledAt),
      ...triggerFrames.map((entry) => entry.sampledAt),
      ...runtimeIncidentFrames.map((entry) => entry.sampledAt),
    ],
    stateBinding: hasAtomicRuntimeIncident ? "before-after" : "mixed",
    mediaCount:
      countPresentReportMedia(
        snapshot.rawPreviewUrl,
        snapshot.maskPreviewUrl,
        snapshot.candidatePreviewUrl,
      ) + runtimeFrames.length,
    cycleId:
      incidentSelection.cycleIds[incidentSelection.cycleIds.length - 1] ??
      alertTrigger?.cycleId ??
      null,
    journalSelection,
    journalOccurrence: {
      status: incidentSelection.status,
      entries: incidentSelection.entries,
      relatedPlaybackEntries: incidentSelection.relatedPlaybackEntries,
      selectedEventAt: incidentSelection.selectedEventAt,
    },
    evidenceReferences: [
      createReportEvidenceReference({
        id: "rune-source",
        kind: "sourceImage",
        paths: ["sample.runeEvidence.runtimeFrames"],
        capturedAt: selectedRuntimeCapturedAt,
        frameId: selectedRuntimeFrameId,
        cycleId: alertTrigger?.cycleId ?? null,
      }),
      createReportEvidenceReference({
        id: "rune-report-frame",
        kind: "runtime",
        paths: [
          "sample.rawDataUrl",
          "sample.processedDataUrl",
          "sample.candidateDataUrl",
          "sample.runeEvidence.reportFrame",
        ],
        capturedAt: snapshot.sampledAt,
        frameId: `frame:${Math.round(snapshot.sampledAt)}`,
        cycleId: null,
      }),
      createReportEvidenceReference({
        id: "rune-trace",
        kind: "temporalTrace",
        paths: [
          "rune.runtimeTrace",
          "sample.runeEvidence.alertAttempts",
          "sample.runeEvidence.runtimeIncidents",
        ],
        capturedAt:
          alertTrigger?.triggeredAt ?? runtimeIncident?.lastSignalAt ?? snapshot.sampledAt,
        frameId: null,
        cycleId: alertTrigger?.cycleId ?? null,
      }),
      createReportEvidenceReference({
        id: "rune-state-binding",
        kind: "stateBeforeAfter",
        paths: hasAtomicRuntimeIncident
          ? ["sample.runeEvidence.runtimeIncidents"]
          : [],
        capturedAt: runtimeIncident?.lastSignalAt ?? snapshot.sampledAt,
        frameId: selectedRuntimeFrameId,
        cycleId: alertTrigger?.cycleId ?? null,
      }),
      createReportEvidenceReference({
        id: "rune-decision",
        kind: "decision",
        paths: [
          "sample.result",
          "rune.lastDecisionReason",
          "sample.runeEvidence.alertAttempts",
          "sample.runeEvidence.runtimeIncidents",
        ],
        capturedAt:
          alertTrigger?.triggeredAt ?? runtimeIncident?.lastSignalAt ?? snapshot.sampledAt,
        frameId: null,
        cycleId: alertTrigger?.cycleId ?? null,
      }),
      createReportEvidenceReference({
        id: "rune-playback",
        kind: "playback",
        paths: [
          "sample.runeEvidence.alertAttempts",
          "rune.state.lastAlertPlayback",
          "rune.lastAlertPlayback",
        ],
        capturedAt:
          latestSelectedPlaybackEvent?.occurredAt ??
          runeState.lastAlertPlayback?.requestedAt ??
          null,
        frameId: null,
        cycleId:
          alertAttempts[alertAttempts.length - 1]?.cycleId ??
          runeState.lastAlertPlayback?.cycleId ??
          null,
      }),
      createReportEvidenceReference({
        id: "rune-config",
        kind: "configuration",
        paths: ["rune.config"],
        capturedAt: snapshot.sampledAt,
        frameId: null,
        cycleId: null,
      }),
      createReportEvidenceReference({
        id: "rune-runtime",
        kind: "runtime",
        paths: [
          "sample.result.detectorVersion",
          "rune.state.detectorVersion",
          "sample.runeEvidence.runtimeIncidents",
        ],
        capturedAt: runtimeIncident?.lastSignalAt ?? snapshot.sampledAt,
        frameId: null,
        cycleId: null,
      }),
    ],
    completeness: {
      sourceImage: runtimeFrames.length > 0,
      temporalTrace:
        runtimeTrace.length > 1 ||
        triggerFrames.length > 1 ||
        runtimeIncidentFrames.length > 1,
      stateBeforeAfter: hasAtomicRuntimeIncident,
      decision: Boolean(snapshot.detectionDebug || runtimeTrace.length || alertTrigger),
      playback:
        alertAttempts.some((attempt) => attempt.playbackEvents.length > 0) ||
        Object.prototype.hasOwnProperty.call(runeState, "lastAlertPlayback"),
      affectedTarget: true,
    },
  });
  return createAlertReportPayload({
    kind: "rune-issue",
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
      rawDataUrl: snapshot.rawPreviewUrl,
      processedDataUrl: snapshot.maskPreviewUrl,
      candidateDataUrl: snapshot.candidatePreviewUrl,
      runeEvidence: {
        selection: {
          policy: "rune-scenario-incident-v2",
          status: incidentSelection.status,
          scenario: issue.scenario ?? null,
          occurrence: issue.occurrence ?? null,
          anchorKind: incidentSelection.anchorKind,
          selectedEventAt: incidentSelection.selectedEventAt,
          frameIds: incidentSelection.frameIds,
          episodeIds: incidentSelection.episodeIds,
          cycleIds: incidentSelection.cycleIds,
          candidateCount: incidentSelection.candidateCount,
          sampleCount: incidentSelection.sampleCount,
          ambiguous: incidentSelection.ambiguous,
          degradationReason: getRuneSelectionDegradationReason(incidentSelection),
        },
        reportFrame: getRuneCurrentEvidence(snapshot),
        current: getRuneCurrentEvidence(snapshot),
        lastAlert: lastAlertEvidence,
        runtimeFrames,
        alertTrigger: reportRuntimeEvidence.alertTrigger,
        runtimeIncident: reportRuntimeEvidence.runtimeIncident,
        episodes,
        alertAttempts,
        runtimeIncidents: reportRuntimeEvidence.runtimeIncidents,
        mediaBudget:
          runtimeEvidenceSnapshot?.evidenceArchive?.mediaBudget ??
          runtimeEvidenceSnapshot?.evidenceMediaBudget ??
          null,
      },
      regionLabel: snapshot.candidateRegionLabel,
      pixelRegion: snapshot.candidate,
      sampledAt: snapshot.sampledAt,
      candidateSampledAt: snapshot.candidateSampledAt,
      result: {
        value: null,
        confidence: snapshot.confidence,
        detected: snapshot.detected,
        candidateCount: snapshot.candidateCount,
        detectorVersion: snapshot.detectorVersion ?? null,
      },
    },
    rune: {
      config: getRuneConfigSnapshot(runeConfig),
      confirmationPolicy: RUNE_CONFIRMATION_POLICY,
      currentRegion,
      state: runeState,
      runtimeTrace,
      lastDecisionReason: runeState.lastDecisionReason ?? null,
      lastAlertPlayback: runeState.lastAlertPlayback ?? null,
      alertTrigger: getRuneAlertTriggerSummary(alertTrigger),
      runtimeIncident: getRuneRuntimeIncidentSummary(runtimeIncident),
      lastSnapshot: getRuneSnapshotSummary(snapshot),
      reportReason: issue.reason,
    },
  });
}

function getRuneSelectionDegradationReason(
  selection: RuneReportIncidentSelection,
) {
  if (selection.status === "outside-retention") {
    return "outside-retention";
  }
  if (selection.status === "unavailable") {
    if (selection.anchorKind === "attempt" && selection.cycleIds.length > 0) {
      return "journal-expired-trigger-retained";
    }
    return "no-compatible-incident";
  }
  return selection.ambiguous ? "ambiguous-selection" : null;
}

function attachRetainedRuneTriggerSelection({
  selection,
  snapshot,
  runeState,
  issue,
  capturedAt,
}: {
  selection: RuneReportIncidentSelection;
  snapshot: RuneSnapshot | null;
  runeState: RuneRuntimeState;
  issue: AlertIssueReportDetails;
  capturedAt: number;
}): RuneReportIncidentSelection {
  if (
    selection.cycleIds.length > 0 ||
    selection.status !== "unavailable" ||
    issue.reason !== "rune-false-positive" ||
    issue.scenario !== "wrong-target" ||
    issue.occurrence === "historical" ||
    !Number.isFinite(capturedAt)
  ) {
    return selection;
  }
  const cycleId = runeState.lastAlertPlayback?.cycleId ?? null;
  if (!cycleId) {
    return selection;
  }
  const trigger = mergeEvidenceByKey(
    [
      ...(snapshot?.evidenceArchive?.alertTriggers ?? []),
      snapshot?.lastAlertTrigger ?? null,
    ].filter((entry): entry is RuneAlertTriggerEvidence => Boolean(entry)),
    (entry) => entry.cycleId,
  ).find(
    (entry) =>
      entry.cycleId === cycleId &&
      entry.triggeredAt <= capturedAt &&
      entry.triggeredAt >= capturedAt - RUNE_LAST_ALERT_TRIGGER_RETENTION_MS,
  );
  if (!trigger) {
    return selection;
  }

  return {
    ...selection,
    anchorKind: "attempt",
    selectedEventAt: trigger.triggeredAt,
    frameIds: trigger.frames.map((frame) =>
      createRuneEvidenceFrameId(frame.sampledAt),
    ),
    episodeIds: trigger.episodeId ? [trigger.episodeId] : [],
    cycleIds: [trigger.cycleId],
    candidateCount: 1,
  };
}

function getRuneRuntimeIncidentEvidence(
  snapshot: RuneSnapshot | null,
  {
    occurrence,
    journalSelection,
    submittedAt,
    incidentSelection,
    requireCorrelation,
  }: {
    occurrence: AlertIssueReportDetails["occurrence"];
    journalSelection: AlertIncidentJournalSelection | null;
    submittedAt: string;
    incidentSelection: RuneReportIncidentSelection;
    requireCorrelation: boolean;
  },
): RuneRuntimeIncidentEvidence[] {
  const candidates = getRuneRuntimeIncidentCandidates(snapshot).filter((incident) =>
    isRuntimeIncidentInsideReportWindow({
      startedAt: incident.startedAt,
      lastSignalAt: incident.lastSignalAt,
      occurrence,
      journalSelection,
      submittedAt,
    }),
  );
  const selectedFrameIds = new Set(incidentSelection.frameIds);
  const selectedEpisodeIds = new Set(incidentSelection.episodeIds);
  const correlated = requireCorrelation
    ? candidates.filter(
        (incident) =>
          (Boolean(incident.episodeId) &&
            selectedEpisodeIds.has(incident.episodeId!)) ||
          incident.frames.some((frame) =>
            selectedFrameIds.has(`frame:${Math.round(frame.sampledAt)}`),
          ),
      )
    : candidates.slice(-1);
  return correlated.map(cloneRuntimeIncidentEvidence);
}

function getRuneRuntimeIncidentCandidates(
  snapshot: RuneSnapshot | null,
): RuneRuntimeIncidentEvidence[] {
  return mergeEvidenceByKey(
    [
      ...(snapshot?.evidenceArchive?.runtimeIncidents ?? []),
      snapshot?.runtimeIncident ?? null,
    ].filter((entry): entry is RuneRuntimeIncidentEvidence => Boolean(entry)),
    (entry) => entry.id,
  ).sort(
    (left, right) =>
      left.lastSignalAt - right.lastSignalAt || left.updatedAt - right.updatedAt,
  );
}

function isRuntimeIncidentInsideReportWindow({
  startedAt,
  lastSignalAt,
  occurrence,
  journalSelection,
  submittedAt,
}: {
  startedAt: number;
  lastSignalAt: number;
  occurrence: AlertIssueReportDetails["occurrence"];
  journalSelection: AlertIncidentJournalSelection | null;
  submittedAt: string;
}) {
  const capturedAt = journalSelection?.capturedAt ?? Date.parse(submittedAt);
  if (
    !Number.isFinite(capturedAt) ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(lastSignalAt)
  ) {
    return false;
  }

  const windowStartedAt =
    occurrence === "current"
      ? capturedAt - ALERT_INCIDENT_CURRENT_WINDOW_MS
      : journalSelection?.windowStartedAt ?? capturedAt - ALERT_INCIDENT_JOURNAL_WINDOW_MS;
  return startedAt <= capturedAt && lastSignalAt >= windowStartedAt && lastSignalAt <= capturedAt;
}

function cloneRuntimeIncidentEvidence(
  incident: RuneRuntimeIncidentEvidence,
): RuneRuntimeIncidentEvidence {
  return {
    ...incident,
    frames: incident.frames.map((frame) => ({
      ...frame,
      detectionDebug: frame.detectionDebug ? { ...frame.detectionDebug } : null,
      detectionError: frame.detectionError ? { ...frame.detectionError } : null,
      candidate: frame.candidate ? { ...frame.candidate } : null,
      stateBefore: frame.stateBefore ? { ...frame.stateBefore } : undefined,
      stateAfter: frame.stateAfter ? { ...frame.stateAfter } : undefined,
    })),
  };
}

function cloneAlertTriggerEvidence(
  trigger: RuneAlertTriggerEvidence,
): RuneAlertTriggerEvidence {
  return {
    ...trigger,
    frames: trigger.frames.map((frame) => ({
      ...frame,
      detectionDebug: frame.detectionDebug ? { ...frame.detectionDebug } : null,
      candidate: frame.candidate ? { ...frame.candidate } : null,
    })),
  };
}

function mergeEvidenceByKey<T>(items: T[], getKey: (item: T) => string) {
  const merged = new Map<string, T>();
  items.forEach((item) => merged.set(getKey(item), item));
  return [...merged.values()];
}

type RuneReportAlertAttempt = RuneReportAlertTrigger & {
  parentEpisodeId: string | null;
  frameIds: string[];
  playbackEvents: Array<{
    id: string;
    occurredAt: number;
    status: string | null;
    decision: string | null;
    details: Record<string, unknown>;
  }>;
};

function buildRuneAlertAttempts(
  triggers: RuneReportAlertTrigger[],
  selection: RuneReportIncidentSelection,
): RuneReportAlertAttempt[] {
  return triggers.map((trigger) => {
    const parentEpisodeId =
      trigger.episodeId ??
      trigger.frames.map(getRuneDetectionEpisodeId).find(Boolean) ??
      null;
    return {
      ...trigger,
      parentEpisodeId,
      frameIds: uniqueStrings(
        trigger.frames.map((frame) => createRuneEvidenceFrameId(frame.sampledAt)),
      ),
      playbackEvents: selection.entries
        .filter(
          (entry) =>
            entry.kind === "playback" &&
            entry.cycleId !== null &&
            String(entry.cycleId) === trigger.cycleId,
        )
        .map((entry) => ({
          id: entry.id,
          occurredAt: entry.occurredAt,
          status: entry.status,
          decision: entry.decision,
          details: { ...entry.details },
        })),
    };
  });
}

function buildRuneEpisodeDescriptors({
  runtimeIncidents,
  alertAttempts,
}: {
  runtimeIncidents: RuneReportRuntimeIncident[];
  alertAttempts: RuneReportAlertAttempt[];
}) {
  const episodes = new Map<
    string,
    {
      episodeId: string;
      sceneEpoch: number;
      startedAt: number | null;
      lastSignalAt: number | null;
      frameIds: string[];
      alertAttemptIds: string[];
    }
  >();
  const getOrCreate = (episodeId: string, sceneEpoch: number) => {
    const existing = episodes.get(episodeId);
    if (existing) return existing;
    const created = {
      episodeId,
      sceneEpoch,
      startedAt: null,
      lastSignalAt: null,
      frameIds: [],
      alertAttemptIds: [],
    };
    episodes.set(episodeId, created);
    return created;
  };

  runtimeIncidents.forEach((incident) => {
    const episodeId =
      incident.episodeId ??
      incident.frames.map(getRuneDetectionEpisodeId).find(Boolean) ??
      null;
    if (!episodeId) return;
    const episode = getOrCreate(episodeId, incident.sceneEpoch);
    episode.startedAt = minTimestamp(episode.startedAt, incident.startedAt);
    episode.lastSignalAt = maxTimestamp(
      episode.lastSignalAt,
      incident.lastSignalAt,
    );
    episode.frameIds = uniqueStrings([
      ...episode.frameIds,
      ...incident.frames.map((frame) =>
        createRuneEvidenceFrameId(frame.sampledAt),
      ),
    ]);
  });
  alertAttempts.forEach((attempt) => {
    if (!attempt.parentEpisodeId) return;
    const episode = getOrCreate(attempt.parentEpisodeId, attempt.sceneEpoch);
    episode.startedAt = minTimestamp(episode.startedAt, attempt.triggeredAt);
    episode.lastSignalAt = maxTimestamp(episode.lastSignalAt, attempt.triggeredAt);
    episode.frameIds = uniqueStrings([
      ...episode.frameIds,
      ...attempt.frameIds,
    ]);
    episode.alertAttemptIds = uniqueStrings([
      ...episode.alertAttemptIds,
      attempt.cycleId,
    ]);
  });

  return [...episodes.values()].sort(
    (left, right) =>
      (left.startedAt ?? Number.POSITIVE_INFINITY) -
      (right.startedAt ?? Number.POSITIVE_INFINITY),
  );
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function minTimestamp(current: number | null, value: number) {
  return current === null ? value : Math.min(current, value);
}

function maxTimestamp(current: number | null, value: number) {
  return current === null ? value : Math.max(current, value);
}

function getRuneRuntimeIncidentSummary(
  incident: RuneRuntimeIncidentEvidence | null,
) {
  if (!incident) {
    return null;
  }
  return {
    schemaVersion: incident.schemaVersion,
    id: incident.id,
    episodeId: incident.episodeId ?? null,
    startedAt: incident.startedAt,
    lastSignalAt: incident.lastSignalAt,
    updatedAt: incident.updatedAt,
    expiresAt: incident.expiresAt,
    detectorVersion: incident.detectorVersion,
    sceneEpoch: incident.sceneEpoch,
    frameCount: incident.frames.length,
    signalFrameCount: incident.frames.filter((frame) => frame.phase === "signal").length,
    frames: incident.frames.map(({ rawDataUrl: _rawDataUrl, ...frame }) => frame),
  };
}

function getRuneAlertTriggerEvidence(
  snapshot: RuneSnapshot | null,
  {
    incidentSelection,
    requireCorrelation,
  }: {
    incidentSelection: RuneReportIncidentSelection;
    requireCorrelation: boolean;
  },
): RuneAlertTriggerEvidence[] {
  const candidates = mergeEvidenceByKey(
    [
      ...(snapshot?.evidenceArchive?.alertTriggers ?? []),
      snapshot?.lastAlertTrigger ?? null,
    ].filter((entry): entry is RuneAlertTriggerEvidence => Boolean(entry)),
    (entry) => entry.cycleId,
  ).sort((left, right) => left.triggeredAt - right.triggeredAt);
  const selectedCycles = new Set(incidentSelection.cycleIds.map(String));
  const correlated = requireCorrelation
    ? candidates.filter((trigger) => selectedCycles.has(trigger.cycleId))
    : candidates.slice(-1);
  return correlated.map(cloneAlertTriggerEvidence);
}

function getRuneAlertTriggerSummary(
  trigger: RuneAlertTriggerEvidence | null,
) {
  if (!trigger) {
    return null;
  }
  return {
    schemaVersion: trigger.schemaVersion,
    cycleId: trigger.cycleId,
    episodeId: trigger.episodeId ?? null,
    decision: trigger.decision,
    triggeredAt: trigger.triggeredAt,
    detectorVersion: trigger.detectorVersion,
    sceneEpoch: trigger.sceneEpoch,
    frameCount: trigger.frames.length,
    frames: trigger.frames.map(({ rawDataUrl: _rawDataUrl, ...frame }) => frame),
  };
}

function getRuneRuntimeTraceSummary(state: RuneRuntimeState) {
  return (state.recentSamples ?? []).map((sample) => ({
    sampledAt: sample.sampledAt,
    detected: sample.detected,
    outcome: sample.outcome ?? (sample.detected ? "detected" : "not-detected"),
    confidence: sample.confidence,
    candidateCount: sample.candidateCount,
    candidate: sample.candidate,
    status: sample.status,
    stableCount: sample.stableCount,
    consecutiveMissCount: sample.consecutiveMissCount ?? 0,
    scenePolicyVersion: sample.scenePolicyVersion ?? null,
    sceneEpoch: sample.sceneEpoch ?? 0,
    sceneChanged: sample.sceneChanged ?? false,
    sceneChangeScore: sample.sceneChangeScore ?? null,
    scenePendingStableCount: sample.scenePendingStableCount ?? 0,
    firstDetectedAt: sample.firstDetectedAt ?? null,
    stableDurationMs: sample.stableDurationMs ?? 0,
    confirmationPolicyVersion:
      sample.confirmationPolicyVersion ?? RUNE_CONFIRMATION_POLICY.version,
    confirmationPolicyMode:
      sample.confirmationPolicyMode ?? RUNE_CONFIRMATION_POLICY.mode,
    confirmationSatisfied: sample.confirmationSatisfied ?? false,
    confirmationSatisfiedBy: sample.confirmationSatisfiedBy ?? null,
    shouldAlert: sample.shouldAlert,
    reason: sample.reason,
    error: sample.error ?? null,
  }));
}

function getRuneSnapshotSummary(snapshot: RuneSnapshot) {
  return {
    sampledAt: snapshot.sampledAt,
    detectorVersion: snapshot.detectorVersion ?? null,
    detectionDebug: snapshot.detectionDebug ?? null,
    detectionError: snapshot.detectionError ?? null,
    candidateRegionLabel: snapshot.candidateRegionLabel,
    candidateSampledAt: snapshot.candidateSampledAt,
    candidate: snapshot.candidate,
    detected: snapshot.detected,
    confidence: snapshot.confidence,
    candidateCount: snapshot.candidateCount,
    runtimeIncidentFrameCount: snapshot.runtimeIncident?.frames.length ?? 0,
    hasRawPreview: Boolean(snapshot.rawPreviewUrl),
    hasMaskPreview: Boolean(snapshot.maskPreviewUrl),
    hasCandidatePreview: Boolean(snapshot.candidatePreviewUrl),
    hasCandidateRawPreview: Boolean(snapshot.candidateRawPreviewUrl),
    hasCandidateMaskPreview: Boolean(snapshot.candidateMaskPreviewUrl),
  };
}

function getRuneCurrentEvidence(snapshot: RuneSnapshot) {
  return {
    sampledAt: snapshot.sampledAt,
    detectorVersion: snapshot.detectorVersion ?? null,
    detectionDebug: snapshot.detectionDebug ?? null,
    detectionError: snapshot.detectionError ?? null,
    candidateSampledAt: snapshot.candidateSampledAt,
    candidate: snapshot.candidate,
    candidateDataUrl: null,
    candidateMediaPath: snapshot.candidatePreviewUrl
      ? "sample.candidateDataUrl"
      : null,
    detected: snapshot.detected,
    confidence: snapshot.confidence,
    candidateCount: snapshot.candidateCount,
  };
}

function getRuneLastAlertEvidence({
  snapshot,
  reportSnapshot,
  runtimeFrames,
  selectedTriggers,
  requireCorrelation,
}: {
  snapshot: RuneSnapshot | null;
  reportSnapshot: RuneSnapshot;
  runtimeFrames: Array<{ frameId: string; rawDataUrl: string }>;
  selectedTriggers: RuneAlertTriggerEvidence[];
  requireCorrelation: boolean;
}) {
  if (!snapshot?.candidate || !snapshot.candidatePreviewUrl) {
    return null;
  }
  if (requireCorrelation && selectedTriggers.length === 0) {
    return null;
  }
  const candidateSampledAt = snapshot.candidateSampledAt ?? snapshot.sampledAt;
  const belongsToSelectedTrigger = selectedTriggers.some(
    (trigger) =>
      trigger.triggeredAt === candidateSampledAt ||
      trigger.frames.some((frame) => frame.sampledAt === candidateSampledAt),
  );
  if (selectedTriggers.length > 0 && !belongsToSelectedTrigger) {
    return null;
  }

  const runtimeRawFrame = runtimeFrames.find(
    (frame) => frame.rawDataUrl === snapshot.candidateRawPreviewUrl,
  );
  const sharesReportMask =
    Boolean(snapshot.candidateMaskPreviewUrl) &&
    snapshot.candidateMaskPreviewUrl === reportSnapshot.maskPreviewUrl;
  const sharesReportCandidate =
    snapshot.candidatePreviewUrl === reportSnapshot.candidatePreviewUrl;

  return {
    sampledAt: candidateSampledAt,
    detectorVersion: snapshot.detectorVersion ?? null,
    candidateSampledAt: snapshot.candidateSampledAt,
    candidate: snapshot.candidate,
    rawDataUrl: runtimeRawFrame ? null : snapshot.candidateRawPreviewUrl,
    rawFrameId: runtimeRawFrame?.frameId ?? null,
    processedDataUrl: sharesReportMask ? null : snapshot.candidateMaskPreviewUrl,
    processedMediaPath: sharesReportMask ? "sample.processedDataUrl" : null,
    candidateDataUrl: sharesReportCandidate ? null : snapshot.candidatePreviewUrl,
    candidateMediaPath: sharesReportCandidate ? "sample.candidateDataUrl" : null,
    detected: true,
    confidence: snapshot.candidate.confidence,
    candidateCount: Math.max(1, snapshot.candidateCount),
  };
}
