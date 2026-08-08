import { ChevronRight, Trash2 } from "lucide-react";
import { m as motion, useReducedMotion } from "motion/react";
import type { SkillSnapshot } from "../../../alertTypes";
import { DEFAULT_REPEAT_ALERT_MAX_COUNT } from "../../../lib/repeatAlerts";
import {
  getSkillRegionForLayout,
  hasUsableRegion,
} from "../../../lib/regions";
import { getSkillBuffDurationTargetForSkill } from "../../../lib/skillBuffDuration/skillBuffDurationTargets";
import type { SkillConfig, SkillRuntimeState } from "../../../types";
import { MotionSwitch } from "../../../shared/components/MotionSwitch";
import { RepeatIntervalPicker } from "../../../shared/components/RepeatIntervalPicker";
import { FloatingTooltipButton } from "../../../shared/components/FloatingTooltip";
import {
  AnimatedNumber,
  SHOULD_RENDER_ANIMATED_NUMBER_TEXT,
} from "../../../shared/components/AnimatedNumber";
import { CompactMetricCell } from "../../../shared/components/CompactMetricCell";
import { SkillAlertEditorPanel } from "./SkillAlertEditorRow";
import { SkillCropCell } from "./SkillCropCell";
import { SkillThresholdCell } from "./SkillThresholdCell";
import { SkillTypeCell, getSkillTypeCellState } from "./SkillTypeCell";
import {
  formatReading,
  getRemainingCountUntilAlert,
  getSkillRowVisualState,
  getSkillStatusView,
  getTimeUntilAlertCountdownParts,
  getTimeUntilAlertSeconds,
  isInteractiveTarget,
  isToggleKey,
  stopRowClick,
} from "./skillDashboardUtils";

const FRACTIONAL_SECONDS_FORMAT = {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  useGrouping: false,
} as const;

