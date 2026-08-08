import {
  getBuffExpiryTrackingId,
  SUPPORTED_BUFF_EXPIRY_BUFF_IDS,
} from "./buffExpiryCatalog";
import type {
  BuffExpiryAcceptedMatch,
  BuffExpiryIconEvidence,
  BuffExpiryRejectedMatch,
  BuffExpiryTemporalCandidateMatch,
  BuffExpiryTopMatch,
  BuffExpiryTrackedBuff,
} from "./buffExpiryTypes";
import { getBuffExpiryBoxKey } from "./buffExpiryRuntimeDiagnosticBoxes";

const BUFF_EXPIRY_ICON_EVIDENCE_WINDOW_MS = 5 * 60_000;
const BUFF_EXPIRY_ICON_EVIDENCE_LIMIT = 120;
const BUFF_EXPIRY_ICON_EVIDENCE_REJECTED_FRAME_LIMIT = 12;
const BUFF_EXPIRY_ICON_EVIDENCE_TOP_MATCH_LIMIT = 3;
const BUFF_EXPIRY_ICON_EVIDENCE_MIN_NEAR_MISS_SCORE = 0.84;
const BUFF_EXPIRY_ICON_EVIDENCE_MIN_DIAGNOSTIC_SCORE = 0.72;
const BUFF_EXPIRY_ICON_EVIDENCE_MIN_LOW_SCORE_DIAGNOSTIC_SCORE = 0.78;
const BUFF_EXPIRY_ICON_EVIDENCE_MIN_SAMPLE_GAP_MS = 4_000;

const SUPPORTED_BUFF_EXPIRY_BUFF_ID_SET = new Set<string>(
  SUPPORTED_BUFF_EXPIRY_BUFF_IDS,
);

export function appendBuffExpiryIconEvidence({
  history,
  sampledAt,
  acceptedMatches,
  temporalCandidateMatches,
  rejectedMatches,
  previousTracks,
  tracks,
  alertedTrackIds,
  normalizedBoxPreviewUrls,
}: {
  history: BuffExpiryIconEvidence[];
  sampledAt: number;
  acceptedMatches: BuffExpiryAcceptedMatch[];
  temporalCandidateMatches: BuffExpiryTemporalCandidateMatch[];
  rejectedMatches: BuffExpiryRejectedMatch[];
  previousTracks: BuffExpiryTrackedBuff[];
  tracks: BuffExpiryTrackedBuff[];
  alertedTrackIds: string[];
  normalizedBoxPreviewUrls: Record<string, string>;
}): BuffExpiryIconEvidence[] {
  const matchedBoxKeys = new Set<string>([
    ...acceptedMatches.map((match) => getBuffExpiryBoxKey(match.box)),
    ...temporalCandidateMatches.map((match) =>
      getBuffExpiryBoxKey(match.box),
    ),
  ]);
  const previousTrackIds = new Set(previousTracks.map((track) => track.id));
  const alertedTrackIdSet = new Set(alertedTrackIds);
  const entries: BuffExpiryIconEvidence[] = [
    ...acceptedMatches.map((match) =>
      createMatchIconEvidence({
        sampledAt,
        source: "accepted",
        match,
        normalizedBoxPreviewUrls,
      }),
    ),
    ...temporalCandidateMatches.map((match) =>
      createMatchIconEvidence({
        sampledAt,
        source: "temporal",
        match,
        normalizedBoxPreviewUrls,
      }),
    ),
    ...selectBuffExpiryRejectedIconEvidenceMatches(
      rejectedMatches,
      matchedBoxKeys,
    ).flatMap((match) => {
      const evidence = createRejectedIconEvidence({
        sampledAt,
        match,
        normalizedBoxPreviewUrls,
      });
      return evidence ? [evidence] : [];
    }),
    ...tracks.flatMap((track) => {
      if (previousTrackIds.has(track.id)) {
        return [];
      }
      return [
        createTrackIconEvidence({
          sampledAt,
          source: "confirmed",
          track,
          normalizedBoxPreviewUrls,
        }),
      ];
    }),
    ...tracks.flatMap((track) => {
      if (!alertedTrackIdSet.has(track.id)) {
        return [];
      }
      return [
        createTrackIconEvidence({
          sampledAt,
          source: "alerted",
          track,
          normalizedBoxPreviewUrls,
        }),
      ];
    }),
  ].filter((entry) => shouldAppendBuffExpiryIconEvidence(history, entry));

  return pruneBuffExpiryIconEvidence([...history, ...entries], sampledAt);
}

