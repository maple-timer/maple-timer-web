import type {
  BuffExpiryBox,
  BuffExpiryIconImageData,
  BuffExpirySnapshot,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryPrecisionTargetGroup } from "../../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";
import {
  BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_VISIBLE,
  BUFF_EXPIRY_PRECISION_TARGET_GROUPS,
} from "./buffExpiryPrecisionTargetConfig";
import {
  isBuffExpiryPrecisionBoxSuppressedByActiveAlert,
  isBuffExpiryPrecisionGroupFullySuppressedByActiveAlert,
} from "./buffExpiryPrecisionTargetSuppression";
import {
  compareBuffExpiryPrecisionTargetViewPosition,
  getBuffExpiryPrecisionBoxPreviewDataUrl,
  getBuffExpiryPrecisionBoxPreviewImageData,
  getStableBoxSlotKey,
  type BuffExpiryDetectedBoxView,
} from "./buffExpiryPrecisionTargetViewModel";

const BUFF_EXPIRY_PRECISION_TARGET_STICKY_WINDOW_MS = 8_000;
const BUFF_EXPIRY_PRECISION_TARGET_STICKY_HOLD_MS = 5_000;
const BUFF_EXPIRY_PRECISION_TARGET_STICKY_FIRST_MISS_HOLD_MS = 2_200;
const BUFF_EXPIRY_PRECISION_TARGET_STICKY_MIN_OBSERVATIONS = 3;

export type BuffExpiryPrecisionStickyTargetEntry = {
  id: string;
  group: BuffExpiryPrecisionTargetGroup;
  view: BuffExpiryDetectedBoxView;
  previewDataUrl: string | null;
  previewImageData: BuffExpiryIconImageData | null;
  firstSeenAt: number;
  lastSeenAt: number;
  seenAtList: number[];
};

export function updateBuffExpiryPrecisionStickyTargetEntries(
  stickyEntriesByGroup: Map<BuffExpiryPrecisionTargetGroup, BuffExpiryPrecisionStickyTargetEntry[]>,
  snapshot: BuffExpirySnapshot | null,
  visibleViewsByGroup: Map<BuffExpiryPrecisionTargetGroup, BuffExpiryDetectedBoxView[]>,
  sampledAt: number,
): void {
  if (!snapshot) {
    stickyEntriesByGroup.clear();
    return;
  }

  for (const group of BUFF_EXPIRY_PRECISION_TARGET_GROUPS) {
    if (isBuffExpiryPrecisionGroupFullySuppressedByActiveAlert(snapshot, group, sampledAt)) {
      stickyEntriesByGroup.delete(group);
      continue;
    }

    const existingEntries = stickyEntriesByGroup.get(group) ?? [];
    const nextEntries = existingEntries
      .map((entry) => ({
        ...entry,
        seenAtList: pruneBuffExpiryPrecisionStickySeenAtList(entry.seenAtList, sampledAt),
      }))
      .filter((entry) => !isBuffExpiryPrecisionBoxSuppressedByActiveAlert(snapshot, group, entry.view.box, sampledAt))
      .filter((entry) => sampledAt - entry.lastSeenAt <= BUFF_EXPIRY_PRECISION_TARGET_STICKY_WINDOW_MS);

    for (const view of visibleViewsByGroup.get(group) ?? []) {
      const matchingEntry = findMatchingBuffExpiryPrecisionStickyTargetEntry(nextEntries, view);
      const seenAtList = matchingEntry
        ? appendBuffExpiryPrecisionStickySeenAt(matchingEntry.seenAtList, sampledAt)
        : [sampledAt];
      const previewDataUrl = getBuffExpiryPrecisionBoxPreviewDataUrl(snapshot, view.box);
      const previewImageData = getBuffExpiryPrecisionBoxPreviewImageData(snapshot, view.box);
      if (matchingEntry) {
        matchingEntry.view = view;
        matchingEntry.previewDataUrl = previewDataUrl ?? matchingEntry.previewDataUrl;
        matchingEntry.previewImageData = previewImageData ?? matchingEntry.previewImageData;
        matchingEntry.lastSeenAt = sampledAt;
        matchingEntry.seenAtList = seenAtList;
      } else {
        nextEntries.push({
          id: `${group}:${getStableBoxSlotKey(view.box)}`,
          group,
          view,
          previewDataUrl,
          previewImageData,
          firstSeenAt: sampledAt,
          lastSeenAt: sampledAt,
          seenAtList,
        });
      }
    }

    stickyEntriesByGroup.set(group, nextEntries);
  }
}

