import type { BuffExpirySnapshot } from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryPrecisionTargetGroup } from "../../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";
import {
  BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_VISIBLE,
  BUFF_EXPIRY_PRECISION_TARGET_GROUPS,
} from "./buffExpiryPrecisionTargetConfig";
import {
  compareBuffExpiryPrecisionTargetViewPosition,
  getBuffExpiryPrecisionViewGroup,
  getStableBoxSlotKey,
  type BuffExpiryDetectedBoxView,
} from "./buffExpiryPrecisionTargetViewModel";
import {
  getDisplayableBuffExpiryPrecisionStickyTargetEntries,
  updateBuffExpiryPrecisionStickyTargetEntries,
  type BuffExpiryPrecisionStickyTargetEntry,
} from "./buffExpiryPrecisionStickyTargets";

export {
  BUFF_EXPIRY_PRECISION_COLLAPSED_TARGET_SLOT_COUNT,
  BUFF_EXPIRY_PRECISION_GROUP_LABELS,
  BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_VISIBLE,
  BUFF_EXPIRY_PRECISION_TARGET_GROUPS,
  getBuffExpiryPrecisionGroupFromBuffId,
  isBuffExpiryPrecisionTargetGroup,
} from "./buffExpiryPrecisionTargetConfig";
export {
  compareBuffExpiryPrecisionTargetViewPosition,
  getBoxKey,
  getBuffExpiryPrecisionAllBoxViews,
  getBuffExpiryPrecisionBoxPreviewDataUrl,
  getBuffExpiryPrecisionBoxPreviewImageData,
  getBuffExpiryPrecisionViewGroup,
  getStableBoxSlotKey,
  type BuffExpiryDetectedBoxView,
} from "./buffExpiryPrecisionTargetViewModel";
export { getBuffExpiryPrecisionTargetBoxViews } from "./buffExpiryPrecisionTargetViews";
export type { BuffExpiryPrecisionStickyTargetEntry } from "./buffExpiryPrecisionStickyTargets";

export type BuffExpiryPrecisionTargetSlot = {
  index: number;
  view: BuffExpiryDetectedBoxView | null;
  stickyEntry: BuffExpiryPrecisionStickyTargetEntry | null;
};

export function getBuffExpiryPrecisionTargetSlotState(
  snapshot: BuffExpirySnapshot | null,
  views: BuffExpiryDetectedBoxView[],
  selectedGroups: Set<BuffExpiryPrecisionTargetGroup>,
  slotAssignmentsByGroup: Map<BuffExpiryPrecisionTargetGroup, Map<string, number>>,
  stickyEntriesByGroup: Map<BuffExpiryPrecisionTargetGroup, BuffExpiryPrecisionStickyTargetEntry[]>,
): {
  visibleViewsByGroup: Map<BuffExpiryPrecisionTargetGroup, BuffExpiryDetectedBoxView[]>;
  slotsByGroup: Map<BuffExpiryPrecisionTargetGroup, BuffExpiryPrecisionTargetSlot[]>;
  visibleTargetCount: number;
} {
  const sampledAt = snapshot?.sampledAt ?? Date.now();
  const viewsByGroup = new Map<BuffExpiryPrecisionTargetGroup, BuffExpiryDetectedBoxView[]>();
  for (const group of BUFF_EXPIRY_PRECISION_TARGET_GROUPS) {
    viewsByGroup.set(group, []);
  }
  for (const view of views) {
    const group = getBuffExpiryPrecisionViewGroup(view);
    if (group) {
      viewsByGroup.get(group)?.push(view);
    }
  }
  clearUnselectedBuffExpiryPrecisionTargetState(
    selectedGroups,
    slotAssignmentsByGroup,
    stickyEntriesByGroup,
  );
  const visibleViewsByGroup = new Map<BuffExpiryPrecisionTargetGroup, BuffExpiryDetectedBoxView[]>();
  for (const group of BUFF_EXPIRY_PRECISION_TARGET_GROUPS) {
    visibleViewsByGroup.set(
      group,
      selectedGroups.has(group)
        ? getVisibleBuffExpiryPrecisionTargetGroupViews(viewsByGroup.get(group) ?? [], group)
        : [],
    );
  }
  updateBuffExpiryPrecisionStickyTargetEntries(
    stickyEntriesByGroup,
    snapshot,
    visibleViewsByGroup,
    sampledAt,
  );
  const slotsByGroup = getBuffExpiryPrecisionTargetSlotsByGroup(
    visibleViewsByGroup,
    slotAssignmentsByGroup,
    stickyEntriesByGroup,
    snapshot,
    sampledAt,
  );
  const visibleTargetCount = [...slotsByGroup.values()].reduce(
    (count, groupSlots) => count + groupSlots.filter((slot) => slot.view || slot.stickyEntry).length,
    0,
  );
  return {
    visibleViewsByGroup,
    slotsByGroup,
    visibleTargetCount,
  };
}

function clearUnselectedBuffExpiryPrecisionTargetState(
  selectedGroups: Set<BuffExpiryPrecisionTargetGroup>,
  slotAssignmentsByGroup: Map<BuffExpiryPrecisionTargetGroup, Map<string, number>>,
  stickyEntriesByGroup: Map<BuffExpiryPrecisionTargetGroup, BuffExpiryPrecisionStickyTargetEntry[]>,
): void {
  for (const group of BUFF_EXPIRY_PRECISION_TARGET_GROUPS) {
    if (selectedGroups.has(group)) {
      continue;
    }
    slotAssignmentsByGroup.delete(group);
    stickyEntriesByGroup.delete(group);
  }
}

