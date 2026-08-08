import { Activity, ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import type {
  BoosterExpiryRuntimeState,
  BoosterExpirySnapshot,
} from "../../../lib/boosterExpiry/boosterExpiryTypes";
import {
  MAX_BOOSTER_EXPIRY_ALERT_LEAD_SECONDS,
  MIN_BOOSTER_EXPIRY_ALERT_LEAD_SECONDS,
} from "../../../lib/profileStorageConstants";
import { getBoosterExpiryAlertSounds } from "../../../lib/sounds";
import type { BoosterExpiryAlertConfig } from "../../../types";
import { AnimatedNumber } from "../../../shared/components/AnimatedNumber";
import {
  FloatingTooltipButton,
  InfoTooltip,
  TooltipHelpContent,
} from "../../../shared/components/FloatingTooltip";
import { MotionCollapse } from "../../../shared/components/MotionCollapse";
import { MotionSwitch } from "../../../shared/components/MotionSwitch";
import { AlertEditorRow } from "../../../shared/components/AlertEditorRow";
import { isAlertIssueReportButtonDisabled } from "../../../application/reporting/alertIssueReportAvailability";
import { CompactAlertThresholdEditor } from "../shared/CompactAlertThresholdEditor";
import { AnimatedMetricText, CompactMetricCell, RelativeSecondsMetric } from "../../../shared/components/CompactMetricCell";
import { PanelStatusIndicator } from "../../../shared/components/PanelStatusIndicator";
import { useExpandableRowController } from "../shared/useExpandableRowController";
import {
  type BoosterExpiryStatusView,
  getBoosterExpiryReadingLabel,
  getBoosterExpiryStatusView,
} from "./boosterExpiryUtils";

export function BoosterExpiryPanel({
  config,
  state,
  snapshot,
  hasStream,
  isGameViewportReady = true,
  showDebug,
  isGloballyDisabled = false,
  onChange,
  onPreviewSound,
  onSubmitIssueReport,
  isSubmittingIssueReport,
  embedded = false,
  headerAction,
  isSectionCollapsed = false,
}: {
  config: BoosterExpiryAlertConfig;
  state: BoosterExpiryRuntimeState;
  snapshot: BoosterExpirySnapshot | null;
  hasStream: boolean;
  isGameViewportReady?: boolean;
  showDebug: boolean;
  isGloballyDisabled?: boolean;
  onChange: (patch: Partial<BoosterExpiryAlertConfig>) => void;
  onResetDetection: () => void;
  onPreviewSound: (soundId: string, volume: number) => void;
  onSubmitIssueReport: () => void;
  isSubmittingIssueReport: boolean;
  embedded?: boolean;
  headerAction?: ReactNode;
  isSectionCollapsed?: boolean;
}) {
  const { isExpanded, toggleExpanded } = useExpandableRowController();
  const statusView = getBoosterExpiryStatusView(
    state,
    hasStream,
    config.enabled,
    isGameViewportReady,
  );
  const reading = getBoosterExpiryReadingLabel(state);
  const now = state.lastSampledAt ?? Date.now();
  const editorId = "booster-expiry-alert-editor";
  const isBoosterExpiryPanelActive =
    config.enabled && hasStream && isGameViewportReady && !isGloballyDisabled;

  return (
    <section
      className={embedded ? "rune-alert-panel embedded-rune-alert-panel" : "rune-alert-panel"}
    >
      <div className="panel-heading rune-heading">
        <div>
          <div className="rune-title-row">
            <PanelStatusIndicator
              isActive={isBoosterExpiryPanelActive}
              isEnabled={config.enabled}
              label="부스터 종료 알림"
            />
            <h2>부스터 종료 알림</h2>
            <InfoTooltip
              id="booster-expiry-tooltip"
              label="부스터 종료 알림 안내"
              displayLabel="사용 안내"
              className="capture-info-button named-info-tooltip"
              content={
                <TooltipHelpContent
                  title="화면 중상단의 부스터 타이머를 읽어 종료 알림을 보냅니다."
                  items={[
                    "1분 이상 남은 타이머를 먼저 확인한 뒤 알림 시점을 계산합니다.",
                    "설정한 알림 시점에 도달하면 한 사이클에 한 번만 울립니다.",
                    "화면 중상단에서 자동으로 찾기 때문에 영역을 직접 선택하지 않아도 됩니다.",
                    <span className="tooltip-nowrap">
                      부스터 타이머가 다른 UI에 가려지면 감지하지 못할 수 있습니다.
                    </span>,
                  ]}
                />
              }
              width={580}
              fitContent
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
        <div className="rune-table-wrap">
          <table className="rune-table buff-expiry-table booster-expiry-table">
            <colgroup>
              <col className="col-buff-enabled" />
              <col className="col-buff-detail" />
              <col className="col-buff-count" />
              <col className="col-buff-threshold" />
              <col className="col-buff-alert-timing" />
              <col className="col-buff-last-alert" />
              <col className="col-buff-status" />
              <col className="col-buff-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>활성</th>
                <th>상태 설명</th>
                <th>판독값</th>
                <th>알림 시점</th>
                <th>알림까지</th>
                <th>마지막 알림</th>
                <th>상태</th>
                <th aria-label="부스터 종료 알림 조작" />
              </tr>
            </thead>
            <tbody>
              <Fragment>
                <tr
                  aria-controls={editorId}
                  aria-expanded={isExpanded}
                  className={[
                    "dashboard-row",
                    "rune-alert-row",
                    !config.enabled ? "is-disabled-row" : "",
                    isExpanded ? "expanded-row" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={toggleExpanded}
                  role="button"
                  tabIndex={0}
                >
                  <td>
                    <MotionSwitch
                      className="row-toggle hunt-row-toggle"
                      checked={config.enabled}
                      disabled={isGloballyDisabled}
                      label={config.enabled ? "켜짐" : "꺼짐"}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(checked) => onChange({ enabled: checked })}
                    />
                  </td>
                  <td>
                    <CompactMetricCell className="status-detail-metric-cell status-detail-description-cell">
                      <span className="status-detail-metric-value">{statusView.detail ?? "--"}</span>
                    </CompactMetricCell>
                  </td>
                  <td>
                    <CompactMetricCell label="판독값" className="booster-reading-cell">
                      <AnimatedMetricText value={reading.primary} />
                    </CompactMetricCell>
                  </td>
                  <td>
                    <CompactAlertThresholdEditor
                      ariaLabel="부스터 종료 알림 시점"
                      disabled={isGloballyDisabled}
                      label="알림 시점"
                      max={MAX_BOOSTER_EXPIRY_ALERT_LEAD_SECONDS}
                      min={MIN_BOOSTER_EXPIRY_ALERT_LEAD_SECONDS}
                      rangeHint="1-20초"
                      suffix="초 전"
                      value={config.alertLeadSeconds}
                      onCommit={(value) => onChange({ alertLeadSeconds: value })}
                    />
                  </td>
                  <td>
                    <CompactMetricCell label="알림까지" className="booster-alert-timing-cell">
                      <BoosterAlertTimingMetric statusView={statusView} />
                    </CompactMetricCell>
                  </td>
                  <td>
                    <CompactMetricCell label="마지막 알림">
                      <RelativeSecondsMetric timestamp={state.alertedAt} now={now} />
                    </CompactMetricCell>
                  </td>
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
                        aria-label={isExpanded ? "부스터 종료 알림 설정 접기" : "부스터 종료 알림 설정 펼치기"}
                        className="icon-button small expand-toggle-button"
                        type="button"
                        tooltip={isExpanded ? "설정 접기" : "설정 펼치기"}
                        tooltipId="booster-expiry-row-expand-tooltip"
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
                <AlertEditorRow
                  isExpanded={isExpanded}
                  colSpan={8}
                  editorId={editorId}
                  rowClassName="inline-editor-row buff-expiry-editor-row"
                  editorClassName="inline-skill-editor buff-expiry-inline-editor"
                  editorLayout="command-rail"
                  soundId={config.soundId}
                  soundLabel="알림음"
                  sounds={getBoosterExpiryAlertSounds()}
                  volume={config.volume}
                  volumeWarningKey="booster-expiry"
                  reportLabel="감지 제보"
                  reportButtonClassName="hunt-issue-report-button"
                  reportDisabled={isAlertIssueReportButtonDisabled({
                    featureEnabled: config.enabled,
                    isGloballyDisabled,
                    hasReportPayload: hasStream,
                  })}
                  isSubmittingReport={isSubmittingIssueReport}
                  onSoundChange={(soundId) => onChange({ soundId })}
                  onVolumeChange={(volume) => onChange({ volume })}
                  onPreviewSound={(volumeOverride) =>
                    onPreviewSound(config.soundId, volumeOverride ?? config.volume)
                  }
                  onSubmitReport={onSubmitIssueReport}
                  debugContent={
                    <BoosterExpiryDetailPanel
                      state={state}
                      snapshot={snapshot}
                      showDebug={showDebug}
                    />
                  }
                />
              </Fragment>
            </tbody>
          </table>
        </div>
      </MotionCollapse>
    </section>
  );
}

function BoosterAlertTimingMetric({ statusView }: { statusView: BoosterExpiryStatusView }) {
  if (statusView.label !== "알림 대기") {
    return <span className="compact-metric-placeholder">--</span>;
  }

  if (typeof statusView.alertCountdownSeconds !== "number") {
    return <span className="compact-metric-plain-value">계산 중</span>;
  }

  if (statusView.alertCountdownSeconds <= 0) {
    return <span className="compact-metric-plain-value">곧 알림</span>;
  }

  return (
    <span
      className="animated-inline-number compact-metric-plain-value"
      aria-label={`${statusView.alertCountdownSeconds}초 뒤`}
    >
      <AnimatedNumber
        ariaHidden
        className="animated-inline-number-flow"
        value={statusView.alertCountdownSeconds}
      />
      <span>초 뒤</span>
    </span>
  );
}

function BoosterExpiryDetailPanel({
  state,
  snapshot,
  showDebug,
}: {
  state: BoosterExpiryRuntimeState;
  snapshot: BoosterExpirySnapshot | null;
  showDebug: boolean;
}) {
  if (!showDebug) {
    return null;
  }

  return (
    <div className="hunt-debug-panel" onClick={(event) => event.stopPropagation()}>
      <div className="hunt-debug-grid">
        <div>
          <strong>raw</strong>
          <span>{snapshot?.rawTime?.text ?? "-"}</span>
        </div>
        <div>
          <strong>final</strong>
          <span>{snapshot?.time?.text ?? state.displayText ?? "-"}</span>
        </div>
        <div>
          <strong>flow</strong>
          <span>{snapshot?.flow?.source ?? state.flowSource ?? "-"}</span>
        </div>
        <div>
          <strong>lock</strong>
          <span>{state.locked ? "yes" : "no"}</span>
        </div>
        <div>
          <strong>처리</strong>
          <span>{snapshot?.performance ? `${snapshot.performance.totalMs.toFixed(1)}ms` : "-"}</span>
        </div>
        <div>
          <strong>후보</strong>
          <span>{snapshot?.timeRect?.matchCount ?? 0}개</span>
        </div>
      </div>
      {snapshot?.timerPreviewUrl || snapshot?.rawPreviewUrl ? (
        <div className="hunt-debug-previews">
          {snapshot.timerPreviewUrl && (
            <figure>
              <img src={snapshot.timerPreviewUrl} alt="부스터 타이머 감지 crop" />
              <figcaption>타이머</figcaption>
            </figure>
          )}
          {snapshot.rawPreviewUrl && (
            <figure>
              <img src={snapshot.rawPreviewUrl} alt="부스터 타이머 상단 ROI" />
              <figcaption>상단 ROI</figcaption>
            </figure>
          )}
        </div>
      ) : null}
    </div>
  );
}
