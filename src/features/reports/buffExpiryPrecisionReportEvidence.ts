import type {
  BuffExpiryBox,
  BuffExpiryLastAlertEvidence,
  BuffExpirySnapshot,
} from "../../lib/buffExpiry/buffExpiryTypes";
import type {
  BuffExpiryPrecisionBestGroupCandidate,
  BuffExpiryPrecisionIconObservation,
  BuffExpiryPrecisionTargetGroup,
} from "../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";
import {
  BUFF_EXPIRY_PRECISION_GROUP_LABELS,
  BUFF_EXPIRY_PRECISION_REPORT_ICON_EVIDENCE_DATA_URL_MAX_LENGTH,
  BUFF_EXPIRY_PRECISION_REPORT_ICON_EVIDENCE_LIMIT,
} from "./buffExpiryPrecisionReportConstants";
import {
  getBuffExpiryPrecisionBoxKey,
  serializeBuffExpiryPrecisionBox,
  serializeBuffExpiryPrecisionParserBox,
  toBuffExpiryBox,
} from "./buffExpiryPrecisionReportBoxes";

type BuffExpiryPrecisionIconEvidenceDraft = {
  boxIndex: number;
  box: BuffExpiryBox;
  roles: Set<string>;
  group: BuffExpiryPrecisionTargetGroup | null;
  score: number | null;
  margin: number | null;
  bundleId: string | null;
  modelVersion: string | null;
  gateScore: number | null;
  gateMargin: number | null;
  decisionReason: string | null;
  countdownText: string | null;
};

export function buildBuffExpiryPrecisionGroupSummary(
  observations: BuffExpiryPrecisionIconObservation[],
  bestByGroup: BuffExpiryPrecisionBestGroupCandidate[],
) {
  return (Object.keys(BUFF_EXPIRY_PRECISION_GROUP_LABELS) as BuffExpiryPrecisionTargetGroup[]).map((group) => {
    const groupObservations = observations.filter((observation) => observation.identity.group === group);
    const bestCandidate = bestByGroup
      .filter((candidate) => candidate.group === group)
      .sort(
        (left, right) =>
          Number(right.accepted) - Number(left.accepted) ||
          Number(right.matcherAccepted) - Number(left.matcherAccepted) ||
          (right.gateMargin ?? Number.NEGATIVE_INFINITY) -
            (left.gateMargin ?? Number.NEGATIVE_INFINITY) ||
          right.margin - left.margin ||
          right.score - left.score,
      )[0] ?? null;
    return {
      group,
      label: BUFF_EXPIRY_PRECISION_GROUP_LABELS[group],
      targetCount: groupObservations.length,
      countdownCount: groupObservations.filter((observation) => observation.countdown).length,
      bestCandidate: bestCandidate ? serializeBuffExpiryPrecisionBestByGroupCandidate(bestCandidate) : null,
    };
  });
}

export function serializeBuffExpiryPrecisionIconObservation(observation: BuffExpiryPrecisionIconObservation) {
  return {
    id: observation.id,
    boxIndex: observation.boxIndex,
    box: serializeBuffExpiryPrecisionParserBox(observation.box),
    identity: observation.identity,
    countdown: observation.countdown ?? null,
  };
}

export function serializeBuffExpiryPrecisionBestByGroupCandidate(candidate: BuffExpiryPrecisionBestGroupCandidate) {
  return {
    group: candidate.group,
    boxIndex: candidate.boxIndex,
    box: serializeBuffExpiryPrecisionParserBox(candidate.box),
    accepted: candidate.accepted,
    matcherAccepted: candidate.matcherAccepted ?? null,
    winningGroup: candidate.winningGroup,
    score: candidate.score,
    margin: candidate.margin,
    bundleId: candidate.bundleId ?? null,
    modelVersion: candidate.modelVersion ?? null,
    gateScore: candidate.gateScore ?? null,
    gateMargin: candidate.gateMargin ?? null,
    decisionReason: candidate.decisionReason,
    countdown: candidate.countdown ?? null,
  };
}

