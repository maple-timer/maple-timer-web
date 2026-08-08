import { BellRing, ChevronRight } from "lucide-react";
import { Fragment } from "react";
import type { RuneRuntimeState, RuneRuntimeStatus, RuneSnapshot } from "../../../alertTypes";
import {
  getSkillRegionForLayout,
  hasAnySkillRegion,
  hasUsableRegion,
} from "../../../lib/regions";
import { DEFAULT_REPEAT_ALERT_MAX_COUNT } from "../../../lib/repeatAlerts";
import type { RuneAlertConfig } from "../../../types";
import { MotionSwitch } from "../../../shared/components/MotionSwitch";
import { RepeatIntervalPicker } from "../../../shared/components/RepeatIntervalPicker";
import { ImageDataCanvas } from "../../../shared/components/ImageDataCanvas";
import { FloatingTooltipButton } from "../../../shared/components/FloatingTooltip";
import { CompactMetricCell, RelativeSecondsMetric } from "../../../shared/components/CompactMetricCell";
import { RuneAlertEditorRow } from "./RuneAlertEditorRow";
import {
  getRuneStatusView,
  isRuneInteractiveTarget,
  isRuneToggleKey,
  stopRuneRowClick,
} from "./runeAlertUtils";

export function RuneAlertRow({
  config,
  state,
  snapshot,
  now,
  isExpanded,
  hasStream,
  canPickRegion,
  currentLayoutKey,
  showDebug,
  isGloballyDisabled,
  isSubmittingDebugSample,
  isSubmittingFalsePositive,
  onToggleExpanded,
  onChange,
  onOpenRegionPicker,
  onPreviewSound,
  onSubmitDebugSample,
  onSubmitFalsePositive,
}: {
  config: RuneAlertConfig;
  state: RuneRuntimeState;
  snapshot: RuneSnapshot | null;
  now: number;
  isExpanded: boolean;
  hasStream: boolean;
  canPickRegion: boolean;
  currentLayoutKey: string | null;
  showDebug: boolean;
  isGloballyDisabled: boolean;
  isSubmittingDebugSample: boolean;
  isSubmittingFalsePositive: boolean;
  onToggleExpanded: () => void;
  onChange: (patch: Partial<RuneAlertConfig>) => void;
  onOpenRegionPicker: () => void;
  onResetDetection: () => void;
  onPreviewSound: (soundId: string, volume: number) => void;
  onSubmitDebugSample: () => void;
  onSubmitFalsePositive: () => void;
}) {
  const currentRegion = getSkillRegionForLayout(config, currentLayoutKey);
  const hasCurrentRegion = hasUsableRegion(currentRegion);
  const hasSavedOtherLayoutRegion =
    !hasCurrentRegion && Boolean(currentLayoutKey) && hasAnySkillRegion(config);
  const displayStatus: RuneRuntimeStatus = !config.enabled
    ? "paused"
    : !hasStream
      ? "no-stream"
      : !hasCurrentRegion
        ? "no-region"
        : state.status;
  const statusView = getRuneStatusView(displayStatus, state);
  const thumbnailUrl = hasStream && hasCurrentRegion ? snapshot?.rawPreviewUrl : null;
  const thumbnailImageData =
    hasStream && hasCurrentRegion ? snapshot?.rawPreviewImageData ?? null : null;
  const candidateImageData = snapshot?.candidatePreviewImageData ?? null;
  const hasFalsePositivePayload =
    Boolean(snapshot?.rawPreviewUrl && snapshot.maskPreviewUrl) || (hasStream && hasCurrentRegion);
  const cropPlaceholderLabel = hasCurrentRegion
    ? hasStream
      ? "룬 대기"
      : "화면 공유 필요"
    : !hasStream
      ? "화면 공유 필요"
      : hasSavedOtherLayoutRegion
      ? "미니맵 영역 다시 선택"
      : "미니맵 영역 선택";
  const canUseRuneRegionPicker = config.enabled && canPickRegion && !isGloballyDisabled;
  const canShowRuneRegionAction = canUseRuneRegionPicker && hasStream && !hasCurrentRegion;
  const shouldShowPassiveCropText = !config.enabled || isGloballyDisabled || (!hasStream && !canPickRegion);
  const hasRuneCropPreview = Boolean(thumbnailImageData || thumbnailUrl);
  const renderRuneCropPreview = () =>
    thumbnailImageData ? (
      <ImageDataCanvas
        image={thumbnailImageData}
        ariaLabel="룬 감지 미니맵 미리보기"
      />
    ) : (
      <img src={thumbnailUrl ?? ""} alt="룬 감지 미니맵 미리보기" />
    );
  const editorId = "rune-alert-editor";

  return (
    <Fragment>
      <tr
        aria-controls={editorId}
        aria-expanded={isExpanded}
        className={[
          "dashboard-row",
          "rune-dashboard-row",
          !config.enabled ? "is-disabled-row" : "",
          isExpanded ? "expanded-row" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={onToggleExpanded}
        onKeyDown={(event) => {
          if (!isRuneToggleKey(event) || isRuneInteractiveTarget(event.target)) {
            return;
          }
          event.preventDefault();
          onToggleExpanded();
        }}
        role="button"
        tabIndex={0}
      >
        <td>
          <MotionSwitch
            className="row-toggle rune-row-toggle"
            checked={config.enabled}
            disabled={isGloballyDisabled}
            label={config.enabled ? "켜짐" : "꺼짐"}
            onClick={stopRuneRowClick}
            onChange={(checked) => onChange({ enabled: checked })}
          />
        </td>
        <td>
          <div className="crop-preview rune-crop-preview">
            {hasRuneCropPreview && canUseRuneRegionPicker ? (
              <FloatingTooltipButton
                className="rune-crop-image-button"
                type="button"
                tooltip="미니맵 영역 다시 선택"
                tooltipId="rune-crop-reselect-tooltip"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenRegionPicker();
                }}
              >
                {renderRuneCropPreview()}
              </FloatingTooltipButton>
            ) : hasRuneCropPreview ? (
              <span className="rune-crop-image-readonly">
                {renderRuneCropPreview()}
              </span>
            ) : canShowRuneRegionAction ? (
              <FloatingTooltipButton
                className="region-required-action"
                type="button"
                tooltip={cropPlaceholderLabel}
                tooltipId="rune-crop-action-tooltip"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenRegionPicker();
                }}
              >
                {cropPlaceholderLabel}
              </FloatingTooltipButton>
            ) : (
              <span className="crop-unavailable-text">
                {shouldShowPassiveCropText ? "--" : cropPlaceholderLabel}
              </span>
            )}
          </div>
        </td>
        <td>
          <CompactMetricCell className="status-detail-metric-cell">
            <span className="status-detail-metric-value">
              {getRuneStatusDetail(displayStatus, hasCurrentRegion, hasStream)}
            </span>
          </CompactMetricCell>
        </td>
        <td>
          <div
            className={[
              "rune-candidate-preview",
              candidateImageData || snapshot?.candidatePreviewUrl ? "has-image" : "",
              displayStatus === "waiting" && (candidateImageData || snapshot?.candidatePreviewUrl)
                ? "stale"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {candidateImageData ? (
              <ImageDataCanvas image={candidateImageData} ariaLabel="최근 감지된 룬 후보" />
            ) : snapshot?.candidatePreviewUrl ? (
              <img src={snapshot.candidatePreviewUrl} alt="최근 감지된 룬 후보" />
            ) : (
              <span>감지 없음</span>
            )}
          </div>
        </td>
        <td>
          <div className="rune-repeat-control" onClick={stopRuneRowClick}>
            <span className="rune-repeat-label">반복</span>
            <RepeatIntervalPicker
              value={config.repeatAlertIntervalSeconds ?? 3}
              className="compact-repeat-picker"
              disabled={isGloballyDisabled}
              ariaLabel="룬 반복 알림 간격"
              disabledOptionLabel="사용 안 함"
              isDisabledOptionSelected={config.repeatAlertEnabled !== true}
              maxCount={config.repeatAlertMaxCount ?? null}
              onChange={(seconds) =>
                onChange({
                  repeatAlertEnabled: true,
                  repeatAlertIntervalSeconds: seconds,
                  repeatAlertMaxCount:
                    config.repeatAlertMaxCount ??
                    (config.repeatAlertEnabled === true ? null : DEFAULT_REPEAT_ALERT_MAX_COUNT),
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
        <td>
          <CompactMetricCell label="룬 감지">
            <RelativeSecondsMetric timestamp={state.lastFoundAt} now={now} />
          </CompactMetricCell>
        </td>
        <td>
          <div className="rune-status-cell">
            <span className={`rune-status-chip ${statusView.className}`}>
              <BellRing size={15} />
              {statusView.label}
            </span>
          </div>
        </td>
        <td className="row-actions-cell">
          <div className="row-actions">
            <FloatingTooltipButton
              aria-expanded={isExpanded}
              aria-label={isExpanded ? "룬 설정 접기" : "룬 설정 펼치기"}
              className="icon-button small expand-toggle-button"
              type="button"
              tooltip={isExpanded ? "설정 접기" : "설정 펼치기"}
              tooltipId="rune-row-expand-tooltip"
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpanded();
              }}
            >
              <ChevronRight size={17} />
            </FloatingTooltipButton>
          </div>
        </td>
      </tr>
      <RuneAlertEditorRow
        editorId={editorId}
        isExpanded={isExpanded}
        config={config}
        confidence={snapshot?.confidence ?? state.confidence}
        candidateCount={snapshot?.candidateCount ?? state.candidateCount}
        maskPreviewUrl={snapshot?.maskPreviewUrl ?? null}
        maskPreviewImageData={snapshot?.maskPreviewImageData ?? null}
        canPickRegion={canPickRegion}
        hasCurrentRegion={hasCurrentRegion}
        hasStream={hasStream}
        isGloballyDisabled={isGloballyDisabled}
        showDebug={showDebug}
        hasFalsePositivePayload={hasFalsePositivePayload}
        isSubmittingDebugSample={isSubmittingDebugSample}
        isSubmittingFalsePositive={isSubmittingFalsePositive}
        onChange={onChange}
        onOpenRegionPicker={onOpenRegionPicker}
        onPreviewSound={onPreviewSound}
        onSubmitDebugSample={onSubmitDebugSample}
        onSubmitFalsePositive={onSubmitFalsePositive}
      />
    </Fragment>
  );
}


function getRuneStatusDetail(
  displayStatus: RuneRuntimeStatus,
  hasCurrentRegion: boolean,
  hasStream: boolean,
): string {
  if (displayStatus === "paused") {
    return "알림 꺼짐";
  }

  if (!hasStream) {
    return "화면 공유 후 미니맵 확인";
  }

  if (!hasCurrentRegion) {
    return "사냥터 미니맵 영역 필요";
  }

  if (displayStatus === "loading") {
    return "룬 감지 모듈 로딩 중";
  }

  if (displayStatus === "candidate") {
    return "룬 후보 확인 중";
  }

  if (displayStatus === "alerted") {
    return "반복 알림 확인 중";
  }

  return "미니맵에서 룬 찾는 중";
}
