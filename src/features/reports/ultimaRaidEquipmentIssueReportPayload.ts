import type { AlertIncidentJournalSelection } from "../../application/reporting/alertIncidentJournal";
import { createAlertReportPayload } from "../../contracts/reporting/alertReportContract";
import { getAppBuildReportInfo } from "../../platform/runtime-build/currentAppBuildInfo";
import type {
  UltimaRaidAlertTarget,
  UltimaRaidEquipmentIncidentReportEvidence,
} from "../../runtime/ultima-raid-equipment/evidence/ultimaRaidEquipmentIncidentEvidence";
import type { UltimaRaidEquipmentRuntimeState } from "../../runtime/ultima-raid-equipment/ultimaRaidEquipmentAlertState";
import type { UltimaRaidEquipmentAlertConfig } from "../../types";
import type { UltimaRaidEquipmentSnapshot } from "../../runtime/ultima-raid-equipment/ultimaRaidEquipmentSnapshot";
import {
  getUltimaRaidEquipmentConfigSnapshot,
  type AlertIssueReportDetails,
  type CaptureDiagnostics,
  type ReportBase,
} from "./alertReportPayloadShared";
import {
  buildReportIncident,
  createReportEvidenceReference,
} from "./reportIncidentEvidence";

export function buildUltimaRaidEquipmentIssueReportPayload({
  submittedAt,
  url,
  clientId,
  viewportDiagnostics,
  captureDiagnostics,
  config,
  state,
  snapshot,
  incidentEvidence,
  issue,
  target = "equipment",
  journalSelection = null,
}: ReportBase & {
  clientId: string;
  captureDiagnostics: CaptureDiagnostics;
  config: UltimaRaidEquipmentAlertConfig;
  state: UltimaRaidEquipmentRuntimeState;
  snapshot: UltimaRaidEquipmentSnapshot | null;
  incidentEvidence: UltimaRaidEquipmentIncidentReportEvidence;
  issue: AlertIssueReportDetails;
  target?: UltimaRaidAlertTarget;
  journalSelection?: AlertIncidentJournalSelection | null;
}) {
  const targetIssue: AlertIssueReportDetails = {
    ...issue,
    affectedTarget:
      issue.affectedTarget ??
      (target === "boss"
        ? { id: "boss", label: "보스 등장" }
        : { id: "equipment", label: "장비 가방" }),
  };
  const selectedFrameId = incidentEvidence.selection.selectedFrameId;
  const selectedFrame = selectedFrameId
    ? incidentEvidence.frames.find((entry) => entry.id === selectedFrameId) ??
      null
    : incidentEvidence.frames[incidentEvidence.frames.length - 1] ?? null;
  const selectedPlayback =
    [...incidentEvidence.playbackAttempts]
      .reverse()
      .find((entry) => (entry.target ?? "equipment") === target) ?? null;
  const detected =
    target === "boss"
      ? selectedFrame?.bossProgressState === "boss" ||
        snapshot?.bossProgressState === "boss"
      : selectedFrame?.detected ?? snapshot?.detected ?? false;
  const capturedAt =
    incidentEvidence.selection.selectedEventAt ??
    selectedFrame?.sampledAt ??
    incidentEvidence.frozenAt;
  const cycleId =
    target === "boss"
      ? selectedFrame?.stateAfter.boss?.lastAlertedAt ??
        selectedFrame?.stateBefore.boss?.lastAlertedAt ??
        state.boss.lastAlertedAt
      : selectedFrame?.stateAfter.lastAlertedAt ??
        selectedFrame?.stateBefore.lastAlertedAt ??
        state.lastAlertedAt;
  const hasStateBinding = incidentEvidence.frames.some(
    (entry) => entry.stateBefore && entry.stateAfter,
  );
  const incident = buildReportIncident({
    feature: "ultima-raid-equipment",
    issue: targetIssue,
    submittedAt,
    source: "runtime-atomic",
    sampledAt: capturedAt,
    timestamps: [
      ...incidentEvidence.frames.map((entry) => entry.sampledAt),
      ...incidentEvidence.playbackAttempts.flatMap((entry) => [
        entry.requestedAt,
        entry.startedAt,
        entry.finishedAt,
        entry.failedAt,
      ]),
    ],
    frameCount: incidentEvidence.frames.length,
    stateBinding: hasStateBinding ? "before-after" : "unavailable",
    mediaCount: incidentEvidence.media.length,
    cycleId,
    journalSelection,
    evidenceReferences: [
      createReportEvidenceReference({
        id: "ultima-raid-equipment-source",
        kind: "sourceImage",
        paths:
          incidentEvidence.media.length > 0
            ? ["sample.ultimaRaidEquipmentEvidence.media"]
            : [],
        capturedAt,
        frameId: selectedFrame?.id ?? null,
        cycleId,
      }),
      createReportEvidenceReference({
        id: "ultima-raid-equipment-trace",
        kind: "temporalTrace",
        paths:
          incidentEvidence.frames.length > 1
            ? ["sample.ultimaRaidEquipmentEvidence.frames"]
            : [],
        capturedAt,
        frameId: selectedFrame?.id ?? null,
        cycleId,
      }),
      createReportEvidenceReference({
        id: "ultima-raid-equipment-state",
        kind: "stateBeforeAfter",
        paths: hasStateBinding
          ? ["sample.ultimaRaidEquipmentEvidence.frames"]
          : [],
        capturedAt,
        frameId: selectedFrame?.id ?? null,
        cycleId,
      }),
      createReportEvidenceReference({
        id: "ultima-raid-equipment-decision",
        kind: "decision",
        paths:
          incidentEvidence.frames.length > 0
            ? ["sample.ultimaRaidEquipmentEvidence.frames"]
            : [],
        capturedAt,
        frameId: selectedFrame?.id ?? null,
        cycleId,
      }),
      createReportEvidenceReference({
        id: "ultima-raid-equipment-playback",
        kind: "playback",
        paths:
          incidentEvidence.playbackAttempts.length > 0
            ? ["sample.ultimaRaidEquipmentEvidence.playbackAttempts"]
            : [],
        capturedAt: selectedPlayback?.requestedAt ?? null,
        frameId: selectedPlayback?.frameId ?? null,
        cycleId,
      }),
      createReportEvidenceReference({
        id: "ultima-raid-equipment-config",
        kind: "configuration",
        paths: ["ultimaRaidEquipment.config"],
        capturedAt: incidentEvidence.frozenAt,
        frameId: null,
        cycleId,
      }),
      createReportEvidenceReference({
        id: "ultima-raid-equipment-runtime",
        kind: "runtime",
        paths: ["sample.result.detectorVersion"],
        capturedAt,
        frameId: selectedFrame?.id ?? null,
        cycleId,
      }),
    ],
    completeness: {
      sourceImage: incidentEvidence.media.length > 0,
      temporalTrace: incidentEvidence.frames.length > 1,
      stateBeforeAfter: hasStateBinding,
      decision: incidentEvidence.frames.length > 0,
      playback: incidentEvidence.playbackAttempts.length > 0,
      affectedTarget: true,
    },
  });
  incident.correlation = {
    ...incident.correlation,
    frameIds: incidentEvidence.frames.map((entry) => entry.id),
    cycleIds:
      cycleId === null || cycleId === undefined ? [] : [cycleId],
    playbackIds: incidentEvidence.playbackAttempts.map((entry) => entry.id),
  };

  return createAlertReportPayload({
    kind:
      target === "boss"
        ? "ultima-raid-boss-issue"
        : "ultima-raid-equipment-issue",
    submittedAt,
    url,
    appBuild: getAppBuildReportInfo(),
    clientId,
    reportIssue: targetIssue,
    incident,
    diagnostics: {
      ...viewportDiagnostics,
      capture: captureDiagnostics,
    },
    sample: {
      sampledAt: capturedAt,
      ultimaRaidEquipmentEvidence: incidentEvidence,
      result: {
        value:
          target === "boss"
            ? detected
              ? "boss"
              : "not-boss"
            : detected
              ? "full"
              : "not-full",
        detected,
        candidateCount: detected ? 1 : 0,
        confidence:
          target === "boss"
            ? selectedFrame?.bossBarFillRatio ??
              snapshot?.bossBarFillRatio ??
              null
            : selectedFrame?.confidence ?? snapshot?.confidence ?? null,
        detectionSource:
          target === "boss"
            ? "boss-progress-bar"
            : selectedFrame?.detectionSource ??
              snapshot?.detectionSource ??
              "none",
        bagCountState:
          selectedFrame?.bagCountState ??
          snapshot?.bagCountState ??
          null,
        bagCountReadable:
          selectedFrame?.bagCountReadable ??
          snapshot?.bagCountReadable ??
          null,
        bagCountOccluded:
          selectedFrame?.bagCountOccluded ??
          snapshot?.bagCountOccluded ??
          null,
        bagFullDetected:
          selectedFrame?.bagFullDetected ??
          snapshot?.bagFullDetected ??
          false,
        bagWarmPixelRatio:
          selectedFrame?.bagWarmPixelRatio ??
          snapshot?.bagWarmPixelRatio ??
          null,
        fullBannerDetected:
          selectedFrame?.fullBannerDetected ??
          snapshot?.fullBannerDetected ??
          false,
        detectorVersion:
          target === "boss"
            ? selectedFrame?.bossDetectorVersion ??
              snapshot?.bossDetectorVersion ??
              null
            : selectedFrame?.detectorVersion ??
              snapshot?.detectorVersion ??
              null,
        layoutValid:
          selectedFrame?.layoutValid ?? snapshot?.layoutValid ?? false,
        shouldAlert:
          target === "boss"
            ? selectedFrame?.bossShouldAlert ?? false
            : selectedFrame?.shouldAlert ?? false,
        bossProgressState:
          selectedFrame?.bossProgressState ??
          snapshot?.bossProgressState ??
          null,
        bossBarDetected:
          selectedFrame?.bossBarDetected ??
          snapshot?.bossBarDetected ??
          false,
        bossBarWidthRatio:
          selectedFrame?.bossBarWidthRatio ??
          snapshot?.bossBarWidthRatio ??
          null,
        bossBarFillRatio:
          selectedFrame?.bossBarFillRatio ??
          snapshot?.bossBarFillRatio ??
          null,
        normalProgressBarDetected:
          selectedFrame?.normalProgressBarDetected ??
          snapshot?.normalProgressBarDetected ??
          false,
      },
    },
    ultimaRaidEquipment: {
      alertTarget: target,
      config: getUltimaRaidEquipmentConfigSnapshot(config),
      state,
      lastSnapshot: snapshot
        ? {
            sampledAt: snapshot.sampledAt,
            detectorVersion: snapshot.detectorVersion,
            layoutKey: snapshot.layoutKey,
            sourceDimensions: snapshot.sourceDimensions,
            sampledRegion: snapshot.sampledRegion,
            detected: snapshot.detected,
            confidence: snapshot.confidence,
            layoutValid: snapshot.layoutValid,
            detectionSource: snapshot.detectionSource,
            bagCountState: snapshot.bagCountState,
            bagCountReadable: snapshot.bagCountReadable,
            bagCountOccluded: snapshot.bagCountOccluded,
            bagFullDetected: snapshot.bagFullDetected,
            bagWarmPixelRatio: snapshot.bagWarmPixelRatio,
            fullBannerDetected: snapshot.fullBannerDetected,
            bossDetectorVersion: snapshot.bossDetectorVersion,
            bossProgressState: snapshot.bossProgressState,
            bossBarDetected: snapshot.bossBarDetected,
            bossBarWidthRatio: snapshot.bossBarWidthRatio,
            bossBarFillRatio: snapshot.bossBarFillRatio,
            normalProgressBarDetected:
              snapshot.normalProgressBarDetected,
          }
        : null,
      reportReason: issue.reason,
    },
  });
}
