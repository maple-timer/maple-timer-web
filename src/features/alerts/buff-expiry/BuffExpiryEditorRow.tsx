import { m as motion, useReducedMotion } from "motion/react";
import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import { getBuffExpiryAlertSounds } from "../../../lib/sounds";
import { trackBuffExpiryTargetGroupChanged } from "../../../lib/analyticsEvents";
import {
  getBuffExpiryPrecisionSelectedTargetGroups,
} from "../../../domain/buff-expiry/precisionTrackingPolicy";
import type { BuffExpiryAlertConfig } from "../../../types";
import { isAlertIssueReportButtonDisabled } from "../../../application/reporting/alertIssueReportAvailability";
import {
  InfoTooltip,
  TooltipHelpContent,
} from "../../../shared/components/FloatingTooltip";
import { AlertEditorRow } from "../../../shared/components/AlertEditorRow";
import { BuffExpiryDebugContent } from "./BuffExpiryDebugContent";
import {
  BuffExpiryPrecisionDetectedContent,
} from "./BuffExpiryPrecisionDetectedContent";
import { getBuffExpiryPrecisionPanelMotion } from "./BuffExpiryPrecisionDetectedMotion";
import {
  BUFF_EXPIRY_PRECISION_GROUP_LABELS,
  BUFF_EXPIRY_PRECISION_TARGET_GROUPS,
} from "./buffExpiryPrecisionTargetConfig";

export { BuffExpiryPrecisionCollapsedTargetPreview } from "./BuffExpiryPrecisionDetectedContent";

export function BuffExpiryEditorRow({
  editorId,
  isExpanded,
  config,
  state,
  snapshot,
  showDebug,
  hasIssueReportPayload,
  isGloballyDisabled,
  isSubmittingIssueReport,
  onChange,
  onPreviewSound,
  onSubmitIssueReport,
}: {
  editorId: string;
  isExpanded: boolean;
  config: BuffExpiryAlertConfig;
  state: BuffExpiryRuntimeState;
  snapshot: BuffExpirySnapshot | null;
  showDebug: boolean;
  hasIssueReportPayload: boolean;
  isGloballyDisabled: boolean;
  isSubmittingIssueReport: boolean;
  onChange: (patch: Partial<BuffExpiryAlertConfig>) => void;
  onPreviewSound: (soundId: string, volume: number) => void;
  onSubmitIssueReport: () => void;
}) {
  return (
    <AlertEditorRow
      isExpanded={isExpanded}
      colSpan={8}
      editorId={editorId}
      rowClassName="inline-editor-row buff-expiry-editor-row"
      editorClassName="inline-skill-editor buff-expiry-inline-editor"
      editorLayout="command-rail"
      soundId={config.soundId}
      soundLabel="알림음"
      sounds={getBuffExpiryAlertSounds()}
      volume={config.volume}
      volumeWarningKey="buff-expiry"
      reportLabel="감지 제보"
      reportButtonClassName="hunt-issue-report-button"
      reportDisabled={isAlertIssueReportButtonDisabled({
        featureEnabled: config.enabled,
        isGloballyDisabled,
        hasReportPayload: hasIssueReportPayload,
      })}
      isSubmittingReport={isSubmittingIssueReport}
      onSoundChange={(soundId) => onChange({ soundId })}
      onVolumeChange={(volume) => onChange({ volume })}
      onPreviewSound={(volumeOverride) => onPreviewSound(config.soundId, volumeOverride ?? config.volume)}
      onSubmitReport={onSubmitIssueReport}
      debugContent={
        <BuffExpiryDetailPanel
          config={config}
          state={state}
          snapshot={snapshot}
          isExpanded={isExpanded}
          showDebug={showDebug}
          onChange={onChange}
        />
      }
    />
  );
}

