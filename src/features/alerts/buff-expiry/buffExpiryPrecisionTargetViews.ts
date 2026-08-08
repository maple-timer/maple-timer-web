import type { BuffExpirySnapshot } from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryPrecisionTargetGroup } from "../../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";
import { isBuffExpiryPrecisionViewSuppressedByActiveAlert } from "./buffExpiryPrecisionTargetSuppression";
import {
  getBuffExpiryPrecisionViewGroup,
  getStableBoxSlotKey,
  type BuffExpiryDetectedBoxView,
} from "./buffExpiryPrecisionTargetViewModel";

export function getBuffExpiryPrecisionTargetBoxViews(
  snapshot: BuffExpirySnapshot | null,
  allViews: BuffExpiryDetectedBoxView[],
  selectedGroups?: Set<BuffExpiryPrecisionTargetGroup>,
): BuffExpiryDetectedBoxView[] {
  const stableKeys = new Set((snapshot?.displayBoxes ?? []).map(getStableBoxSlotKey));
  return allViews.filter((view) => {
    const group = getBuffExpiryPrecisionViewGroup(view);
    return (
      group !== null &&
      (!selectedGroups || selectedGroups.has(group)) &&
      (stableKeys.size === 0 ? false : stableKeys.has(getStableBoxSlotKey(view.box))) &&
      !isBuffExpiryPrecisionViewSuppressedByActiveAlert(snapshot, view)
    );
  });
}
