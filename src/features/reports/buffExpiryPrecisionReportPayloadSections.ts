import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryAlertConfig } from "../../types";
import type { RuntimeReportEvidenceMetadata } from "../../contracts/reporting/runtimeReportEvidence";
import type { AlertIssueReportDetails } from "./alertReportPayloadShared";
import {
  buildBuffExpiryPrecisionAlertTimingDiagnostics,
  getBuffExpiryPrecisionConfigSnapshot,
} from "./buffExpiryPrecisionReportDiagnostics";
import {
  buildBuffExpiryPrecisionGroupSummary,
  serializeBuffExpiryPrecisionBestByGroupCandidate,
  serializeBuffExpiryPrecisionIconEvidence,
  serializeBuffExpiryPrecisionIconObservation,
  serializeBuffExpiryPrecisionLastAlertEvidence,
} from "./buffExpiryPrecisionReportEvidence";
import { serializeBuffExpiryPrecisionRecentRoiFrames } from "./buffExpiryPrecisionReportFrames";
import {
  serializeBuffExpiryPrecisionAlertDecisionHistory,
  serializeBuffExpiryPrecisionPendingTracks,
  serializeBuffExpiryPrecisionRuntimeTrace,
  serializeBuffExpiryPrecisionTracks,
} from "./buffExpiryPrecisionReportTimeline";
import { serializeBuffExpiryPrecisionBox } from "./buffExpiryPrecisionReportBoxes";
import { BUFF_EXPIRY_PRECISION_REPORT_SCHEMA_VERSION } from "./buffExpiryPrecisionReportConstants";
import type { BuffExpiryIncidentReportEvidence } from "../../runtime/buff-expiry/evidence/buffExpiryIncidentReportEvidence";

export function createBuffExpiryPrecisionReportContext(
  config: BuffExpiryAlertConfig,
  snapshot: BuffExpirySnapshot,
  state: BuffExpiryRuntimeState,
  {
    includeLegacyMedia = true,
  }: {
    includeLegacyMedia?: boolean;
  } = {},
) {
  const serializedTracks = serializeBuffExpiryPrecisionTracks(snapshot.tracks);
  const serializedPendingTracks = serializeBuffExpiryPrecisionPendingTracks(snapshot.pendingTracks);
  const observations = snapshot.nextIconObservations ?? [];
  const bestByGroup = snapshot.nextBestByGroup ?? [];
  const targetObservations = observations.filter((observation) => observation.identity.kind === "target");
  const countdownObservations = observations.filter((observation) => observation.countdown);
  const alertTimingDiagnostics = buildBuffExpiryPrecisionAlertTimingDiagnostics(config, snapshot, state);
  const groupSummary = buildBuffExpiryPrecisionGroupSummary(targetObservations, bestByGroup);
  const serializedIconEvidence = serializeBuffExpiryPrecisionIconEvidence(
    snapshot,
    targetObservations,
    bestByGroup,
  );
  const iconEvidence = includeLegacyMedia
    ? serializedIconEvidence
    : serializedIconEvidence.map((entry) => ({
        ...entry,
        normalizedIconDataUrl: null,
      }));
  const recentRoiFrames = includeLegacyMedia
    ? serializeBuffExpiryPrecisionRecentRoiFrames(
        snapshot.nextRecentRoiFrames ?? [],
      )
    : [];
  const serializedLastAlertEvidence = serializeBuffExpiryPrecisionLastAlertEvidence(
    snapshot.lastAlertEvidence ?? state.lastAlertEvidence ?? null,
  );
  const lastAlertEvidence =
    includeLegacyMedia || !serializedLastAlertEvidence
      ? serializedLastAlertEvidence
      : {
          ...serializedLastAlertEvidence,
          triggeredTracks: serializedLastAlertEvidence.triggeredTracks.map(
            (track) => ({ ...track, normalizedIconDataUrl: null }),
          ),
        };

  return {
    serializedTracks,
    serializedPendingTracks,
    observations,
    bestByGroup,
    targetObservations,
    countdownObservations,
    alertTimingDiagnostics,
    groupSummary,
    iconEvidence,
    recentRoiFrames,
    lastAlertEvidence,
  };
}