function createMatchIconEvidence({
  sampledAt,
  source,
  match,
  normalizedBoxPreviewUrls,
}: {
  sampledAt: number;
  source: "accepted" | "temporal";
  match: BuffExpiryAcceptedMatch | BuffExpiryTemporalCandidateMatch;
  normalizedBoxPreviewUrls: Record<string, string>;
}): BuffExpiryIconEvidence {
  const slotKey = getBuffExpiryBoxKey(match.box);
  return {
    sampledAt,
    source,
    slotKey,
    buffId: getBuffExpiryTrackingId(match.buffId),
    name: match.name,
    seconds: match.seconds,
    score: match.score,
    reason: match.reason,
    box: match.box,
    topMatches: compactBuffExpiryIconEvidenceTopMatches(match.topMatches),
    normalizedIconDataUrl: normalizedBoxPreviewUrls[slotKey] ?? null,
  };
}

function createRejectedIconEvidence({
  sampledAt,
  match,
  normalizedBoxPreviewUrls,
}: {
  sampledAt: number;
  match: BuffExpiryRejectedMatch;
  normalizedBoxPreviewUrls: Record<string, string>;
}): BuffExpiryIconEvidence | null {
  if (!shouldKeepRejectedIconEvidence(match)) {
    return null;
  }

  const buffId = getBuffExpiryTrackingId(match.candidateBuffId);
  if (!SUPPORTED_BUFF_EXPIRY_BUFF_ID_SET.has(buffId)) {
    return null;
  }

  const slotKey = getBuffExpiryBoxKey(match.box);
  return {
    sampledAt,
    source: "near-miss",
    slotKey,
    buffId,
    name: match.candidateName,
    seconds: match.candidateSeconds,
    score: match.score,
    reason: match.reason,
    box: match.box,
    topMatches: compactBuffExpiryIconEvidenceTopMatches(match.topMatches),
    normalizedIconDataUrl: normalizedBoxPreviewUrls[slotKey] ?? null,
  };
}

function selectBuffExpiryRejectedIconEvidenceMatches(
  rejectedMatches: BuffExpiryRejectedMatch[],
  matchedBoxKeys: Set<string>,
): BuffExpiryRejectedMatch[] {
  const seen = new Set<string>();
  const candidates = rejectedMatches
    .filter((match) => !matchedBoxKeys.has(getBuffExpiryBoxKey(match.box)))
    .filter(shouldKeepRejectedIconEvidence)
    .sort(compareBuffExpiryRejectedIconEvidenceMatch);
  const selected: BuffExpiryRejectedMatch[] = [];
  for (const match of candidates) {
    const buffId = getBuffExpiryTrackingId(match.candidateBuffId);
    const key = [
      buffId,
      match.reason,
      match.candidateSeconds ?? "unknown",
    ].join(":");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    selected.push(match);
    if (selected.length >= BUFF_EXPIRY_ICON_EVIDENCE_REJECTED_FRAME_LIMIT) {
      break;
    }
  }
  return selected;
}

function shouldKeepRejectedIconEvidence(
  match: BuffExpiryRejectedMatch,
): match is BuffExpiryRejectedMatch & {
  candidateBuffId: string;
} {
  if (!match.candidateBuffId) {
    return false;
  }
  const buffId = getBuffExpiryTrackingId(match.candidateBuffId);
  if (!SUPPORTED_BUFF_EXPIRY_BUFF_ID_SET.has(buffId)) {
    return false;
  }
  if (match.score >= BUFF_EXPIRY_ICON_EVIDENCE_MIN_NEAR_MISS_SCORE) {
    return true;
  }
  if (
    isBuffExpiryDiagnosticRejectedReason(match.reason) &&
    match.score >= BUFF_EXPIRY_ICON_EVIDENCE_MIN_DIAGNOSTIC_SCORE
  ) {
    return true;
  }
  return (
    match.reason === "low-score" &&
    match.score >= BUFF_EXPIRY_ICON_EVIDENCE_MIN_LOW_SCORE_DIAGNOSTIC_SCORE
  );
}

function compareBuffExpiryRejectedIconEvidenceMatch(
  a: BuffExpiryRejectedMatch,
  b: BuffExpiryRejectedMatch,
): number {
  return (
    getBuffExpiryRejectedIconEvidencePriority(b) -
      getBuffExpiryRejectedIconEvidencePriority(a) ||
    b.score - a.score
  );
}

