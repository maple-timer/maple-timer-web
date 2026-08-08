import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import type { FeedbackKind } from "../../../contracts/reporting/feedback";
import { KIND_LABELS } from "../feedbackPayload";

const FEEDBACK_KIND_OPTIONS = Object.entries(KIND_LABELS) as Array<[FeedbackKind, string]>;

export function FeedbackKindPicker({
  value,
  onChange,
}: {
  value: FeedbackKind;
  onChange: (kind: FeedbackKind) => void;
}) {
  return (
    <SegmentedControl
      className="feedback-kind-picker"
      label="피드백 유형"
      layout="fill"
      value={value}
      onChange={(nextValue) => onChange(nextValue as FeedbackKind)}
    >
      {FEEDBACK_KIND_OPTIONS.map(([kind, label]) => (
        <SegmentedControlItem key={kind} value={kind} label={label} />
      ))}
    </SegmentedControl>
  );
}