function getVisibleBuffExpiryPrecisionTargetGroupViews(
  views: BuffExpiryDetectedBoxView[],
  group: BuffExpiryPrecisionTargetGroup,
): BuffExpiryDetectedBoxView[] {
  const maxVisible = BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_VISIBLE[group];
  return views
    .map((view, index) => ({ view, index }))
    .sort((a, b) => {
      const scoreDelta =
        (b.view.nextObservation?.identity.score ?? 0) - (a.view.nextObservation?.identity.score ?? 0);
      return scoreDelta || a.index - b.index;
    })
    .slice(0, maxVisible)
    .sort((a, b) => compareBuffExpiryPrecisionTargetViewPosition(a.view, b.view) || a.index - b.index)
    .map(({ view }) => view);
}

function getBuffExpiryPrecisionTargetSlotsByGroup(
  visibleViewsByGroup: Map<BuffExpiryPrecisionTargetGroup, BuffExpiryDetectedBoxView[]>,
  slotAssignmentsByGroup: Map<BuffExpiryPrecisionTargetGroup, Map<string, number>>,
  stickyEntriesByGroup: Map<BuffExpiryPrecisionTargetGroup, BuffExpiryPrecisionStickyTargetEntry[]>,
  snapshot: BuffExpirySnapshot | null,
  sampledAt: number,
): Map<BuffExpiryPrecisionTargetGroup, BuffExpiryPrecisionTargetSlot[]> {
  const slotsByGroup = new Map<BuffExpiryPrecisionTargetGroup, BuffExpiryPrecisionTargetSlot[]>();
  for (const group of BUFF_EXPIRY_PRECISION_TARGET_GROUPS) {
    const maxVisible = BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_VISIBLE[group];
    const views = visibleViewsByGroup.get(group) ?? [];
    const currentKeys = new Set(views.map((view) => getStableBoxSlotKey(view.box)));
    const stickyEntries = getDisplayableBuffExpiryPrecisionStickyTargetEntries(
      stickyEntriesByGroup,
      snapshot,
      group,
      sampledAt,
    ).filter((entry) => !currentKeys.has(getStableBoxSlotKey(entry.view.box)));
    const slots: BuffExpiryPrecisionTargetSlot[] = Array.from({ length: maxVisible }, (_, index) => ({
      index,
      view: null,
      stickyEntry: null,
    }));
    const groupAssignments = slotAssignmentsByGroup.get(group) ?? new Map<string, number>();
    slotAssignmentsByGroup.set(group, groupAssignments);
    const visibleKeys = new Set([
      ...views.map((view) => getStableBoxSlotKey(view.box)),
      ...stickyEntries.map((entry) => getStableBoxSlotKey(entry.view.box)),
    ]);

    for (const key of [...groupAssignments.keys()]) {
      if (!visibleKeys.has(key)) {
        groupAssignments.delete(key);
      }
    }

    const usedSlots = new Set<number>();
    for (const view of views) {
      const key = getStableBoxSlotKey(view.box);
      const assignedSlot = groupAssignments.get(key);
      if (typeof assignedSlot === "number" && assignedSlot >= 0 && assignedSlot < maxVisible) {
        slots[assignedSlot] = { index: assignedSlot, view, stickyEntry: null };
        usedSlots.add(assignedSlot);
      }
    }

    for (const view of views) {
      const key = getStableBoxSlotKey(view.box);
      if (groupAssignments.has(key)) {
        continue;
      }
      const slotIndex = findFirstAvailableTargetSlot(slots, usedSlots);
      if (slotIndex === null) {
        continue;
      }
      groupAssignments.set(key, slotIndex);
      slots[slotIndex] = { index: slotIndex, view, stickyEntry: null };
      usedSlots.add(slotIndex);
    }

    for (const entry of stickyEntries) {
      const key = getStableBoxSlotKey(entry.view.box);
      const assignedSlot = groupAssignments.get(key);
      if (
        typeof assignedSlot === "number" &&
        assignedSlot >= 0 &&
        assignedSlot < maxVisible &&
        !usedSlots.has(assignedSlot)
      ) {
        slots[assignedSlot] = { index: assignedSlot, view: null, stickyEntry: entry };
        usedSlots.add(assignedSlot);
        continue;
      }
      if (groupAssignments.has(key)) {
        continue;
      }
      const slotIndex = findFirstAvailableTargetSlot(slots, usedSlots);
      if (slotIndex === null) {
        continue;
      }
      groupAssignments.set(key, slotIndex);
      slots[slotIndex] = { index: slotIndex, view: null, stickyEntry: entry };
      usedSlots.add(slotIndex);
    }

    slotsByGroup.set(group, slots);
  }
  return slotsByGroup;
}

function findFirstAvailableTargetSlot(
  slots: BuffExpiryPrecisionTargetSlot[],
  usedSlots: Set<number>,
): number | null {
  for (const slot of slots) {
    if (!usedSlots.has(slot.index) && !slot.view && !slot.stickyEntry) {
      return slot.index;
    }
  }
  return null;
}