function getBuffExpiryRejectedIconEvidencePriority(
  match: BuffExpiryRejectedMatch,
): number {
  if (
    match.reason === "excluded-buff-identity" ||
    match.reason === "excluded-buff-identity-soft"
  ) {
    return 60;
  }
  if (
    match.reason === "identity-not-confident" ||
    match.reason === "identity-rejected"
  ) {
    return 55;
  }
  if (match.reason === "minute-label") {
    return 50;
  }
  if (match.reason === "low-score") {
    return 45;
  }
  return 40;
}

function isBuffExpiryDiagnosticRejectedReason(reason: string): boolean {
  return (
    reason === "minute-label" ||
    reason === "identity-not-confident" ||
    reason === "identity-rejected" ||
    reason === "identity-unavailable" ||
    reason === "excluded-buff-identity" ||
    reason === "excluded-buff-identity-soft"
  );
}

function createTrackIconEvidence({
  sampledAt,
  source,
  track,
  normalizedBoxPreviewUrls,
}: {
  sampledAt: number;
  source: "confirmed" | "alerted";
  track: BuffExpiryTrackedBuff;
  normalizedBoxPreviewUrls: Record<string, string>;
}): BuffExpiryIconEvidence {
  const slotKey = getBuffExpiryBoxKey(track.box);
  return {
    sampledAt,
    source,
    slotKey,
    buffId: getBuffExpiryTrackingId(track.buffId),
    name: track.name,
    seconds: Math.max(0, Math.ceil((track.expiresAt - sampledAt) / 1000)),
    score: track.score,
    reason: source,
    box: track.box,
    topMatches: [],
    normalizedIconDataUrl: normalizedBoxPreviewUrls[slotKey] ?? null,
  };
}

function compactBuffExpiryIconEvidenceTopMatches(
  topMatches: BuffExpiryTopMatch[],
): BuffExpiryTopMatch[] {
  return topMatches.slice(0, BUFF_EXPIRY_ICON_EVIDENCE_TOP_MATCH_LIMIT);
}

function shouldAppendBuffExpiryIconEvidence(
  history: BuffExpiryIconEvidence[],
  entry: BuffExpiryIconEvidence,
): boolean {
  if (entry.source === "confirmed" || entry.source === "alerted") {
    return true;
  }

  const latestMatchingEntry = [...history].reverse().find(
    (item) =>
      item.source === entry.source &&
      item.slotKey === entry.slotKey &&
      item.buffId === entry.buffId &&
      item.reason === entry.reason &&
      item.seconds === entry.seconds,
  );
  return (
    !latestMatchingEntry ||
    entry.sampledAt - latestMatchingEntry.sampledAt >=
      BUFF_EXPIRY_ICON_EVIDENCE_MIN_SAMPLE_GAP_MS
  );
}

function trimBuffExpiryIconEvidence(
  history: BuffExpiryIconEvidence[],
): BuffExpiryIconEvidence[] {
  if (history.length <= BUFF_EXPIRY_ICON_EVIDENCE_LIMIT) {
    return history;
  }

  return [...history]
    .sort(compareBuffExpiryIconEvidenceValue)
    .slice(0, BUFF_EXPIRY_ICON_EVIDENCE_LIMIT)
    .sort((a, b) => a.sampledAt - b.sampledAt);
}

function compareBuffExpiryIconEvidenceValue(
  a: BuffExpiryIconEvidence,
  b: BuffExpiryIconEvidence,
): number {
  return (
    getBuffExpiryIconEvidencePriority(b) -
      getBuffExpiryIconEvidencePriority(a) ||
    b.score - a.score ||
    b.sampledAt - a.sampledAt
  );
}

function getBuffExpiryIconEvidencePriority(entry: BuffExpiryIconEvidence): number {
  if (entry.source === "alerted") {
    return 100;
  }
  if (entry.source === "confirmed") {
    return 95;
  }
  if (entry.source === "accepted") {
    return 90;
  }
  if (entry.source === "temporal") {
    return 80;
  }
  if (
    entry.reason === "excluded-buff-identity" ||
    entry.reason === "excluded-buff-identity-soft"
  ) {
    return 70;
  }
  if (
    entry.reason === "identity-not-confident" ||
    entry.reason === "identity-rejected"
  ) {
    return 65;
  }
  if (entry.reason === "minute-label") {
    return 60;
  }
  if (entry.reason === "low-score") {
    return 55;
  }
  return 50;
}

export function pruneBuffExpiryIconEvidence(
  history: BuffExpiryIconEvidence[],
  sampledAt: number,
): BuffExpiryIconEvidence[] {
  return trimBuffExpiryIconEvidence(
    history.filter(
      (entry) => sampledAt - entry.sampledAt <= BUFF_EXPIRY_ICON_EVIDENCE_WINDOW_MS,
    ),
  );
}
