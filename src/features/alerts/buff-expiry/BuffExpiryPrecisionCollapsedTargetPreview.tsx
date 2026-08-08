import { type ReactNode, useRef } from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import type { BuffExpirySnapshot } from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryPrecisionTargetGroup } from "../../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";
import { getBuffExpiryPrecisionSelectedTargetGroupSet } from "../../../domain/buff-expiry/precisionTrackingPolicy";
import type { BuffExpiryAlertConfig } from "../../../types";
import {
  BUFF_EXPIRY_PRECISION_COLLAPSED_TARGET_SLOT_COUNT,
  BUFF_EXPIRY_PRECISION_TARGET_GROUPS,
  getBuffExpiryPrecisionAllBoxViews,
  getBuffExpiryPrecisionTargetBoxViews,
  getBuffExpiryPrecisionTargetSlotState,
  getStableBoxSlotKey,
  type BuffExpiryPrecisionStickyTargetEntry,
} from "./buffExpiryPrecisionTargetSlots";
import { BuffExpiryDetectedBoxCard } from "./BuffExpiryDetectedBoxCard";
import { BuffExpiryStickyTargetCard } from "./BuffExpiryPrecisionTargetBoard";

export function BuffExpiryPrecisionCollapsedTargetPreview({
  snapshot,
  config,
  fallback,
}: {
  snapshot: BuffExpirySnapshot | null;
  config: BuffExpiryAlertConfig;
  fallback: ReactNode;
}) {
  const reduceMotion = Boolean(useReducedMotion());
  const slotAssignmentsRef = useRef(new Map<BuffExpiryPrecisionTargetGroup, Map<string, number>>());
  const stickyTargetEntriesRef = useRef(new Map<BuffExpiryPrecisionTargetGroup, BuffExpiryPrecisionStickyTargetEntry[]>());
  const allViews = getBuffExpiryPrecisionAllBoxViews(snapshot);
  const selectedGroups = getBuffExpiryPrecisionSelectedTargetGroupSet(config);
  const targetViews = getBuffExpiryPrecisionTargetBoxViews(snapshot, allViews, selectedGroups);
  const { slotsByGroup, visibleTargetCount } = getBuffExpiryPrecisionTargetSlotState(
    snapshot,
    targetViews,
    selectedGroups,
    slotAssignmentsRef.current,
    stickyTargetEntriesRef.current,
  );

  if (visibleTargetCount === 0) {
    return <>{fallback}</>;
  }

  const compactSlots = BUFF_EXPIRY_PRECISION_TARGET_GROUPS.flatMap((group) =>
    (slotsByGroup.get(group) ?? [])
      .filter((slot) => slot.view || slot.stickyEntry)
      .map((slot) => ({ ...slot, group })),
  ).slice(0, BUFF_EXPIRY_PRECISION_COLLAPSED_TARGET_SLOT_COUNT);
  const previewSlots = Array.from(
    { length: BUFF_EXPIRY_PRECISION_COLLAPSED_TARGET_SLOT_COUNT },
    (_, index) => compactSlots[index] ?? null,
  );

  return (
    <div
      className="buff-expiry-precision-collapsed-target-preview"
      aria-label={`알림 대상 후보 ${visibleTargetCount}개`}
    >
      {previewSlots.map((slot, index) => (
        <div
          className="buff-expiry-precision-collapsed-target-slot"
          data-group={slot?.group ?? "empty"}
          data-slot-index={index}
          key={slot ? `${slot.group}:${slot.index}:${index}` : `empty:${index}`}
        >
          <AnimatePresence initial={false}>
            {slot?.view ? (
              <BuffExpiryDetectedBoxCard
                key={`${getStableBoxSlotKey(slot.view.box)}:${slot.view.nextObservation?.identity.kind ?? "unknown"}`}
                snapshot={snapshot}
                view={slot.view}
                reduceMotion={reduceMotion}
                layoutMotion={false}
              />
            ) : slot?.stickyEntry ? (
              <BuffExpiryStickyTargetCard
                key={`sticky:${slot.stickyEntry.id}`}
                entry={slot.stickyEntry}
                reduceMotion={reduceMotion}
              />
            ) : null}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}
