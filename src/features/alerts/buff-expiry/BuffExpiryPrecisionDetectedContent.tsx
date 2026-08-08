import { m as motion } from "motion/react";
import type { BuffExpirySnapshot } from "../../../lib/buffExpiry/buffExpiryTypes";
import { getBuffExpiryPrecisionSelectedTargetGroupSet } from "../../../domain/buff-expiry/precisionTrackingPolicy";
import type { BuffExpiryAlertConfig } from "../../../types";
import {
  getBuffExpiryPrecisionAllBoxViews,
  getBuffExpiryPrecisionTargetBoxViews,
} from "./buffExpiryPrecisionTargetSlots";
import { getBuffExpiryPrecisionPanelMotion } from "./BuffExpiryPrecisionDetectedMotion";
import { BuffExpiryPrecisionDetectedGroup } from "./BuffExpiryPrecisionDetectedGroup";
import { BuffExpiryPrecisionRecentAlertBoard } from "./BuffExpiryPrecisionRecentAlertBoard";
import { BuffExpiryPrecisionTargetBoard } from "./BuffExpiryPrecisionTargetBoard";

export { BuffExpiryPrecisionCollapsedTargetPreview } from "./BuffExpiryPrecisionCollapsedTargetPreview";

export function BuffExpiryPrecisionDetectedContent({
  snapshot,
  config,
  isExpanded,
  reduceMotion,
}: {
  snapshot: BuffExpirySnapshot | null;
  config: BuffExpiryAlertConfig;
  isExpanded: boolean;
  reduceMotion: boolean;
}) {
  const allViews = getBuffExpiryPrecisionAllBoxViews(snapshot);
  const selectedGroups = getBuffExpiryPrecisionSelectedTargetGroupSet(config);
  const targetViews = getBuffExpiryPrecisionTargetBoxViews(snapshot, allViews, selectedGroups);
  const sampledAt = snapshot?.sampledAt ?? Date.now();
  return (
    <div className="buff-expiry-precision-detected-content">
      <motion.div
        className="buff-expiry-precision-motion-panel"
        {...getBuffExpiryPrecisionPanelMotion(0, "left", reduceMotion, isExpanded)}
      >
        <BuffExpiryPrecisionTargetBoard
          snapshot={snapshot}
          views={targetViews}
          selectedGroups={selectedGroups}
          reduceMotion={reduceMotion}
        />
      </motion.div>
      <motion.div
        className="buff-expiry-precision-motion-panel"
        {...getBuffExpiryPrecisionPanelMotion(1, "left", reduceMotion, isExpanded)}
      >
        <BuffExpiryPrecisionRecentAlertBoard
          evidence={snapshot?.lastAlertEvidence ?? null}
          now={sampledAt}
          reduceMotion={reduceMotion}
        />
      </motion.div>
      <motion.div
        className="buff-expiry-precision-motion-panel"
        {...getBuffExpiryPrecisionPanelMotion(2, "right", reduceMotion, isExpanded)}
      >
        <BuffExpiryPrecisionDetectedGroup
          title="전체 버프"
          count={allViews.length}
          emptyLabel="감지한 버프칸이 없습니다."
          snapshot={snapshot}
          views={allViews}
          reduceMotion={reduceMotion}
        />
      </motion.div>
    </div>
  );
}