export function SkillDashboardRow({
  skill,
  state,
  snapshot,
  now,
  selectedSkillId,
  isExpanded,
  hasStream,
  isGameViewportReady,
  canPickRegion,
  currentLayoutKey,
  showDebugColumns,
  isGloballyDisabled,
  isSubmittingMisread,
  onSelectSkill,
  onToggleExpandedSkill,
  onChangeSkill,
  onDeleteSkill,
  onOpenRegionPicker,
  onPreviewSound,
  onSubmitMisreadReport,
  showFloatingTooltip,
  hideFloatingTooltip,
}: {
  skill: SkillConfig;
  state: SkillRuntimeState;
  snapshot: SkillSnapshot | undefined;
  now: number;
  selectedSkillId: string;
  isExpanded: boolean;
  hasStream: boolean;
  isGameViewportReady: boolean;
  canPickRegion: boolean;
  currentLayoutKey: string | null;
  showDebugColumns: boolean;
  isGloballyDisabled: boolean;
  isSubmittingMisread: boolean;
  onSelectSkill: (id: string) => void;
  onToggleExpandedSkill: (id: string) => void;
  onChangeSkill: (skillId: string, patch: Partial<SkillConfig>) => void;
  onDeleteSkill: (id: string) => void;
  onOpenRegionPicker: (id: string) => void;
  onPreviewSound: (soundId: string, volume: number) => void;
  onSubmitMisreadReport: (id: string) => void;
  showFloatingTooltip: (id: string, text: string, target: HTMLElement) => void;
  hideFloatingTooltip: () => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const currentRegion = getSkillRegionForLayout(skill, currentLayoutKey);
  const visualState = getSkillRowVisualState(
    skill,
    state,
    snapshot,
    hasStream,
    currentLayoutKey,
    now,
    isGameViewportReady,
  );
  const isSelected = selectedSkillId === skill.id;
  const hasRegion = hasUsableRegion(currentRegion);
  const isBuffDurationDetection = Boolean(getSkillBuffDurationTargetForSkill(skill));
  const hasMisreadPayload =
    Boolean(snapshot?.rawPreviewUrl && snapshot.previewUrl) ||
    (hasStream && (hasRegion || isBuffDurationDetection));
  const statusView = getSkillStatusView(
    skill,
    state,
    hasStream,
    isGloballyDisabled,
    isGameViewportReady,
  );
  const isRemainingCountSkill = isBuffDurationDetection &&
    getSkillBuffDurationTargetForSkill(skill)?.valueKind === "remaining-count";
  const cropTooltipId =
    visualState.kind === "placeholder" && visualState.tooltip
      ? `crop-region-tooltip-${skill.id}`
      : undefined;
  const { presetId, shouldShowDuration, shouldShowErdaNotice } = getSkillTypeCellState(skill);
  const timeUntilAlertSeconds = getTimeUntilAlertSeconds(state, skill, now, isGloballyDisabled);
  const timeUntilAlertParts = getTimeUntilAlertCountdownParts(
    state,
    skill,
    now,
    isGloballyDisabled,
  );
  const remainingCountUntilAlert = getRemainingCountUntilAlert(
    state,
    skill,
    isGloballyDisabled,
  );
  const editorId = `skill-editor-${skill.id}`;

  const toggleSkill = () => {
    onSelectSkill(skill.id);
    onToggleExpandedSkill(skill.id);
  };

  const openMissingRegionPicker = () => {
    onSelectSkill(skill.id);
    if (!isExpanded) {
      onToggleExpandedSkill(skill.id);
    }
    if (canPickRegion) {
      onOpenRegionPicker(skill.id);
    }
  };

  return (
    <motion.div
      className={[
        "skill-row-group",
        !skill.enabled ? "is-disabled-row" : "",
        isSelected ? "selected-row" : "",
        isExpanded ? "expanded-row" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      layout
      role="rowgroup"
      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <div
        aria-controls={editorId}
        aria-expanded={isExpanded}
        className={[
          "dashboard-row",
          "skill-summary-row",
          isSelected ? "selected-row" : "",
          isExpanded ? "expanded-row" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={toggleSkill}
        onKeyDown={(event) => {
          if (!isToggleKey(event) || isInteractiveTarget(event.target)) {
            return;
          }

          event.preventDefault();
          toggleSkill();
        }}
        role="row"
        tabIndex={0}
      >
        <div className="skill-cell" role="cell">
          <MotionSwitch
            className="row-toggle"
            checked={skill.enabled}
            disabled={isGloballyDisabled}
            label={skill.enabled ? "켜짐" : "꺼짐"}
            onClick={stopRowClick}
            onChange={(checked) => onChangeSkill(skill.id, { enabled: checked })}
          />
        </div>
        <SkillCropCell
          visualState={visualState}
          hasRegion={hasRegion}
          canPickRegion={canPickRegion}
          cropTooltipId={cropTooltipId}
          onOpenMissingRegionPicker={openMissingRegionPicker}
          showFloatingTooltip={showFloatingTooltip}
          hideFloatingTooltip={hideFloatingTooltip}
        />
        <SkillTypeCell
          skill={skill}
          presetId={presetId}
          shouldShowDuration={shouldShowDuration}
          shouldShowErdaNotice={shouldShowErdaNotice}
          onChangeSkill={onChangeSkill}
        />
        <SkillThresholdCell skill={skill} onChangeSkill={onChangeSkill} />
        <div className="skill-cell" role="cell">
          <CompactMetricCell label="알림까지" className="skill-alert-until-metric">
            {isRemainingCountSkill ? (
              <RemainingCountUntilAlertValue count={remainingCountUntilAlert} />
            ) : (
              <AnimatedAlertCountdownValue
                fallbackSeconds={timeUntilAlertSeconds}
                parts={timeUntilAlertParts}
              />
            )}
          </CompactMetricCell>
        </div>
        <div className="skill-cell" role="cell">
          <div className="skill-repeat-control" onClick={stopRowClick}>
            <span className="skill-repeat-label">반복</span>
            <RepeatIntervalPicker
              value={skill.repeatAlertIntervalSeconds ?? 3}
              className="compact-repeat-picker"
              disabled={isGloballyDisabled}
              ariaLabel="반복 알림 간격"
              disabledOptionLabel="사용 안 함"
              isDisabledOptionSelected={skill.repeatAlertEnabled !== true}
              maxCount={skill.repeatAlertMaxCount ?? null}
              onChange={(seconds) =>
                onChangeSkill(skill.id, {
                  repeatAlertEnabled: true,
                  repeatAlertIntervalSeconds: seconds,
                  repeatAlertMaxCount:
                    skill.repeatAlertMaxCount ??
                    (skill.repeatAlertEnabled === true ? null : DEFAULT_REPEAT_ALERT_MAX_COUNT),
                })
              }
              onDisabledOptionSelect={() =>
                onChangeSkill(skill.id, {
                  repeatAlertEnabled: false,
                })
              }
              onMaxCountChange={(count) =>
                onChangeSkill(skill.id, {
                  repeatAlertEnabled: true,
                  repeatAlertIntervalSeconds: skill.repeatAlertIntervalSeconds ?? 3,
                  repeatAlertMaxCount: count,
                })
              }
            />
          </div>
        </div>
        {showDebugColumns && (
          <div className="skill-cell" role="cell">
            <CompactMetricCell label="인식" className="skill-reading-metric">
              <span className="compact-metric-plain-value">
                {formatReading(snapshot?.result, isRemainingCountSkill ? "remaining-count" : "seconds")}
              </span>
            </CompactMetricCell>
          </div>
        )}
        <div className="skill-cell" role="cell">
          <span className={`state-chip ${statusView.className}`}>{statusView.label}</span>
        </div>
        <div className="skill-cell row-actions-cell" role="cell">
          <div className="row-actions">
            <FloatingTooltipButton
              aria-expanded={isExpanded}
              aria-label={isExpanded ? "설정 접기" : "설정 펼치기"}
              className="icon-button small expand-toggle-button"
              type="button"
              tooltip={isExpanded ? "설정 접기" : "설정 펼치기"}
              tooltipId={`skill-${skill.id}-expand-tooltip`}
              onClick={(event) => {
                event.stopPropagation();
                toggleSkill();
              }}
            >
              <ChevronRight size={17} />
            </FloatingTooltipButton>
            <FloatingTooltipButton
              aria-label="삭제"
              className="icon-button small danger row-delete-button"
              type="button"
              tooltip="삭제"
              tooltipId={`skill-${skill.id}-delete-tooltip`}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteSkill(skill.id);
              }}
            >
              <Trash2 size={16} />
            </FloatingTooltipButton>
          </div>
        </div>
      </div>
      <div className="skill-row-details">
        <SkillAlertEditorPanel
          editorId={editorId}
          skill={skill}
          confidence={snapshot?.result.confidence ?? state.confidence}
          isExpanded={isExpanded}
          showDebugColumns={showDebugColumns}
          isGloballyDisabled={isGloballyDisabled}
          canPickRegion={canPickRegion}
          onChangeSkill={onChangeSkill}
          onOpenRegionPicker={onOpenRegionPicker}
          onPreviewSound={onPreviewSound}
          hasMisreadPayload={hasMisreadPayload}
          isSubmittingMisread={isSubmittingMisread}
          onSubmitMisreadReport={onSubmitMisreadReport}
        />
      </div>
    </motion.div>
  );
}

function RemainingCountUntilAlertValue({ count }: { count: number | null }) {
  if (count === null) {
    return <>--</>;
  }

  if (SHOULD_RENDER_ANIMATED_NUMBER_TEXT) {
    return <>{count}회</>;
  }

  return (
    <span className="animated-inline-number animated-count-value">
      <AnimatedNumber
        className="animated-inline-number-flow"
        value={count}
      />
      <span>회</span>
    </span>
  );
}

function AnimatedAlertCountdownValue({
  fallbackSeconds,
  parts,
}: {
  fallbackSeconds: number | null;
  parts: ReturnType<typeof getTimeUntilAlertCountdownParts>;
}) {
  if (parts?.hasInitialDelay) {
    const shouldShowDelay = parts.delaySeconds > 0;

    return (
      <span className="skill-alert-countdown-with-delay">
        <AnimatedSecondsValue seconds={parts.baseSeconds} />
        {shouldShowDelay && (
          <>
            <span className="skill-alert-countdown-delay-separator">+</span>
            <DelaySecondsBadge seconds={parts.delaySeconds} />
          </>
        )}
      </span>
    );
  }

  return <AnimatedSecondsValue seconds={fallbackSeconds} />;
}

function formatSecondsText(seconds: number): string {
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

function DelaySecondsBadge({ seconds }: { seconds: number }) {
  const formattedSeconds = formatSecondsText(seconds);

  return (
    <span
      key={formattedSeconds}
      className="skill-alert-countdown-delay-value"
    >
      {formattedSeconds}초
    </span>
  );
}

function AnimatedSecondsValue({ seconds }: { seconds: number | null }) {
  if (seconds === null) {
    return <>--</>;
  }

  const isIntegerSeconds = Number.isInteger(seconds);
  const formattedSeconds = formatSecondsText(seconds);

  if (SHOULD_RENDER_ANIMATED_NUMBER_TEXT) {
    return <>{formattedSeconds}초</>;
  }

  return (
    <span className="animated-inline-number animated-seconds-value">
      <AnimatedNumber
        className="animated-inline-number-flow"
        value={seconds}
        format={isIntegerSeconds ? undefined : FRACTIONAL_SECONDS_FORMAT}
      />
      <span>초</span>
    </span>
  );
}
