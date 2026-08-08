import type {
  BuffExpiryAcceptedMatch,
  BuffExpiryBox,
  BuffExpiryIconImageData,
  BuffExpiryPendingTrack,
  BuffExpiryRejectedMatch,
  BuffExpirySnapshot,
  BuffExpiryTrackedBuff,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import type {
  BuffExpiryPrecisionIconObservation,
  BuffExpiryPrecisionTargetGroup,
} from "../../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";
import {
  getBuffExpiryPrecisionGroupFromBuffId,
  isBuffExpiryPrecisionTargetGroup,
} from "./buffExpiryPrecisionTargetConfig";

export type BuffExpiryDetectedBoxView = {
  box: BuffExpiryBox;
  acceptedMatch: BuffExpiryAcceptedMatch | null;
  rejectedMatch: BuffExpiryRejectedMatch | null;
  track: BuffExpiryTrackedBuff | null;
  pendingTrack: BuffExpiryPendingTrack | null;
  nextObservation?: BuffExpiryPrecisionIconObservation | null;
};

export function getBuffExpiryPrecisionAllBoxViews(
  snapshot: BuffExpirySnapshot | null,
): BuffExpiryDetectedBoxView[] {
  if (!snapshot) {
    return [];
  }

  const observationsByIndex = new Map(
    (snapshot.nextIconObservations ?? []).map((observation) => [observation.boxIndex, observation]),
  );
  const trackByBox = new Map(snapshot.tracks.map((track) => [getBoxKey(track.box), track]));
  const pendingByBox = new Map(snapshot.pendingTracks.map((track) => [getBoxKey(track.box), track]));
  return snapshot.boxes.map((box, index) => ({
    box,
    acceptedMatch: null,
    rejectedMatch: null,
    track: trackByBox.get(getBoxKey(box)) ?? null,
    pendingTrack: pendingByBox.get(getBoxKey(box)) ?? null,
    nextObservation: observationsByIndex.get(index) ?? null,
  }));
}

export function getBuffExpiryPrecisionViewGroup(
  view: BuffExpiryDetectedBoxView,
): BuffExpiryPrecisionTargetGroup | null {
  const buffId = view.track?.buffId ?? view.pendingTrack?.buffId ?? null;
  if (buffId?.startsWith("next:")) {
    const group = buffId.slice("next:".length);
    if (isBuffExpiryPrecisionTargetGroup(group)) {
      return group;
    }
  }
  return view.nextObservation?.identity.kind === "target"
    ? view.nextObservation.identity.group
    : null;
}

export function getBuffExpiryPrecisionBoxPreviewDataUrl(
  snapshot: BuffExpirySnapshot | null,
  box: BuffExpiryBox,
): string | null {
  return snapshot?.boxPreviewUrls?.[getBoxKey(box)] ?? null;
}

export function getBuffExpiryPrecisionBoxPreviewImageData(
  snapshot: BuffExpirySnapshot | null,
  box: BuffExpiryBox,
): BuffExpiryIconImageData | null {
  return snapshot?.boxPreviewImageData?.[getBoxKey(box)] ?? null;
}

export function getBoxKey(box: BuffExpiryBox): string {
  return `${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.width)}:${Math.round(box.height)}`;
}

export function getStableBoxSlotKey(box: BuffExpiryBox): string {
  if (Number.isFinite(box.row) && Number.isFinite(box.col)) {
    return `layout:${Math.max(0, Math.round(box.row ?? 0))}:${Math.max(0, Math.round(box.col ?? 0))}`;
  }
  return getBoxKey(box);
}

export function compareBuffExpiryPrecisionTargetViewPosition(
  left: BuffExpiryDetectedBoxView,
  right: BuffExpiryDetectedBoxView,
): number {
  const leftRow = Number.isFinite(left.box.row) ? Math.round(left.box.row ?? 0) : Math.round(left.box.y);
  const rightRow = Number.isFinite(right.box.row) ? Math.round(right.box.row ?? 0) : Math.round(right.box.y);
  const leftCol = Number.isFinite(left.box.col) ? Math.round(left.box.col ?? 0) : Math.round(left.box.x);
  const rightCol = Number.isFinite(right.box.col) ? Math.round(right.box.col ?? 0) : Math.round(right.box.x);
  return leftRow - rightRow || leftCol - rightCol;
}

export { getBuffExpiryPrecisionGroupFromBuffId };