export function getDisplayableBuffExpiryPrecisionStickyTargetEntries(
  stickyEntriesByGroup: Map<BuffExpiryPrecisionTargetGroup, BuffExpiryPrecisionStickyTargetEntry[]>,
  snapshot: BuffExpirySnapshot | null,
  group: BuffExpiryPrecisionTargetGroup,
  sampledAt: number,
): BuffExpiryPrecisionStickyTargetEntry[] {
  if (!snapshot || isBuffExpiryPrecisionGroupFullySuppressedByActiveAlert(snapshot, group, sampledAt)) {
    return [];
  }
  return (stickyEntriesByGroup.get(group) ?? [])
    .filter((entry) => !isBuffExpiryPrecisionBoxSuppressedByActiveAlert(snapshot, group, entry.view.box, sampledAt))
    .filter((entry) => isDisplayableBuffExpiryPrecisionStickyTargetEntry(entry, sampledAt))
    .sort(
      (left, right) =>
        right.lastSeenAt - left.lastSeenAt ||
        compareBuffExpiryPrecisionTargetViewPosition(left.view, right.view),
    )
    .slice(0, BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_VISIBLE[group]);
}

function isDisplayableBuffExpiryPrecisionStickyTargetEntry(
  entry: BuffExpiryPrecisionStickyTargetEntry,
  sampledAt: number,
): boolean {
  const elapsedSinceLastSeen = sampledAt - entry.lastSeenAt;
  if (elapsedSinceLastSeen <= BUFF_EXPIRY_PRECISION_TARGET_STICKY_FIRST_MISS_HOLD_MS) {
    return true;
  }

  return (
    elapsedSinceLastSeen <= BUFF_EXPIRY_PRECISION_TARGET_STICKY_HOLD_MS &&
    pruneBuffExpiryPrecisionStickySeenAtList(entry.seenAtList, sampledAt).length >=
      BUFF_EXPIRY_PRECISION_TARGET_STICKY_MIN_OBSERVATIONS
  );
}

function findMatchingBuffExpiryPrecisionStickyTargetEntry(
  entries: BuffExpiryPrecisionStickyTargetEntry[],
  view: BuffExpiryDetectedBoxView,
): BuffExpiryPrecisionStickyTargetEntry | null {
  const stableKey = getStableBoxSlotKey(view.box);
  return (
    entries.find((entry) => getStableBoxSlotKey(entry.view.box) === stableKey) ??
    entries.find((entry) => areBuffExpiryPrecisionTargetBoxesNearby(entry.view.box, view.box)) ??
    null
  );
}

function areBuffExpiryPrecisionTargetBoxesNearby(left: BuffExpiryBox, right: BuffExpiryBox): boolean {
  if (
    Number.isFinite(left.row) &&
    Number.isFinite(left.col) &&
    Number.isFinite(right.row) &&
    Number.isFinite(right.col)
  ) {
    return (
      Math.abs(Math.round(left.row ?? 0) - Math.round(right.row ?? 0)) <= 1 &&
      Math.abs(Math.round(left.col ?? 0) - Math.round(right.col ?? 0)) <= 1
    );
  }

  const leftCenterX = left.x + left.width / 2;
  const leftCenterY = left.y + left.height / 2;
  const rightCenterX = right.x + right.width / 2;
  const rightCenterY = right.y + right.height / 2;
  const side = Math.max(1, left.side ?? left.width, right.side ?? right.width, left.height, right.height);
  return Math.hypot(leftCenterX - rightCenterX, leftCenterY - rightCenterY) <= side * 1.75;
}

function appendBuffExpiryPrecisionStickySeenAt(seenAtList: number[], sampledAt: number): number[] {
  const lastSeenAt = seenAtList[seenAtList.length - 1];
  if (lastSeenAt === sampledAt) {
    return pruneBuffExpiryPrecisionStickySeenAtList(seenAtList, sampledAt);
  }
  return pruneBuffExpiryPrecisionStickySeenAtList([...seenAtList, sampledAt], sampledAt);
}

function pruneBuffExpiryPrecisionStickySeenAtList(seenAtList: number[], sampledAt: number): number[] {
  return seenAtList.filter(
    (seenAt) => sampledAt - seenAt <= BUFF_EXPIRY_PRECISION_TARGET_STICKY_WINDOW_MS,
  );
}
