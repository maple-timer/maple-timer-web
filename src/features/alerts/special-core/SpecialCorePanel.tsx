import { Activity, ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import {
  MAX_SPECIAL_CORE_ALERT_LEAD_SECONDS,
  MAX_SPECIAL_CORE_COOLDOWN_SECONDS,
  MIN_SPECIAL_CORE_ALERT_LEAD_SECONDS,
  MIN_SPECIAL_CORE_COOLDOWN_SECONDS,
  getSpecialCoreRemainingSecondsForDisplay,
  type SpecialCoreCandidateIcon,
  type SpecialCoreIcon,
  type SpecialCoreRuntimeState,
  type SpecialCoreSnapshot,
} from "../../../lib/specialCore";
import { getSpecialCoreAlertSounds } from "../../../lib/sounds";
import type { SpecialCoreAlertConfig } from "../../../types";
import { AlertChecklistBadge } from "../../../shared/components/AlertChecklistBadge";
import { AnimatedNumber } from "../../../shared/components/AnimatedNumber";
import {
  FloatingTooltipButton,
  TooltipHelpContent,
} from "../../../shared/components/FloatingTooltip";
import { ImageDataCanvas } from "../../../shared/components/ImageDataCanvas";
import { MapleHoverCard } from "../../../shared/components/MapleHoverCard";
import { MotionCollapse } from "../../../shared/components/MotionCollapse";
import { MotionSwitch } from "../../../shared/components/MotionSwitch";
import { AlertEditorRow } from "../../../shared/components/AlertEditorRow";
import { isAlertIssueReportButtonDisabled } from "../../../application/reporting/alertIssueReportAvailability";
import { CompactAlertThresholdEditor } from "../shared/CompactAlertThresholdEditor";
import {
  AnimatedMetricText,
  CompactMetricCell,
  RelativeSecondsMetric,
} from "../../../shared/components/CompactMetricCell";
import { PanelStatusIndicator } from "../../../shared/components/PanelStatusIndicator";
import { useExpandableRowController } from "../shared/useExpandableRowController";
import { getSpecialCoreStatusView } from "./specialCorePanelUtils";

const SPECIAL_CORE_CHECKLIST_ITEMS: ReactNode[] = [
  "확장 UI를 사용한다면 화면 공유 메뉴에서 게임 영역을 설정해주세요.",
  <>
    인게임 설정 &gt; UI &gt; 퀵슬롯&버프 시간표시는 [중앙, 크게]를 권장합니다.
    <img
      className="alert-checklist-image"
      src="/media/quickslot-buff-time-large-center.png"
      alt="퀵슬롯과 버프 시간 표시가 중앙, 크게로 설정된 예시"
    />
  </>,
  <>인게임 설정 &gt; UI &gt; 버프 정렬 옵션을 모두 켜주세요.</>,
];

export function SpecialCorePanel({
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
  config: SpecialCoreAlertConfig;
  state: SpecialCoreRuntimeState;
  snapshot: SpecialCoreSnapshot | null;
  hasStream: boolean;
  isGameViewportReady?: boolean;
  showDebug: boolean;
  isGloballyDisabled?: boolean;
  onChange: (patch: Partial<SpecialCoreAlertConfig>) => void;
  onResetDetection: () => void;
  onPreviewSound: (soundId: string, volume: number) => void;
  onSubmitIssueReport: () => void;
  isSubmittingIssueReport: boolean;
  embedded?: boolean;
  headerAction?: ReactNode;
  isSectionCollapsed?: boolean;
}) {
  const { isExpanded, toggleExpanded } = useExpandableRowController();
  const statusView = getSpecialCoreStatusView({
    state,
    hasStream,
    enabled: config.enabled,
    isGameViewportReady,
  });
  const now = state.lastSampledAt ?? Date.now();
  const editorId = "special-core-alert-editor";
  const isSpecialCorePanelActive =
    config.enabled && hasStream && isGameViewportReady && !isGloballyDisabled;
  const canShowStatusDetailIcon =
    config.enabled &&
    hasStream &&
    isGameViewportReady &&
    (state.status === "confirming" ||
      state.status === "cooldown" ||
      state.status === "alerted");
  const statusDetailIcon = canShowStatusDetailIcon
    ? getSpecialCoreStatusDetailIcon({ state, snapshot })
    : null;

  return (
    <section
      className={embedded ? "rune-alert-panel embedded-rune-alert-panel" : "rune-alert-panel"}
    >
      <div className="panel-heading rune-heading">
        <div>
          <div className="rune-title-row">
            <PanelStatusIndicator
              isActive={isSpecialCorePanelActive}
              isEnabled={config.enabled}
              label="특수 코어 알림"
            />
            <h2>특수 코어 알림</h2>
            <SpecialCoreHeaderTooltipBadge
              id="special-core-alert-beta-tooltip"
              ariaLabel="특수 코어 알림 베타 안내"
              className="rune-beta-badge special-core-header-tooltip-badge"
              content={
                <TooltipHelpContent
                  title="우상단 버프칸에서 특수코어 발동을 감지합니다."
                  items={[
                    "명확한 재사용 대기시간이 존재하는 특수코어만 사용 가능합니다. ex, 일격필살",
                    "특수코어가 보이면 설정한 재사용 대기시간을 기준으로 다음 알림을 계산합니다.",
                    "특수코어 아이콘은 짧게 나타날 수 있어 화면 공유 상태에서만 확인할 수 있습니다.",
                    "중간에 켠 경우 이미 지나간 발동은 알 수 없으므로 다음 발동부터 감지합니다.",
                  ]}
                />
              }
              width={500}
            >
              베타
            </SpecialCoreHeaderTooltipBadge>
            <AlertChecklistBadge
              id="special-core-checklist"
              label="특수 코어 알림 체크리스트"
              title="특수 코어 알림 전 확인해주세요."
              items={SPECIAL_CORE_CHECKLIST_ITEMS}
              width={430}
            />
            <SpecialCoreHeaderTooltipBadge
              id="special-core-favorite-guide-tooltip"
              ariaLabel="특수코어 즐겨찾기 제외 안내"
              className="janus-buff-duration-guide-chip special-core-favorite-guide-chip"
              content={
                <div className="janus-buff-duration-guide-content">
                  <strong>특수코어 버프칸 설정</strong>
                  <p>특수코어를 버프 즐겨찾기에서 제외해 주세요.</p>
                  <video
                    aria-label="특수코어 버프칸 설정 예시"
                    autoPlay
                    loop
                    muted
                    playsInline
                    preload="metadata"
                    src="/media/special-core-favorite-settings-guide.mp4"
                  />
                </div>
              }
              width={440}
            >
              즐겨찾기 제외
            </SpecialCoreHeaderTooltipBadge>
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
          <table className="rune-table buff-expiry-table special-core-table">
            <colgroup>
              <col className="col-buff-enabled" />
              <col className="col-buff-detail" />
              <col className="col-buff-count" />
              <col className="col-buff-threshold" />
              <col className="col-buff-alert-countdown" />
              <col className="col-buff-last-alert" />
              <col className="col-buff-status" />
              <col className="col-buff-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>활성</th>
                <th>상태 설명</th>
                <th>특수코어 쿨타임</th>
                <th>카운트다운 시작</th>
                <th>남은 쿨타임</th>
                <th>마지막 알림</th>
                <th>상태</th>
                <th aria-label="특수 코어 알림 조작" />
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
                      <SpecialCoreStatusDetailMetric
                        detail={statusView.detail}
                        detectedIcon={statusDetailIcon}
                      />
                    </CompactMetricCell>
                  </td>
                  <td>
                    <CompactAlertThresholdEditor
                      ariaLabel="특수코어 쿨타임"
                      disabled={isGloballyDisabled}
                      label="특수코어 쿨타임"
                      max={MAX_SPECIAL_CORE_COOLDOWN_SECONDS}
                      min={MIN_SPECIAL_CORE_COOLDOWN_SECONDS}
                      rangeHint={`${MIN_SPECIAL_CORE_COOLDOWN_SECONDS}-${MAX_SPECIAL_CORE_COOLDOWN_SECONDS}초`}
                      suffix="초"
                      value={config.cooldownSeconds}
                      onCommit={(value) => onChange({ cooldownSeconds: value })}
                    />
                  </td>
                  <td>
                    <CompactAlertThresholdEditor
                      ariaLabel="특수코어 카운트다운 시작"
                      disabled={isGloballyDisabled}
                      label="카운트다운 시작"
                      max={MAX_SPECIAL_CORE_ALERT_LEAD_SECONDS}
                      min={MIN_SPECIAL_CORE_ALERT_LEAD_SECONDS}
                      rangeHint={`${MIN_SPECIAL_CORE_ALERT_LEAD_SECONDS}-${MAX_SPECIAL_CORE_ALERT_LEAD_SECONDS}초`}
                      suffix="초 전"
                      value={config.alertLeadSeconds}
                      onCommit={(value) => onChange({ alertLeadSeconds: value })}
                    />
                  </td>
                  <td>
                    <CompactMetricCell label="남은 쿨타임">
                      <SpecialCoreCooldownRemainingMetric cooldownEndsAt={state.cooldownEndsAt} now={now} />
                    </CompactMetricCell>
                  </td>
                  <td>
                    <CompactMetricCell label="마지막 알림">
                      <RelativeSecondsMetric timestamp={state.lastAlertedAt} now={now} />
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
                        aria-label={isExpanded ? "특수 코어 알림 설정 접기" : "특수 코어 알림 설정 펼치기"}
                        className="icon-button small expand-toggle-button"
                        type="button"
                        tooltip={isExpanded ? "설정 접기" : "설정 펼치기"}
                        tooltipId="special-core-row-expand-tooltip"
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
                  sounds={getSpecialCoreAlertSounds()}
                  volume={config.volume}
                  volumeWarningKey="special-core"
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
                    showDebug ? (
                      <SpecialCoreDebugContent state={state} snapshot={snapshot} />
                    ) : null
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

function SpecialCoreHeaderTooltipBadge({
  ariaLabel,
  className,
  children,
  content,
  width,
}: {
  id: string;
  ariaLabel: string;
  className: string;
  children: ReactNode;
  content: ReactNode;
  width: number;
}) {
  return (
    <MapleHoverCard
      className="special-core-header-hover-card"
      content={content}
      width={width}
    >
      <button
        aria-label={ariaLabel}
        className={className}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        {children}
      </button>
    </MapleHoverCard>
  );
}

function SpecialCoreCooldownRemainingMetric({
  cooldownEndsAt,
  now,
}: {
  cooldownEndsAt: number | null;
  now: number;
}) {
  if (cooldownEndsAt === null) {
    return <span className="compact-metric-placeholder">--</span>;
  }

  const remainingMs = cooldownEndsAt - now;
  if (remainingMs <= 0) {
    return <span className="compact-metric-plain-value">준비됨</span>;
  }

  const seconds = getSpecialCoreRemainingSecondsForDisplay({ cooldownEndsAt, now }) ?? 0;
  if (seconds <= 0) {
    return <span className="compact-metric-plain-value">1초 미만</span>;
  }

  return (
    <span className="animated-inline-number animated-seconds-value" aria-label={`${seconds}초`}>
      <AnimatedNumber ariaHidden className="animated-inline-number-flow" value={seconds} />
      <span>초</span>
    </span>
  );
}

function getSpecialCoreStatusDetailIcon({
  state,
  snapshot,
}: {
  state: SpecialCoreRuntimeState;
  snapshot: SpecialCoreSnapshot | null;
}): SpecialCoreCandidateIcon | null {
  const confirmedIcon = state.activationEvidence?.confirmationIcons[0] ?? null;
  if (confirmedIcon) {
    return confirmedIcon;
  }
  return snapshot?.detectedIcon ?? state.lastDetectedIcon;
}

function SpecialCoreStatusDetailMetric({
  detail,
  detectedIcon,
}: {
  detail: string;
  detectedIcon: SpecialCoreCandidateIcon | null;
}) {
  if (!detectedIcon) {
    return <span className="status-detail-metric-value">{detail}</span>;
  }

  return (
    <span
      className="skill-buff-duration-summary special-core-status-detection"
      aria-label={`특수코어 매칭 ${detectedIcon.match.score.toFixed(2)} · ${detail}`}
    >
      <ImageDataCanvas
        className="skill-buff-duration-summary-icon special-core-status-detection-icon"
        image={detectedIcon.icon}
        ariaLabel="감지된 특수코어 아이콘"
      />
      <span className="skill-buff-duration-summary-copy">
        <span className="skill-buff-duration-summary-text">{detail}</span>
      </span>
    </span>
  );
}

function SpecialCoreDebugContent({
  state,
  snapshot,
}: {
  state: SpecialCoreRuntimeState;
  snapshot: SpecialCoreSnapshot | null;
}) {
  const candidates = snapshot?.candidateIcons.slice(0, 8) ?? [];
  return (
    <div className="special-core-debug-content">
      <div className="buff-expiry-debug-grid">
        <div>
          <span>버프칸</span>
          <strong>
            <AnimatedMetricText value={state.boxCount} />
          </strong>
        </div>
        <div>
          <span>매칭</span>
          <strong>
            <AnimatedMetricText value={state.detectedCount} />
          </strong>
        </div>
        <div>
          <span>처리</span>
          <strong>{snapshot?.performance.totalMs ?? "--"}ms</strong>
        </div>
      </div>
      {candidates.length ? (
        <div className="special-core-candidate-strip">
          {candidates.map((candidate) => (
            <SpecialCoreCandidatePreview key={`${candidate.boxIndex}-${candidate.match.score}`} candidate={candidate} />
          ))}
        </div>
      ) : (
        <p className="special-core-debug-empty">최근 후보가 없습니다.</p>
      )}
    </div>
  );
}

function SpecialCoreCandidatePreview({ candidate }: { candidate: SpecialCoreCandidateIcon }) {
  return (
    <div className={candidate.match.matched ? "special-core-candidate matched" : "special-core-candidate"}>
      <SpecialCoreIconPreview icon={candidate.icon} />
      <span>{candidate.match.score.toFixed(2)}</span>
    </div>
  );
}

function SpecialCoreIconPreview({ icon }: { icon: SpecialCoreIcon }) {
  return <ImageDataCanvas image={icon} className="special-core-icon-preview" />;
}