type BuffExpiryPrecisionReportContext = ReturnType<typeof createBuffExpiryPrecisionReportContext>;

export function buildBuffExpiryPrecisionReportSample(
  snapshot: BuffExpirySnapshot,
  state: BuffExpiryRuntimeState,
  context: BuffExpiryPrecisionReportContext,
  runtimeEvidence?: RuntimeReportEvidenceMetadata | null,
  incidentEvidence?: BuffExpiryIncidentReportEvidence | null,
) {
  const {
    serializedTracks,
    serializedPendingTracks,
    observations,
    bestByGroup,
    targetObservations,
    countdownObservations,
    alertTimingDiagnostics,
    groupSummary,
    iconEvidence,
    recentRoiFrames,
    lastAlertEvidence,
  } = context;

  return {
    sampledAt: snapshot.sampledAt,
    source: runtimeEvidence?.source ?? null,
    parser: runtimeEvidence?.parser ?? {
      engine: snapshot.parserEngine ?? null,
      version: snapshot.nextModuleVersions?.parser ?? null,
      fallbackReason: snapshot.parserFallbackReason ?? null,
    },
    rawDataUrl: runtimeEvidence ? null : snapshot.rawPreviewUrl,
    processedDataUrl: runtimeEvidence
      ? null
      : snapshot.processedPreviewUrl ?? snapshot.rawPreviewUrl,
    fullFrameDataUrl: runtimeEvidence ? null : snapshot.fullFramePreviewUrl ?? null,
    roi: snapshot.roi,
    boxes: snapshot.boxes.map(serializeBuffExpiryPrecisionBox),
    displayBoxes: (snapshot.displayBoxes ?? snapshot.boxes).map(serializeBuffExpiryPrecisionBox),
    tracks: serializedTracks,
    pendingTracks: serializedPendingTracks,
    runtimeTrace: serializeBuffExpiryPrecisionRuntimeTrace(snapshot.runtimeTrace ?? []),
    alertDecisionHistory: serializeBuffExpiryPrecisionAlertDecisionHistory(snapshot.alertDecisionHistory ?? []),
    lastAlertEvidence,
    alertTimingDiagnostics,
    next: {
      moduleVersions: snapshot.nextModuleVersions ?? null,
      parser: {
        boxCount: snapshot.boxes.length,
        displayBoxCount: snapshot.displayBoxes?.length ?? snapshot.boxes.length,
        localization: snapshot.nextBuffSlotLocalization ?? null,
      },
      identity: {
        observations: observations.map(serializeBuffExpiryPrecisionIconObservation),
        targetObservations: targetObservations.map(serializeBuffExpiryPrecisionIconObservation),
        bestByGroup: bestByGroup.map(serializeBuffExpiryPrecisionBestByGroupCandidate),
        groupSummary,
      },
      countdown: {
        recognizedCount: countdownObservations.length,
        targetRecognizedCount: targetObservations.filter((observation) => observation.countdown).length,
        observations: countdownObservations.map(serializeBuffExpiryPrecisionIconObservation),
      },
      tracking: {
        tracks: serializedTracks,
        pendingTracks: serializedPendingTracks,
        confirmationCandidateCount: state.confirmationCandidateCount ?? 0,
        lastAlertEvidence,
      },
      iconEvidence,
      replay: {
        windowMs: 5 * 60_000,
        periodicIntervalMs: 30_000,
        frameCount: recentRoiFrames.length,
        frames: recentRoiFrames,
      },
      performance: snapshot.performance ?? null,
      unsupportedReason: snapshot.unsupportedReason,
    },
    result: {
      value: serializedTracks[0]?.name ?? targetObservations[0]?.identity.bestTargetName ?? null,
      confidence: null,
      detected: targetObservations.length > 0 || serializedTracks.length > 0,
      candidateCount: snapshot.boxes.length,
      performance: snapshot.performance ?? null,
      runtimeFailure: snapshot.runtimeFailure ?? null,
    },
    buffExpiryEvidence: incidentEvidence ?? null,
  };
}

