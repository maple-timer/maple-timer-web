import { Activity, ChevronRight, Pause, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  Fragment,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { useGeneralTimerPanelController } from "./useGeneralTimerPanelController";
import {
  formatGeneralTimerTime,
  getGeneralTimerRemainingSeconds,
  getGeneralTimerStatus,
} from "../../domain/general-timer/generalTimers";
import {
  getCustomTimerParts,
  getGeneralTimerActionView,
  getGeneralTimerRowClassName,
  getGeneralTimerStatusView,
  isGeneralTimerInteractiveTarget,
  isGeneralTimerToggleKey,
} from "./generalTimerPanelViewModel";
import type { GeneralTimerConfig } from "../../types";
import { DeferredNumberInput } from "../../shared/components/DeferredNumberInput";
import { MotionCollapse } from "../../shared/components/MotionCollapse";
import { MotionSwitch } from "../../shared/components/MotionSwitch";
import { FloatingTooltipButton } from "../../shared/components/FloatingTooltip";
import {
  AnimatedNumber,
  SHOULD_RENDER_ANIMATED_NUMBER_TEXT,
} from "../../shared/components/AnimatedNumber";
import { GeneralTimerEditorRow } from "./GeneralTimerEditorRow";
import { GeneralTimerPresetPicker } from "./GeneralTimerPresetPicker";
import { CompactMetricCell } from "../../shared/components/CompactMetricCell";
import { PanelStatusIndicator } from "../../shared/components/PanelStatusIndicator";

function stopRowClick(event: SyntheticEvent) {
  event.stopPropagation();
}

export function GeneralTimerPanel({
  timers,
  isGloballyDisabled = false,
  onAddTimer,
  onChangeTimer,
  onRemoveTimer,
  onPreviewSound,
  onTimerAlert,
  embedded = false,
  headerAction,
  isSectionCollapsed = false,
}: {
  timers: GeneralTimerConfig[];
  isGloballyDisabled?: boolean;
  onAddTimer: () => string | void;
  onChangeTimer: (timerId: string, patch: Partial<GeneralTimerConfig>) => void;
  onRemoveTimer: (timerId: string) => void;
  onPreviewSound: (soundId: string, volume: number) => void;
  onTimerAlert: (soundId: string, volume: number) => void;
  embedded?: boolean;
  headerAction?: ReactNode;
  isSectionCollapsed?: boolean;
}) {
  const colSpan = 6;
  const {
    now,
    expandedTimerIds,
    toggleExpanded,
    updatePreset,
    changeCustomDuration,
    startOrPauseTimer,
    startAllEnabledTimers,
    pauseAllRunningTimers,
    resetTimer,
    resetAllTimers,
    addAndExpandTimer,
  } = useGeneralTimerPanelController({
    timers,
    isGloballyDisabled,
    onAddTimer,
    onChangeTimer,
    onTimerAlert,
  });
  const hasEnabledTimer = timers.some((timer) => timer.enabled);
  const hasRunningTimer = timers.some(
    (timer) => timer.enabled && getGeneralTimerStatus(timer, now) === "running",
  );

  return (
    <section
      className={embedded ? "general-timer-panel embedded-general-timer-panel" : "general-timer-panel"}
    >
      <div className="panel-heading general-timer-heading">
        <div>
          <div className="rune-title-row">
            <PanelStatusIndicator
              isActive={hasRunningTimer && !isGloballyDisabled}
              isEnabled={hasEnabledTimer}
              label="일반 타이머"
            />
            <h2>일반 타이머</h2>
          </div>
        </div>
        <div className="panel-heading-actions">
          {!isSectionCollapsed && (
            <>
              <FloatingTooltipButton
                aria-label="일반 타이머 전체 시작 또는 재개"
                className="panel-heading-icon-button general-timer-bulk-action-button"
                disabled={isGloballyDisabled || !hasEnabledTimer}
                tooltip={<span className="tooltip-nowrap">활성화된 일반 타이머 모두 시작 또는 재개</span>}
                tooltipId="general-timer-start-all-tooltip"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  startAllEnabledTimers();
                }}
              >
                <Play size={17} strokeWidth={1.9} />
              </FloatingTooltipButton>
              <FloatingTooltipButton
                aria-label="일반 타이머 전체 일시정지"
                className="panel-heading-icon-button general-timer-bulk-action-button"
                disabled={isGloballyDisabled || !hasRunningTimer}
                tooltip={<span className="tooltip-nowrap">진행 중인 일반 타이머 모두 일시정지</span>}
                tooltipId="general-timer-pause-all-tooltip"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  pauseAllRunningTimers();
                }}
              >
                <Pause size={17} strokeWidth={1.9} />
              </FloatingTooltipButton>
              <FloatingTooltipButton
                aria-label="일반 타이머 전체 초기화"
                className="panel-heading-icon-button general-timer-bulk-action-button"
                disabled={isGloballyDisabled || timers.length === 0}
                tooltip={<span className="tooltip-nowrap">일반 타이머 모두 초기화</span>}
                tooltipId="general-timer-reset-all-tooltip"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  resetAllTimers();
                }}
              >
                <RotateCcw size={17} strokeWidth={1.9} />
              </FloatingTooltipButton>
            </>
          )}
          {!isSectionCollapsed && (
            <FloatingTooltipButton
              aria-label="타이머 추가"
              className="panel-heading-icon-button panel-heading-add-button"
              tooltip="타이머 추가"
              tooltipId="general-timer-add-tooltip"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                addAndExpandTimer();
              }}
            >
              <Plus size={19} strokeWidth={1.9} />
            </FloatingTooltipButton>
          )}
          {headerAction}
        </div>
      </div>

      <MotionCollapse
        className="alert-section-body"
        isCollapsed={isSectionCollapsed}
        aria-hidden={isSectionCollapsed}
      >
        <div className="general-timer-table-wrap">
          <table className="general-timer-table">
          <colgroup>
            <col className="col-general-enabled" />
            <col className="col-general-preset" />
            <col className="col-general-time" />
            <col className="col-general-control" />
            <col className="col-general-status" />
            <col className="col-general-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>활성</th>
              <th>종류</th>
              <th>알림까지</th>
              <th>실행</th>
              <th>상태</th>
              <th aria-label="일반 타이머 조작" />
            </tr>
          </thead>
          <tbody>
            {timers.length === 0 ? (
              <tr className="general-timer-empty-row">
                <td colSpan={colSpan}>
                  <button
                    className="empty-alert-state empty-alert-state--interactive"
                    type="button"
                    aria-label="빈 일반 타이머 추가"
                    onClick={addAndExpandTimer}
                  >
                    <span className="empty-alert-state-copy">
                      <strong>등록된 일반 타이머가 없습니다</strong>
                      <span>도핑, 재획비, 직접 입력 타이머를 추가해 사용할 수 있습니다.</span>
                    </span>
                    <span className="empty-alert-state-action" aria-hidden="true">
                      <Plus size={17} strokeWidth={1.9} />
                      타이머 추가
                    </span>
                  </button>
                </td>
              </tr>
            ) : timers.map((timer) => {
              const status = getGeneralTimerStatus(timer, now);
              const statusView = getGeneralTimerStatusView(status);
              const isExpanded = expandedTimerIds.includes(timer.id);
              const remainingSeconds = getGeneralTimerRemainingSeconds(timer, now);
              const { minutes, seconds } = getCustomTimerParts(timer);
              const isDisabled = isGloballyDisabled || !timer.enabled;
              const actionView = getGeneralTimerActionView(status);

              return (
                <Fragment key={timer.id}>
                  <tr
                    aria-expanded={isExpanded}
                    className={getGeneralTimerRowClassName({
                      isEnabled: timer.enabled,
                      isExpanded,
                    })}
                    onClick={() => toggleExpanded(timer.id)}
                    onKeyDown={(event) => {
                      if (
                        !isGeneralTimerToggleKey(event.key) ||
                        isGeneralTimerInteractiveTarget(event.target)
                      ) {
                        return;
                      }

                      event.preventDefault();
                      toggleExpanded(timer.id);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <td>
                      <MotionSwitch
                        className="row-toggle general-timer-toggle"
                        checked={timer.enabled}
                        disabled={isGloballyDisabled}
                        label={timer.enabled ? "켜짐" : "꺼짐"}
                        onClick={stopRowClick}
                        onChange={(checked) => onChangeTimer(timer.id, { enabled: checked })}
                      />
                    </td>
                    <td className="general-timer-preset-cell">
                      <div className="general-timer-preset-inline">
                        <div className="general-timer-preset-controls" onClick={stopRowClick}>
                          <span className="general-timer-preset-stack">
                            {timer.name && (
                              <span className="general-timer-name-label" title={timer.name}>
                                {timer.name}
                              </span>
                            )}
                            <GeneralTimerPresetPicker
                              value={timer.presetId}
                              disabled={isGloballyDisabled}
                              onChange={(presetId) => updatePreset(timer, presetId)}
                            />
                          </span>
                          {timer.presetId === "custom" && (
                            <span className="general-timer-custom-editor">
                              <span className="duration-field">
                                <span className="duration-label">분</span>
                                <span className="duration-input-wrap" data-range-hint="0-1440분">
                                  <DeferredNumberInput
                                    ariaLabel="일반 타이머 분"
                                    className="duration-input"
                                    min={0}
                                    max={1440}
                                    value={minutes}
                                    disabled={isGloballyDisabled}
                                    onCommit={(value) =>
                                      changeCustomDuration(timer.id, Math.round(value) * 60 + seconds)
                                    }
                                  />
                                </span>
                              </span>
                              <span className="duration-field">
                                <span className="duration-label">초</span>
                                <span className="duration-input-wrap" data-range-hint="0-59초">
                                  <DeferredNumberInput
                                    ariaLabel="일반 타이머 초"
                                    className="duration-input"
                                    min={0}
                                    max={59}
                                    value={seconds}
                                    disabled={isGloballyDisabled}
                                    onCommit={(value) =>
                                      changeCustomDuration(timer.id, minutes * 60 + Math.round(value))
                                    }
                                  />
                                </span>
                              </span>
                            </span>
                          )}
                        </div>
                        <MotionSwitch
                          className="row-toggle general-timer-toggle general-timer-auto-restart-toggle"
                          ariaLabel="자동 재시작"
                          checked={timer.autoRestartEnabled === true}
                          disabled={isGloballyDisabled}
                          label={timer.autoRestartEnabled === true ? "자동 재시작" : "재시작 없음"}
                          onClick={stopRowClick}
                          onChange={(checked) =>
                            onChangeTimer(timer.id, { autoRestartEnabled: checked })
                          }
                        />
                      </div>
                    </td>
                    <td>
                      <CompactMetricCell label="알림까지" className="general-timer-remaining-cell">
                        <AnimatedGeneralTimerTime seconds={remainingSeconds} status={status} />
                      </CompactMetricCell>
                    </td>
                    <td>
                      <div className="general-timer-control-group general-timer-icon-actions" onClick={stopRowClick}>
                        <FloatingTooltipButton
                          aria-label={actionView.label}
                          className="icon-button small general-timer-action-button"
                          type="button"
                          tooltip={actionView.title}
                          tooltipId={`general-timer-${timer.id}-action-tooltip`}
                          disabled={isDisabled}
                          onClick={() => startOrPauseTimer(timer)}
                        >
                          {actionView.icon === "pause" ? <Pause size={15} /> : <Play size={15} />}
                        </FloatingTooltipButton>
                        <FloatingTooltipButton
                          aria-label="초기화"
                          className="icon-button small general-timer-action-button"
                          type="button"
                          tooltip="초기화"
                          tooltipId={`general-timer-${timer.id}-reset-tooltip`}
                          disabled={isGloballyDisabled}
                          onClick={() => resetTimer(timer.id)}
                        >
                          <RotateCcw size={16} />
                        </FloatingTooltipButton>
                      </div>
                    </td>
                    <td>
                      <div className="rune-status-cell general-timer-status-cell">
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
                          aria-label={isExpanded ? "일반 타이머 설정 접기" : "일반 타이머 설정 펼치기"}
                          className="icon-button small expand-toggle-button"
                          type="button"
                          tooltip={isExpanded ? "설정 접기" : "설정 펼치기"}
                          tooltipId={`general-timer-${timer.id}-expand-tooltip`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleExpanded(timer.id);
                          }}
                        >
                          <ChevronRight size={17} />
                        </FloatingTooltipButton>
                        <FloatingTooltipButton
                          aria-label="삭제"
                          className="icon-button small danger row-delete-button"
                          type="button"
                          tooltip="삭제"
                          tooltipId={`general-timer-${timer.id}-delete-tooltip`}
                          disabled={isGloballyDisabled}
                          onClick={(event) => {
                            event.stopPropagation();
                            onRemoveTimer(timer.id);
                          }}
                        >
                          <Trash2 size={16} />
                        </FloatingTooltipButton>
                      </div>
                    </td>
                  </tr>
                  <GeneralTimerEditorRow
                    timer={timer}
                    isExpanded={isExpanded}
                    colSpan={colSpan}
                    isDisabled={isDisabled}
                    onChange={onChangeTimer}
                    onPreviewSound={onPreviewSound}
                  />
                </Fragment>
              );
            })}
          </tbody>
          </table>
        </div>
      </MotionCollapse>
    </section>
  );
}

function AnimatedGeneralTimerTime({
  seconds,
  status,
}: {
  seconds: number;
  status: ReturnType<typeof getGeneralTimerStatus>;
}) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  const formattedTime = formatGeneralTimerTime(safeSeconds);

  if (SHOULD_RENDER_ANIMATED_NUMBER_TEXT) {
    return <span className={`general-timer-time ${status}`}>{formattedTime}</span>;
  }

  return (
    <span
      aria-label={formattedTime}
      className={`general-timer-time animated-timer-time ${status}`}
    >
      {hours > 0 && (
        <>
          <AnimatedNumber className="animated-inline-number-flow" value={hours} />
          <span className="animated-time-separator">:</span>
        </>
      )}
      <AnimatedNumber
        className="animated-inline-number-flow"
        value={minutes}
        format={{
          minimumIntegerDigits: 2,
          maximumFractionDigits: 0,
          useGrouping: false,
        }}
      />
      <span className="animated-time-separator">:</span>
      <AnimatedNumber
        className="animated-inline-number-flow"
        value={remainingSeconds}
        format={{
          minimumIntegerDigits: 2,
          maximumFractionDigits: 0,
          useGrouping: false,
        }}
      />
    </span>
  );
}
