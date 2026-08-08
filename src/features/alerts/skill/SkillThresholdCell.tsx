import {
  ALERT_THRESHOLD_MAX_SECONDS,
  formatAlertThresholdSeconds,
  getAlertThresholdMinSeconds,
} from "../../../lib/timer";
import {
  isRemainingCountSkillPresetId,
  REMAINING_COUNT_ALERT_THRESHOLD_MAX,
  REMAINING_COUNT_ALERT_THRESHOLD_MIN,
  clampRemainingCountAlertThreshold,
} from "../../../lib/skillPresets";
import type { SkillConfig } from "../../../types";
import { CompactAlertThresholdEditor } from "../shared/CompactAlertThresholdEditor";

export function SkillThresholdCell({
  skill,
  onChangeSkill,
}: {
  skill: SkillConfig;
  onChangeSkill: (skillId: string, patch: Partial<SkillConfig>) => void;
}) {
  const isRemainingCountSkill = isRemainingCountSkillPresetId(skill.presetId);
  const minSeconds = getAlertThresholdMinSeconds(skill);
  if (isRemainingCountSkill) {
    return (
      <div className="skill-cell threshold-cell" role="cell">
        <CompactAlertThresholdEditor
          ariaLabel="스킬 알림 회수"
          label="알림 시점"
          min={REMAINING_COUNT_ALERT_THRESHOLD_MIN}
          max={REMAINING_COUNT_ALERT_THRESHOLD_MAX}
          rangeHint={`${REMAINING_COUNT_ALERT_THRESHOLD_MIN}-${REMAINING_COUNT_ALERT_THRESHOLD_MAX}회`}
          suffix="회 남음"
          value={skill.alertThresholdSeconds}
          formatDisplayValue={formatRemainingCountAlertThreshold}
          onCommit={(value) =>
            onChangeSkill(skill.id, {
              alertThresholdSeconds: clampRemainingCountAlertThreshold(value),
            })
          }
        />
      </div>
    );
  }

  return (
    <div className="skill-cell threshold-cell" role="cell">
      <CompactAlertThresholdEditor
        ariaLabel="스킬 알림 시점"
        label="알림 시점"
        min={minSeconds}
        max={ALERT_THRESHOLD_MAX_SECONDS}
        rangeHint={`${minSeconds}-${ALERT_THRESHOLD_MAX_SECONDS}초`}
        suffix="초 전"
        value={skill.alertThresholdSeconds}
        formatDisplayValue={formatAlertThresholdSeconds}
        onCommit={(value) =>
          onChangeSkill(skill.id, {
            alertThresholdSeconds: value,
          })
        }
      />
    </div>
  );
}

function formatRemainingCountAlertThreshold(value: number): {
  value: number;
  suffix: string;
  label: string;
} {
  const rounded = clampRemainingCountAlertThreshold(value);
  return {
    value: rounded,
    suffix: "회 남음",
    label: `${rounded}회 남음`,
  };
}