export function buildBuffExpiryPrecisionReportSection(
  config: BuffExpiryAlertConfig,
  snapshot: BuffExpirySnapshot,
  state: BuffExpiryRuntimeState,
  stateBefore: BuffExpiryRuntimeState | null,
  issue: AlertIssueReportDetails,
  context: BuffExpiryPrecisionReportContext,
) {
  const {
    serializedTracks,
    serializedPendingTracks,
    observations,
    bestByGroup,
    targetObservations,
    countdownObservations,
    alertTimingDiagnostics,
    groupSummary,
    iconEvidence,
    recentRoiFrames,
    lastAlertEvidence,
  } = context;

  return {
    config: getBuffExpiryPrecisionConfigSnapshot(config),
    state,
    stateBefore,
    summary: {
      schemaVersion: BUFF_EXPIRY_PRECISION_REPORT_SCHEMA_VERSION,
      moduleVersions: snapshot.nextModuleVersions ?? null,
      buffSlotLocalization: snapshot.nextBuffSlotLocalization ?? null,
      enabled: config.enabled,
      runtimeStatus: state.status,
      snapshotBoxCount: snapshot.boxes.length,
      snapshotDisplayBoxCount: snapshot.displayBoxes?.length ?? snapshot.boxes.length,
      targetObservationCount: targetObservations.length,
      countdownObservationCount: countdownObservations.length,
      trackCount: serializedTracks.length,
      pendingTrackCount: serializedPendingTracks.length,
      confirmationCandidateCount: state.confirmationCandidateCount ?? 0,
      groupSummary,
      alertTimingDiagnostics,
      recentRoiFrameCount: recentRoiFrames.length,
      recentRoiReasons: [...new Set(recentRoiFrames.map((frame) => frame.reason))],
      lastAlertEvidence: lastAlertEvidence
        ? {
            alertedAt: lastAlertEvidence.alertedAt,
            alertLeadSeconds: lastAlertEvidence.alertLeadSeconds,
            clusterId: lastAlertEvidence.clusterId,
            dueAt: lastAlertEvidence.dueAt,
            triggeredTrackCount: lastAlertEvidence.triggeredTracks.length,
          }
        : null,
    },
    next: {
      parserBoxCount:
        snapshot.nextBuffSlotLocalization?.parserBoxCount ??
        snapshot.boxes.length,
      localizedBoxCount:
        snapshot.nextBuffSlotLocalization?.localizedBoxCount ??
        snapshot.boxes.length,
      spatialExcludedBoxCount:
        snapshot.nextBuffSlotLocalization?.spatialExcludedBoxCount ?? 0,
      identityObservationCount: observations.length,
      targetObservationCount: targetObservations.length,
      countdownObservationCount: countdownObservations.length,
      bestByGroupCount: bestByGroup.length,
      iconEvidenceCount: iconEvidence.length,
    },
    lastSnapshot: {
      sampledAt: snapshot.sampledAt,
      roi: snapshot.roi,
      boxCount: snapshot.boxes.length,
      displayBoxCount: snapshot.displayBoxes?.length ?? snapshot.boxes.length,
      targetObservationCount: targetObservations.length,
      countdownObservationCount: countdownObservations.length,
      tracks: serializedTracks,
      pendingTracks: serializedPendingTracks,
      runtimeTraceFrameCount: snapshot.runtimeTrace?.length ?? 0,
      alertDecisionCount: snapshot.alertDecisionHistory?.length ?? 0,
      recentRoiFrameCount: recentRoiFrames.length,
      lastAlertEvidence,
      alertTimingDiagnostics,
      performance: snapshot.performance ?? null,
      unsupportedReason: snapshot.unsupportedReason,
    },
    reportReason: issue.reason,
  };
}