function BuffExpiryDetailPanel({
  config,
  state,
  snapshot,
  isExpanded,
  showDebug,
  onChange,
}: {
  config: BuffExpiryAlertConfig;
  state: BuffExpiryRuntimeState;
  snapshot: BuffExpirySnapshot | null;
  isExpanded: boolean;
  showDebug: boolean;
  onChange: (patch: Partial<BuffExpiryAlertConfig>) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const reduceMotion = Boolean(shouldReduceMotion);

  return (
    <div className="buff-expiry-detail-panel" onClick={(event) => event.stopPropagation()}>
      <div className="buff-expiry-detected-section">
        <BuffExpiryPrecisionTargetGroupSelector
          config={config}
          isExpanded={isExpanded}
          reduceMotion={reduceMotion}
          onChange={onChange}
        />
        <BuffExpiryPrecisionDetectedContent
          snapshot={snapshot}
          config={config}
          isExpanded={isExpanded}
          reduceMotion={reduceMotion}
        />
      </div>

      {showDebug && <BuffExpiryDebugContent state={state} snapshot={snapshot} />}
    </div>
  );
}

function BuffExpiryPrecisionTargetGroupSelector({
  config,
  isExpanded,
  reduceMotion,
  onChange,
}: {
  config: BuffExpiryAlertConfig;
  isExpanded: boolean;
  reduceMotion: boolean;
  onChange: (patch: Partial<BuffExpiryAlertConfig>) => void;
}) {
  const selectedGroups = getBuffExpiryPrecisionSelectedTargetGroups(config);
  const selectedGroupSet = new Set(selectedGroups);

  return (
    <motion.section
      className="buff-expiry-target-group-selector"
      aria-label="버프 종료 알림 대상 그룹"
      {...getBuffExpiryPrecisionPanelMotion(0, "left", reduceMotion, isExpanded)}
    >
      <div className="buff-expiry-target-group-heading">
        <div className="buff-expiry-target-group-title">
          <strong>알림 대상 그룹</strong>
          <InfoTooltip
            id="buff-expiry-target-group-selector-tooltip"
            label="알림 대상 그룹 안내"
            className="buff-expiry-precision-target-info-button"
            iconSize={14}
            content={
              <TooltipHelpContent
                title="선택한 그룹만 알림 대상으로 추적합니다."
                items={[
                  "꺼둔 그룹은 감지되어도 알림이 울리지 않습니다.",
                ]}
              />
            }
            width={390}
            fitContent
          />
        </div>
        <span>{selectedGroups.length}개 사용</span>
      </div>
      <div className="buff-expiry-target-group-options">
        {BUFF_EXPIRY_PRECISION_TARGET_GROUPS.map((group) => {
          const isSelected = selectedGroupSet.has(group);
          const isLastSelected = isSelected && selectedGroups.length <= 1;
          return (
            <button
              key={group}
              type="button"
              className={[
                "buff-expiry-target-group-option",
                isSelected ? "is-selected" : "is-muted",
              ].join(" ")}
              aria-pressed={isSelected}
              aria-label={
                isLastSelected
                  ? `${BUFF_EXPIRY_PRECISION_GROUP_LABELS[group]} 알림 대상 사용 중, 최소 한 그룹은 켜져 있어야 합니다.`
                  : `${BUFF_EXPIRY_PRECISION_GROUP_LABELS[group]} 알림 대상 ${isSelected ? "사용 중" : "제외됨"}`
              }
              onClick={() => {
                const nextGroups = isSelected
                  ? selectedGroups.filter((item) => item !== group)
                  : [...selectedGroups, group];
                if (!nextGroups.length) {
                  return;
                }
                trackBuffExpiryTargetGroupChanged(group, !isSelected, nextGroups.length);
                onChange({ selectedPrecisionTargetGroups: nextGroups });
              }}
            >
              <span aria-hidden="true" />
              {BUFF_EXPIRY_PRECISION_GROUP_LABELS[group]}
            </button>
          );
        })}
      </div>
    </motion.section>
  );
}
