import type {
  BuffExpiryBox,
  BuffExpiryLastAlertEvidence,
} from "./buffExpiryTypes";

type BuffExpiryBoxPreviewLookup = {
  box: BuffExpiryBox;
  boxes: BuffExpiryBox[];
  boxPreviewUrls: Record<string, string> | null | undefined;
};

export function hydrateBuffExpiryLastAlertEvidenceIcons(
  evidence: BuffExpiryLastAlertEvidence | null | undefined,
  boxPreviewUrls: Record<string, string> | null | undefined,
  boxes: BuffExpiryBox[],
): BuffExpiryLastAlertEvidence | null {
  if (!evidence) {
    return null;
  }

  let changed = false;
  const triggeredTracks = evidence.triggeredTracks.map((track) => {
    if (track.normalizedIconDataUrl) {
      return track;
    }

    const normalizedIconDataUrl = getBuffExpiryBoxPreviewDataUrlForBox({
      box: track.box,
      boxes,
      boxPreviewUrls,
    });
    if (!normalizedIconDataUrl) {
      return track;
    }

    changed = true;
    return {
      ...track,
      normalizedIconDataUrl,
    };
  });

  if (!changed) {
    return evidence;
  }

  return {
    ...evidence,
    triggeredTracks,
  };
}

export function getBuffExpiryBoxPreviewDataUrlForBox({
  box,
  boxes,
  boxPreviewUrls,
}: BuffExpiryBoxPreviewLookup): string | null {
  if (!boxPreviewUrls) {
    return null;
  }

  const exactKey = getBuffExpiryEvidenceBoxKey(box);
  const exactUrl = boxPreviewUrls[exactKey];
  if (exactUrl) {
    return exactUrl;
  }

  const sameSlotMatch = findBuffExpiryEvidenceSameSlotBox(box, boxes, boxPreviewUrls);
  if (sameSlotMatch) {
    return sameSlotMatch;
  }

  return findBuffExpiryEvidenceNearestBox(box, boxes, boxPreviewUrls);
}

function findBuffExpiryEvidenceSameSlotBox(
  box: BuffExpiryBox,
  boxes: BuffExpiryBox[],
  boxPreviewUrls: Record<string, string>,
): string | null {
  if (!Number.isFinite(box.row) || !Number.isFinite(box.col)) {
    return null;
  }

  for (const candidate of boxes) {
    if (
      Math.round(candidate.row ?? -1) !== Math.round(box.row ?? -2) ||
      Math.round(candidate.col ?? -1) !== Math.round(box.col ?? -2)
    ) {
      continue;
    }
    const dataUrl = boxPreviewUrls[getBuffExpiryEvidenceBoxKey(candidate)];
    if (dataUrl) {
      return dataUrl;
    }
  }

  return null;
}

function findBuffExpiryEvidenceNearestBox(
  box: BuffExpiryBox,
  boxes: BuffExpiryBox[],
  boxPreviewUrls: Record<string, string>,
): string | null {
  const maxDistance = Math.max(box.side ?? box.width, box.height, 1) * 1.75;
  let bestUrl: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of boxes) {
    const dataUrl = boxPreviewUrls[getBuffExpiryEvidenceBoxKey(candidate)];
    if (!dataUrl) {
      continue;
    }

    const distance = getBuffExpiryEvidenceBoxDistance(box, candidate);
    if (distance > maxDistance || distance >= bestDistance) {
      continue;
    }

    bestDistance = distance;
    bestUrl = dataUrl;
  }

  return bestUrl;
}

function getBuffExpiryEvidenceBoxDistance(left: BuffExpiryBox, right: BuffExpiryBox): number {
  const leftX = left.x + left.width / 2;
  const leftY = left.y + left.height / 2;
  const rightX = right.x + right.width / 2;
  const rightY = right.y + right.height / 2;
  return Math.hypot(leftX - rightX, leftY - rightY);
}

function getBuffExpiryEvidenceBoxKey(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string {
  return `${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.width)}:${Math.round(box.height)}`;
}