export function serializeBuffExpiryPrecisionIconEvidence(
  snapshot: BuffExpirySnapshot,
  targetObservations: BuffExpiryPrecisionIconObservation[],
  bestByGroup: BuffExpiryPrecisionBestGroupCandidate[],
) {
  const evidenceByKey = new Map<string, BuffExpiryPrecisionIconEvidenceDraft>();

  for (const observation of targetObservations) {
    const box = toBuffExpiryBox(observation.box);
    const key = getBuffExpiryPrecisionBoxKey(box);
    const evidence = getOrCreateIconEvidence(evidenceByKey, key, observation.boxIndex, box);
    evidence.roles.add("target-observation");
    evidence.group = observation.identity.group;
    evidence.score = observation.identity.score;
    evidence.margin = observation.identity.margin;
    evidence.bundleId = observation.identity.bundleId ?? null;
    evidence.modelVersion = observation.identity.modelVersion ?? null;
    evidence.gateScore = observation.identity.gateScore ?? null;
    evidence.gateMargin = observation.identity.gateMargin ?? null;
    evidence.decisionReason = observation.identity.decisionReason;
    evidence.countdownText = observation.countdown?.text ?? null;
  }

  for (const candidate of bestByGroup) {
    const box = toBuffExpiryBox(candidate.box);
    const key = getBuffExpiryPrecisionBoxKey(box);
    const evidence = getOrCreateIconEvidence(evidenceByKey, key, candidate.boxIndex, box);
    evidence.roles.add("best-by-group");
    evidence.group = evidence.group ?? candidate.group;
    evidence.score = Math.max(evidence.score ?? Number.NEGATIVE_INFINITY, candidate.score);
    evidence.margin = Math.max(evidence.margin ?? Number.NEGATIVE_INFINITY, candidate.margin);
    if (
      evidence.group === candidate.group ||
      candidate.accepted ||
      candidate.matcherAccepted
    ) {
      evidence.bundleId = candidate.bundleId ?? evidence.bundleId;
      evidence.modelVersion = candidate.modelVersion ?? evidence.modelVersion;
      evidence.gateScore = candidate.gateScore ?? evidence.gateScore;
      evidence.gateMargin = candidate.gateMargin ?? evidence.gateMargin;
      evidence.decisionReason = candidate.decisionReason;
    }
    evidence.countdownText = evidence.countdownText ?? candidate.countdown?.text ?? null;
  }

  for (const track of [...snapshot.tracks, ...snapshot.pendingTracks]) {
    const isTracked = "expiresAt" in track;
    const key = getBuffExpiryPrecisionBoxKey(track.box);
    const evidence = getOrCreateIconEvidence(evidenceByKey, key, -1, track.box);
    evidence.roles.add(isTracked ? (track.alertedAt === null ? "tracked" : "alerted") : "pending");
    const latestSeconds = isTracked
      ? track.detectedSeconds
      : track.observations[track.observations.length - 1]?.seconds ?? null;
    evidence.countdownText = evidence.countdownText ?? (
      typeof latestSeconds === "number" ? String(latestSeconds) : null
    );
  }

  return [...evidenceByKey.entries()]
    .slice(0, BUFF_EXPIRY_PRECISION_REPORT_ICON_EVIDENCE_LIMIT)
    .map(([key, evidence]) => {
      const dataUrl = snapshot.boxPreviewUrls?.[key] ?? null;
      return {
        slotKey: key,
        boxIndex: evidence.boxIndex,
        roles: [...evidence.roles],
        group: evidence.group,
        score: evidence.score,
        margin: evidence.margin,
        bundleId: evidence.bundleId,
        modelVersion: evidence.modelVersion,
        gateScore: evidence.gateScore,
        gateMargin: evidence.gateMargin,
        decisionReason: evidence.decisionReason,
        countdownText: evidence.countdownText,
        box: serializeBuffExpiryPrecisionBox(evidence.box),
        normalizedIconDataUrl: isReportSafeBuffExpiryPrecisionIconDataUrl(dataUrl) ? dataUrl : null,
      };
    });
}

export function serializeBuffExpiryPrecisionLastAlertEvidence(evidence: BuffExpiryLastAlertEvidence | null) {
  if (!evidence) {
    return null;
  }

  return {
    alertedAt: evidence.alertedAt,
    alertLeadSeconds: evidence.alertLeadSeconds,
    clusterId: evidence.clusterId,
    dueAt: evidence.dueAt,
    triggeredTracks: evidence.triggeredTracks.map((track) => ({
      id: track.id,
      buffId: track.buffId,
      name: track.name,
      box: serializeBuffExpiryPrecisionBox(track.box),
      expiresAt: track.expiresAt,
      remainingSeconds: track.remainingSeconds,
      normalizedIconDataUrl: isReportSafeBuffExpiryPrecisionIconDataUrl(track.normalizedIconDataUrl)
        ? track.normalizedIconDataUrl
        : null,
    })),
  };
}

function getOrCreateIconEvidence(
  evidenceByKey: Map<string, BuffExpiryPrecisionIconEvidenceDraft>,
  key: string,
  boxIndex: number,
  box: BuffExpiryBox,
) {
  const existing = evidenceByKey.get(key);
  if (existing) {
    if (existing.boxIndex < 0 && boxIndex >= 0) {
      existing.boxIndex = boxIndex;
    }
    return existing;
  }
  const next = {
    boxIndex,
    box,
    roles: new Set<string>(),
    group: null,
    score: null,
    margin: null,
    bundleId: null,
    modelVersion: null,
    gateScore: null,
    gateMargin: null,
    decisionReason: null,
    countdownText: null,
  };
  evidenceByKey.set(key, next);
  return next;
}

function isReportSafeBuffExpiryPrecisionIconDataUrl(value: string | null): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("data:image/") &&
    value.length <= BUFF_EXPIRY_PRECISION_REPORT_ICON_EVIDENCE_DATA_URL_MAX_LENGTH
  );
}
