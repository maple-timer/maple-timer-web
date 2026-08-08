import type { BuffExpiryBox } from "./buffExpiryTypes";

const BUFF_EXPIRY_DISPLAY_CONFIRM_HITS = 1;
const BUFF_EXPIRY_DISPLAY_GRACE_MS = 0;

export type BuffExpiryDisplayBoxTrack = {
  id: string;
  box: BuffExpiryBox;
  firstSeenAt: number;
  lastSeenAt: number;
  consecutiveSeenCount: number;
  displayConfirmed: boolean;
};

export function stabilizeBuffExpiryDisplayBoxes({
  previousTracks,
  boxes,
  now,
}: {
  previousTracks: BuffExpiryDisplayBoxTrack[];
  boxes: BuffExpiryBox[];
  now: number;
}): { tracks: BuffExpiryDisplayBoxTrack[]; displayBoxes: BuffExpiryBox[] } {
  const consumedTrackIds = new Set<string>();
  const nextTracks: BuffExpiryDisplayBoxTrack[] = [];

  for (const box of boxes) {
    const previous = findNearestDisplayTrack(previousTracks, box, consumedTrackIds);
    if (previous) {
      consumedTrackIds.add(previous.id);
      const consecutiveSeenCount = previous.consecutiveSeenCount + 1;
      nextTracks.push({
        ...previous,
        box,
        lastSeenAt: now,
        consecutiveSeenCount,
        displayConfirmed:
          previous.displayConfirmed || consecutiveSeenCount >= BUFF_EXPIRY_DISPLAY_CONFIRM_HITS,
      });
      continue;
    }

    nextTracks.push({
      id: `${now}:${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.width)}:${Math.round(box.height)}`,
      box,
      firstSeenAt: now,
      lastSeenAt: now,
      consecutiveSeenCount: 1,
      displayConfirmed: BUFF_EXPIRY_DISPLAY_CONFIRM_HITS <= 1,
    });
  }

  for (const previous of previousTracks) {
    if (consumedTrackIds.has(previous.id)) {
      continue;
    }
    if (nextTracks.some((track) => track.id === previous.id)) {
      continue;
    }
    if (now - previous.lastSeenAt <= BUFF_EXPIRY_DISPLAY_GRACE_MS) {
      nextTracks.push({
        ...previous,
        consecutiveSeenCount: 0,
      });
    }
  }

  const tracks = nextTracks.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return {
    tracks,
    displayBoxes: tracks
      .filter((track) => track.displayConfirmed && now - track.lastSeenAt <= BUFF_EXPIRY_DISPLAY_GRACE_MS)
      .map((track) => track.box),
  };
}

function findNearestDisplayTrack(
  tracks: BuffExpiryDisplayBoxTrack[],
  box: BuffExpiryBox,
  consumedTrackIds: Set<string>,
): BuffExpiryDisplayBoxTrack | null {
  const candidates = tracks
    .filter((track) => !consumedTrackIds.has(track.id))
    .map((track) => ({ track, distance: boxDistance(track.box, box) }))
    .filter(({ track, distance }) => distance <= getBoxMatchRadius(track.box, box))
    .sort((a, b) => a.distance - b.distance);

  return candidates[0]?.track ?? null;
}

function boxDistance(a: BuffExpiryBox, b: BuffExpiryBox): number {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return Math.hypot(ax - bx, ay - by);
}

function getBoxMatchRadius(a: BuffExpiryBox, b: BuffExpiryBox): number {
  return Math.max(12, Math.max(a.width, a.height, b.width, b.height) * 1.5);
}
