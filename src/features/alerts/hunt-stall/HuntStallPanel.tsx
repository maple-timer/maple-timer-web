import { Activity, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import type {
  HuntStallRuntimeState,
  HuntStallSnapshot,
} from "../../../alertTypes";
import { useExpandableRowController } from "../shared/useExpandableRowController";
import type { HuntStallAlertConfig } from "../../../types";
import { AlertChecklistBadge } from "../../../shared/components/AlertChecklistBadge";
import {
  FloatingTooltipButton,
  InfoTooltip,
  TooltipHelpContent,
} from "../../../shared/components/FloatingTooltip";
import { MotionSwitch } from "../../../shared/components/MotionSwitch";
import { MotionSegmentedControl } from "../../../shared/components/MotionSegmentedControl";
import { MotionCollapse } from "../../../shared/components/MotionCollapse";
import { RepeatIntervalPicker } from "../../../shared/components/RepeatIntervalPicker";
import { ImageDataCanvas } from "../../../shared/components/ImageDataCanvas";
import { DEFAULT_REPEAT_ALERT_MAX_COUNT } from "../../../lib/repeatAlerts";
import { CompactAlertThresholdEditor } from "../shared/CompactAlertThresholdEditor";
import { AnimatedMetricText, CompactMetricCell, RelativeSecondsMetric } from "../../../shared/components/CompactMetricCell";
import { PanelStatusIndicator } from "../../../shared/components/PanelStatusIndicator";
import { HuntStallEditorRow } from "./HuntStallEditorRow";
import { getHuntStallPanelViewModel } from "./huntStallPanelViewModel";
import {
  isHuntStallInteractiveTarget,
  isHuntStallToggleKey,
  stopHuntStallRowClick,
} from "./huntStallUtils";
import {
  HUNT_STALL_EXTENDED_UI_GUIDE,
  HUNT_STALL_SOL_HECATE_GUIDE,
  HUNT_STALL_UI_SIZE_GUIDE,
  HUNT_STALL_UI_SIZE_IMAGE_ALT,
  HUNT_STALL_UI_SIZE_IMAGE_SRC,
} from "./huntStallChecklist";

function formatNoChangeThresholdSeconds(seconds: number) {
  return {
    value: seconds,
    suffix: "초 무변동",
    label: `${seconds}초 무변동`,
  };
}

export function HuntStallPanel({
  config,
  state,
  snapshot,
  hasStream,
  isGameViewportReady = true,
  canPickRegion,
  currentLayoutKey,
  showDebug,
  isGloballyDisabled = false,
  onChange,
  onOpenRegionPicker,
  onPreviewSound,
  onSubmitDebugSample,
  onSubmitIssueReport,
  isSubmittingDebugSample,
  isSubmittingIssueReport,
  embedded = false,
  headerAction,
  isSectionCollapsed = false,
}: {
  config: HuntStallAlertConfig;
  state: HuntStallRuntimeState;
  snapshot: HuntStallSnapshot | null;
  hasStream: boolean;
  isGameViewportReady?: boolean;
  canPickRegion: boolean;
  currentLayoutKey: string | null;
  showDebug: boolean;
  isGloballyDisabled?: boolean;
  onChange: (patch: Partial<HuntStallAlertConfig>) => void;
  onOpenRegionPicker: () => void;
  onResetDetection: () => void;
  onPreviewSound: (soundId: string, volume: number) => void;
  onSubmitDebugSample: () => void;
  onSubmitIssueReport: () => void;
  isSubmittingDebugSample: boolean;
  isSubmittingIssueReport: boolean;
  embedded?: boolean;
  headerAction?: ReactNode;
  isSectionCollapsed?: boolean;
}) {
  const { isExpanded, toggleExpanded } = useExpandableRowController();
  const [displayNow, setDisplayNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setDisplayNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, []);

  const {
    mode,
    isCooldownPresenceMode,
    isManualExperienceMode,
    usesManualCrop,
    statusView,
    hasCurrentCooldownRegion,
    hasCurrentManualExperienceRegion,
    cooldownCropLabel,
    manualExperienceCropLabel,
    cropLabel,
    thresholdValue,
    thresholdAriaLabel,
    thresholdRangeHint,
    thresholdMin,
    thresholdMax,
    editorColSpan,
    lastActivityLabel,
    lastActivityAt,
    lastActivityNow,
    cooldownValueLabel,
    cooldownPreviewUrl,
    cooldownPreviewImageData,
    manualExperiencePreviewUrl,
    manualExperiencePreviewImageData,
    cooldownStatusDetail,
    manualExperienceStatusDetail,
  } = getHuntStallPanelViewModel({
    config,
    state,
    snapshot,
    hasStream,
    isGameViewportReady,
    currentLayoutKey,
    now: displayNow,
  });
  const editorId = "hunt-stall-alert-editor";
  const canUseCooldownCropPicker = config.enabled && canPickRegion && !isGloballyDisabled;
  const canUseManualExperiencePicker = config.enabled && canPickRegion && !isGloballyDisabled;
  const canShowCooldownRegionAction =
    isCooldownPresenceMode && !hasCurrentCooldownRegion && canUseCooldownCropPicker;
  const shouldShowCooldownNoStreamCropText = !hasStream;
  const isHuntStallPanelActive =
    config.enabled && hasStream && isGameViewportReady && !isGloballyDisabled;
  const hasManualExperiencePreview = Boolean(
    manualExperiencePreviewImageData || manualExperiencePreviewUrl,
  );
  const canShowManualExperienceRegionAction =
    isManualExperienceMode && !hasCurrentManualExperienceRegion && canUseManualExperiencePicker;
  const manualExperienceRegionActionLabel =
    !isGameViewportReady
      ? "게임 화면 확인"
      : manualExperienceCropLabel === "다시 선택 필요"
      ? "경험치바 높이 다시 선택"
      : "경험치바 높이 선택";
  const showsRepeatColumn = isManualExperienceMode;
  const showsLastAlertColumn = isManualExperienceMode;
  const changeMode = (nextMode: HuntStallAlertConfig["mode"]) => {
    if (nextMode === mode) {
      return;
    }
    onChange({ mode: nextMode });
  };

  return (
    <section
      className={embedded ? "hunt-stall-panel embedded-hunt-stall-panel" : "hunt-stall-panel"}
    >
      <div className="panel-heading hunt-stall-heading">
        <div>
          <div className="rune-title-row">
            <div className="hunt-title-main">
              <PanelStatusIndicator
                isActive={isHuntStallPanelActive}
                isEnabled={config.enabled}
                label="사냥 멈춤 알림"
              />
              <h2>사냥 멈춤 알림</h2>
              <MotionSegmentedControl
                ariaLabel="사냥 멈춤 감시 방식"
                className="hunt-mode-toggle"
                optionClassName="hunt-mode-option"
                value={mode}
                onChange={changeMode}
                options={[
                  {
                    value: "manual-experience",
                    label: "경험치 인식",
                    disabled: isGloballyDisabled,
                  },
                  {
                    value: "cooldown-presence",
                    label: "쿨타임 인식",
                    disabled: isGloballyDisabled,
                  },
                ]}
              />
              <InfoTooltip
                id="hunt-stall-tooltip"
                label="사냥 멈춤 알림 안내"
                displayLabel="사용 안내"
                className="capture-info-button named-info-tooltip"
                content={
                  isCooldownPresenceMode ? (
                    <TooltipHelpContent
                      title="선택한 쿨타임 아이콘의 숫자와 화면 변화를 감시합니다."
                      items={[
                        "쿨타임 숫자가 계속 바뀌는 짧은 쿨타임 스킬에 사용합니다.",
                        "선택한 Crop에서 쿨타임 숫자를 먼저 안정적으로 확인합니다.",
                        "숫자와 Crop 화면 변화가 모두 멈추면 사냥이 멈춘 것으로 판단합니다.",
                        "노란색 계열 아이콘이나 숫자와 배경의 대비가 낮은 스킬은 감지가 불안정할 수 있습니다.",
                      ]}
                    />
                  ) : isManualExperienceMode ? (
                    <TooltipHelpContent
                      title="직접 선택한 경험치바 높이에서 경험치 변화를 감시합니다."
                      items={[
                        "화면 중하단에서 경험치바 윗선을 한 번 클릭해 높이를 지정합니다.",
                        "정확한 경험치 숫자보다 전처리된 숫자 영역의 모양이 바뀌었는지를 우선 봅니다.",
                        "경험치 변화가 설정 시간 동안 없으면 사냥이 멈춘 것으로 보고 알림을 울립니다.",
                        "해상도나 UI 위치를 바꾸면 영역을 다시 선택해 주세요.",
                      ]}
                    />
                  ) : null
                }
                width={460}
              />
            </div>
            <AlertChecklistBadge
              id="hunt-stall-checklist"
              label="사냥 멈춤 알림 체크리스트"
              title="사냥 멈춤 알림 전 확인해주세요."
              items={[
                HUNT_STALL_EXTENDED_UI_GUIDE,
                HUNT_STALL_SOL_HECATE_GUIDE,
                <>
                  {HUNT_STALL_UI_SIZE_GUIDE}
                  <img
                    className="alert-checklist-image"
                    src={HUNT_STALL_UI_SIZE_IMAGE_SRC}
                    alt={HUNT_STALL_UI_SIZE_IMAGE_ALT}
                  />
                </>,
              ]}
              width={370}
            />
          </div>
        </div>
        {headerAction}
      </div>

      <MotionCollapse
        className="alert-section-body"
        isCollapsed={isSectionCollapsed}
        aria-hidden={isSectionCollapsed}
      >
        <div className="hunt-stall-table-wrap">
        <table
          className={[
            "hunt-stall-table",
            isCooldownPresenceMode ? "cooldown-presence-mode" : "",
            isManualExperienceMode ? "manual-experience-mode" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <colgroup>
            <col className="col-hunt-enabled" />
            {usesManualCrop && <col className="col-hunt-crop" />}
            {isCooldownPresenceMode && <col className="col-hunt-detail" />}
            {isCooldownPresenceMode && <col className="col-hunt-reading" />}
            {isManualExperienceMode ? (
              <>
                <col className="col-hunt-last-change" />
                <col className="col-hunt-threshold" />
                {showsRepeatColumn && <col className="col-hunt-repeat" />}
                {showsLastAlertColumn && <col className="col-hunt-last-alert" />}
              </>
            ) : (
              <>
                <col className="col-hunt-threshold" />
                <col className="col-hunt-last-change" />
              </>
            )}
            <col className="col-hunt-status" />
            <col className="col-hunt-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>활성</th>
              {usesManualCrop && (
                <th>{isManualExperienceMode ? "상태 설명" : "Crop"}</th>
              )}
              {isCooldownPresenceMode && <th>상태 설명</th>}
              {isCooldownPresenceMode && <th>판독값</th>}
              {isManualExperienceMode ? (
                <>
                  <th>{lastActivityLabel}</th>
                  <th>멈춤 기준</th>
                  {showsRepeatColumn && <th>반복</th>}
                  {showsLastAlertColumn && <th>마지막 알림</th>}
                </>
              ) : (
                <>
                  <th>
                    {isCooldownPresenceMode ? (
                      <span className="column-help-label">
                        멈춤 기준
                        <InfoTooltip
                          id="hunt-stall-cooldown-threshold-tooltip"
                          label="쿨타임 변화 없음 기준 안내"
                          displayLabel="판정 기준"
                          className="column-info-button named-info-tooltip"
                          iconSize={14}
                          content={
                            <TooltipHelpContent
                              title="숫자와 화면 변화가 모두 멈춘 시간이 멈춤 기준입니다."
                              items={[
                                "선택한 Crop에서 쿨타임 숫자를 먼저 안정적으로 확인합니다.",
                                "이후 숫자가 바뀌거나 Crop 화면에 변화가 있으면 정상 활동으로 봅니다.",
                                "숫자와 화면 변화가 모두 멈춘 시간이 멈춤 기준 이상 이어지면 알림을 울립니다.",
                                "한 번 알림이 울리면 자동 반복하지 않으며, 다시 감시하려면 초기화해 주세요.",
                              ]}
                            />
                          }
                          width={460}
                        />
                      </span>
                    ) : (
                      "멈춤 기준"
                    )}
                  </th>
                  <th>{lastActivityLabel}</th>
                </>
              )}
              <th>상태</th>
              <th aria-label="사냥 멈춤 알림 조작" />
            </tr>
          </thead>
          <tbody>
            <Fragment>
              <tr
                aria-controls={editorId}
                aria-expanded={isExpanded}
                className={[
                  "dashboard-row",
                  "hunt-stall-row",
                  !config.enabled ? "is-disabled-row" : "",
                  isExpanded ? "expanded-row" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={toggleExpanded}
                onKeyDown={(event) => {
                  if (!isHuntStallToggleKey(event) || isHuntStallInteractiveTarget(event.target)) {
                    return;
                  }
                  event.preventDefault();
                  toggleExpanded();
                }}
                role="button"
                tabIndex={0}
              >
                <td>
                  <MotionSwitch
                    className="row-toggle hunt-row-toggle"
                    checked={config.enabled}
                    disabled={isGloballyDisabled}
                    label={config.enabled ? "켜짐" : "꺼짐"}
                    onClick={stopHuntStallRowClick}
                    onChange={(checked) => onChange({ enabled: checked })}
                  />
                </td>
                {usesManualCrop && (
                  <td>
                    <div
                      className={[
                        "hunt-crop-preview",
                        isManualExperienceMode ? "manual-experience-crop-preview" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {isManualExperienceMode ? (
                        <CompactMetricCell className="status-detail-metric-cell status-detail-description-cell manual-experience-status-detail">
                          {canShowManualExperienceRegionAction ? (
                            <button
                              className="region-required-action manual-experience-status-action"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpenRegionPicker();
                              }}
                            >
                              {manualExperienceRegionActionLabel}
                            </button>
                          ) : (
                            <span className="status-detail-metric-value">
                              {manualExperienceStatusDetail}
                            </span>
                          )}
                        </CompactMetricCell>
                      ) : (cooldownPreviewImageData || cooldownPreviewUrl) && canUseCooldownCropPicker ? (
                        <FloatingTooltipButton
                          className="hunt-crop-image-button"
                          type="button"
                          tooltip="쿨타임 영역 다시 선택"
                          tooltipId="hunt-stall-cooldown-crop-reselect-tooltip"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenRegionPicker();
                          }}
                        >
                          {cooldownPreviewImageData ? (
                            <ImageDataCanvas
                              image={cooldownPreviewImageData}
                              ariaLabel="쿨타임 숫자 감지 영역"
                            />
                          ) : (
                            <img
                              src={cooldownPreviewUrl ?? ""}
                              alt="쿨타임 숫자 감지 영역"
                            />
                          )}
                        </FloatingTooltipButton>
                      ) : cooldownPreviewImageData || cooldownPreviewUrl ? (
                        <span className="hunt-crop-image-readonly">
                          {cooldownPreviewImageData ? (
                            <ImageDataCanvas
                              image={cooldownPreviewImageData}
                              ariaLabel="쿨타임 숫자 감지 영역"
                            />
                          ) : (
                            <img
                              src={cooldownPreviewUrl ?? ""}
                              alt="쿨타임 숫자 감지 영역"
                            />
                          )}
                        </span>
                      ) : canShowCooldownRegionAction ? (
                        <FloatingTooltipButton
                          className="region-required-action"
                          type="button"
                          tooltip={cooldownCropLabel}
                          tooltipId="hunt-stall-cooldown-crop-action-tooltip"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenRegionPicker();
                          }}
                        >
                          {cooldownCropLabel}
                        </FloatingTooltipButton>
                      ) : (
                        <span className="crop-unavailable-text">
                          {shouldShowCooldownNoStreamCropText ? "--" : cooldownCropLabel}
                        </span>
                      )}
                    </div>
                  </td>
                )}
                {isCooldownPresenceMode && (
                  <td>
                    <CompactMetricCell className="status-detail-metric-cell status-detail-description-cell">
                      <span className="status-detail-metric-value">
                        {cooldownStatusDetail}
                      </span>
                    </CompactMetricCell>
                  </td>
                )}
                {isCooldownPresenceMode && (
                  <td>
                    <CompactMetricCell
                      label="판독값"
                      className="hunt-cooldown-reading-metric"
                      ariaLabel={`쿨타임 판독값 ${cooldownValueLabel}`}
                    >
                      <AnimatedMetricText value={cooldownValueLabel} />
                    </CompactMetricCell>
                  </td>
                )}
                {isManualExperienceMode ? (
                  <>
                    <td>
                      <CompactMetricCell label={lastActivityLabel}>
                        <RelativeSecondsMetric timestamp={lastActivityAt} now={lastActivityNow} />
                      </CompactMetricCell>
                    </td>
                    <td>
                      <CompactAlertThresholdEditor
                        ariaLabel={thresholdAriaLabel}
                        disabled={isGloballyDisabled}
                        label="멈춤 기준"
                        max={thresholdMax}
                        min={thresholdMin}
                        rangeHint={thresholdRangeHint}
                        suffix="초"
                        value={thresholdValue}
                        formatDisplayValue={formatNoChangeThresholdSeconds}
                        onCommit={(value) => onChange({ stallThresholdSeconds: value })}
                      />
                    </td>
                    {showsRepeatColumn && (
                      <td>
                        <div className="hunt-repeat-control" onClick={stopHuntStallRowClick}>
                          <span className="hunt-repeat-label">반복</span>
                          <RepeatIntervalPicker
                            value={config.repeatAlertIntervalSeconds ?? 3}
                            className="compact-repeat-picker"
                            disabled={isGloballyDisabled}
                            ariaLabel="사냥 멈춤 반복 알림 간격"
                            disabledOptionLabel="사용 안 함"
                            isDisabledOptionSelected={config.repeatAlertEnabled !== true}
                            maxCount={config.repeatAlertMaxCount ?? null}
                            onChange={(seconds) =>
                              onChange({
                                repeatAlertEnabled: true,
                                repeatAlertIntervalSeconds: seconds,
                                repeatAlertMaxCount:
                                  config.repeatAlertMaxCount ??
                                  (config.repeatAlertEnabled === true
                                    ? null
                                    : DEFAULT_REPEAT_ALERT_MAX_COUNT),
                              })
                            }
                            onDisabledOptionSelect={() => onChange({ repeatAlertEnabled: false })}
                            onMaxCountChange={(count) =>
                              onChange({
                                repeatAlertEnabled: true,
                                repeatAlertIntervalSeconds: config.repeatAlertIntervalSeconds ?? 3,
                                repeatAlertMaxCount: count,
                              })
                            }
                          />
                        </div>
                      </td>
                    )}
                    {showsLastAlertColumn && (
                      <td>
                        <CompactMetricCell label="마지막 알림">
                          <RelativeSecondsMetric
                            timestamp={state.lastAlertedAt}
                            now={lastActivityNow}
                          />
                        </CompactMetricCell>
                      </td>
                    )}
                  </>
                ) : (
                  <>
                    <td>
                      <CompactAlertThresholdEditor
                        ariaLabel={thresholdAriaLabel}
                        disabled={isGloballyDisabled}
                        label="멈춤 기준"
                        max={thresholdMax}
                        min={thresholdMin}
                        rangeHint={thresholdRangeHint}
                        suffix="초"
                        value={thresholdValue}
                        formatDisplayValue={formatNoChangeThresholdSeconds}
                        onCommit={(value) =>
                          onChange(
                            isCooldownPresenceMode
                              ? { cooldownMissingThresholdSeconds: value }
                              : { stallThresholdSeconds: value },
                          )
                        }
                      />
                    </td>
                    <td>
                      <CompactMetricCell label={lastActivityLabel}>
                        <RelativeSecondsMetric timestamp={lastActivityAt} now={lastActivityNow} />
                      </CompactMetricCell>
                    </td>
                  </>
                )}
                <td>
                  <div className="rune-status-cell">
                    <span className={`rune-status-chip hunt-status-chip ${statusView.className}`}>
                      <Activity size={15} />
                      {statusView.label}
                    </span>
                  </div>
                </td>
                <td className="row-actions-cell">
                  <div className="row-actions">
                    <FloatingTooltipButton
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? "사냥 멈춤 알림 설정 접기" : "사냥 멈춤 알림 설정 펼치기"}
                      className="icon-button small expand-toggle-button"
                      type="button"
                      tooltip={isExpanded ? "설정 접기" : "설정 펼치기"}
                      tooltipId="hunt-stall-row-expand-tooltip"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleExpanded();
                      }}
                    >
                      <ChevronRight size={17} />
                    </FloatingTooltipButton>
                  </div>
                </td>
              </tr>
              {isManualExperienceMode && hasManualExperiencePreview && (
                <tr className="hunt-stall-manual-preview-row">
                  <td colSpan={editorColSpan}>
                    <div className="manual-experience-row-preview">
                      {canUseManualExperiencePicker ? (
                        <FloatingTooltipButton
                          className="manual-experience-row-preview-button"
                          type="button"
                          aria-label="경험치바 확인"
                          tooltip="경험치바 높이 다시 선택"
                          tooltipId="hunt-stall-experience-band-reselect-tooltip"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenRegionPicker();
                          }}
                        >
                          <span className="manual-experience-row-preview-frame">
                            {manualExperiencePreviewImageData ? (
                              <ImageDataCanvas image={manualExperiencePreviewImageData} />
                            ) : (
                              <img
                                src={manualExperiencePreviewUrl ?? ""}
                                alt=""
                                aria-hidden="true"
                              />
                            )}
                          </span>
                        </FloatingTooltipButton>
                      ) : (
                        <span className="manual-experience-row-preview-button is-readonly">
                          <span className="manual-experience-row-preview-frame">
                            {manualExperiencePreviewImageData ? (
                              <ImageDataCanvas image={manualExperiencePreviewImageData} />
                            ) : (
                              <img
                                src={manualExperiencePreviewUrl ?? ""}
                                alt=""
                                aria-hidden="true"
                              />
                            )}
                          </span>
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )}
              <HuntStallEditorRow
                editorId={editorId}
                isExpanded={isExpanded}
                colSpan={editorColSpan}
                config={config}
                showDebug={showDebug}
                canPickRegion={canPickRegion}
                confidence={snapshot?.confidence ?? state.confidence}
                foregroundRatio={snapshot?.foregroundRatio ?? 0}
                changeScore={snapshot?.changeScore ?? state.changeScore}
                recognizedText={
                  isManualExperienceMode
                    ? state.recognizedText
                    : snapshot?.recognizedText ?? state.recognizedText
                }
                processedPreviewUrl={snapshot?.processedPreviewUrl ?? null}
                processedPreviewImageData={snapshot?.processedPreviewImageData ?? null}
                rawPreviewUrl={snapshot?.rawPreviewUrl ?? null}
                rawPreviewImageData={snapshot?.rawPreviewImageData ?? null}
                cropLabel={cropLabel}
                lastSampledAt={state.lastSampledAt}
                lastReadableAt={state.lastReadableAt}
                lastReadFailureAt={state.lastReadFailureAt}
                unreadableSinceAt={state.unreadableSinceAt}
                lastReadFailureReason={state.lastReadFailureReason}
                lastDecision={state.lastDecision}
                lastRejectedRecognizedText={state.lastRejectedRecognizedText}
                pendingRecognizedText={state.pendingRecognizedText}
                pendingRecognizedCount={state.pendingRecognizedCount}
                stableSampleCount={state.stableSampleCount}
                unchangedSeconds={state.unchangedSeconds}
                performance={snapshot?.performance ?? null}
                hasDebugPayload={Boolean(hasStream && snapshot?.rawPreviewUrl && snapshot.processedPreviewUrl)}
                hasIssueReportPayload={hasStream}
                isGloballyDisabled={isGloballyDisabled}
                isSubmittingDebugSample={isSubmittingDebugSample}
                isSubmittingIssueReport={isSubmittingIssueReport}
                onChange={onChange}
                onOpenRegionPicker={onOpenRegionPicker}
                onPreviewSound={onPreviewSound}
                onSubmitDebugSample={onSubmitDebugSample}
                onSubmitIssueReport={onSubmitIssueReport}
              />
            </Fragment>
          </tbody>
        </table>
        </div>
      </MotionCollapse>
    </section>
  );
}
