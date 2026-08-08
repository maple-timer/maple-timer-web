import { BellRing, ChevronRight, Crosshair } from "lucide-react";
import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { isAlertIssueReportButtonDisabled } from "../../../application/reporting/alertIssueReportAvailability";
import { getSkillRegionForLayout, hasUsableRegion } from "../../../lib/regions";
import { DEFAULT_PICKER_ALERT_SOUNDS } from "../../../lib/sounds";
import { DEFAULT_REPEAT_ALERT_MAX_COUNT } from "../../../lib/repeatAlerts";
import type {
  UltimaRaidBossAlertConfig,
  UltimaRaidEquipmentAlertConfig,
} from "../../../types";
import type {
  UltimaRaidEquipmentRuntimeState,
  UltimaRaidEquipmentRuntimeStatus,
} from "../../../runtime/ultima-raid-equipment/ultimaRaidEquipmentAlertState";
import type {
  UltimaRaidBossRuntimeState,
  UltimaRaidBossRuntimeStatus,
} from "../../../runtime/ultima-raid-equipment/ultimaRaidBossAlertState";
import type { UltimaRaidEquipmentSnapshot } from "../../../runtime/ultima-raid-equipment/ultimaRaidEquipmentSnapshot";
import { AlertChecklistBadge } from "../../../shared/components/AlertChecklistBadge";
import { AlertEditorRow } from "../../../shared/components/AlertEditorRow";
import {
  CompactMetricCell,
  RelativeSecondsMetric,
} from "../../../shared/components/CompactMetricCell";
import {
  FloatingTooltipButton,
  InfoTooltip,
  TooltipHelpContent,
} from "../../../shared/components/FloatingTooltip";
import { ImageDataCanvas } from "../../../shared/components/ImageDataCanvas";
import { MotionCollapse } from "../../../shared/components/MotionCollapse";
import { MotionSwitch } from "../../../shared/components/MotionSwitch";
import { PanelStatusIndicator } from "../../../shared/components/PanelStatusIndicator";
import { RepeatIntervalPicker } from "../../../shared/components/RepeatIntervalPicker";
import { useExpandableRowController } from "../shared/useExpandableRowController";

type AlertRowStatusView = {
  label: string;
  className: string;
};

export function UltimaRaidEquipmentAlertPanel({
  config,
  state,
  snapshot,
  hasStream,
  canPickRegion,
  currentLayoutKey,
  isGloballyDisabled = false,
  onChange,
  onOpenRegionPicker,
  onPreviewSound,
  onSubmitIssueReport,
  onSubmitBossIssueReport,
  isSubmittingIssueReport = false,
  isSubmittingBossIssueReport = false,
  embedded = false,
  headerAction,
  isSectionCollapsed = false,
}: {
  config: UltimaRaidEquipmentAlertConfig;
  state: UltimaRaidEquipmentRuntimeState;
  snapshot: UltimaRaidEquipmentSnapshot | null;
  hasStream: boolean;
  canPickRegion: boolean;
  currentLayoutKey: string | null;
  isGloballyDisabled?: boolean;
  onChange: (patch: Partial<UltimaRaidEquipmentAlertConfig>) => void;
  onOpenRegionPicker: () => void;
  onPreviewSound: (soundId: string, volume: number) => void;
  onSubmitIssueReport?: () => void;
  onSubmitBossIssueReport?: () => void;
  isSubmittingIssueReport?: boolean;
  isSubmittingBossIssueReport?: boolean;
  embedded?: boolean;
  headerAction?: ReactNode;
  isSectionCollapsed?: boolean;
}) {
  const equipmentRow = useExpandableRowController();
  const bossRow = useExpandableRowController();
  const region = getSkillRegionForLayout(config, currentLayoutKey);
  const hasRegion = hasUsableRegion(region);
  const anyEnabled = config.enabled || config.bossAlert.enabled;
  const canUseRegionPicker =
    anyEnabled && canPickRegion && !isGloballyDisabled;
  const equipmentStatus: UltimaRaidEquipmentRuntimeStatus = !config.enabled
    ? "paused"
    : !hasStream
      ? "no-stream"
      : !hasRegion
        ? "no-region"
        : state.status;
  const bossStatus: UltimaRaidBossRuntimeStatus = !config.bossAlert.enabled
    ? "paused"
    : !hasStream
      ? "no-stream"
      : !hasRegion
        ? "no-region"
        : state.boss.status;
  const equipmentStatusView = getEquipmentStatusView(equipmentStatus, state);
  const bossStatusView = getBossStatusView(bossStatus);
  const isActive =
    anyEnabled && hasStream && hasRegion && !isGloballyDisabled;
  const now = Date.now();

  return (
    <section
      className={[
        "rune-alert-panel",
        "ultima-raid-equipment-alert-panel",
        embedded ? "embedded-rune-alert-panel" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <header className="panel-heading rune-heading">
        <span className="rune-title-row">
          <PanelStatusIndicator
            isActive={isActive}
            isEnabled={anyEnabled}
            label="울티마 스쿼드 알림"
          />
          <h2>울티마 스쿼드 알림</h2>
          <span className="rune-beta-badge">시험 운영</span>
          <InfoTooltip
            id="ultima-raid-alert-tooltip"
            label="울티마 스쿼드 알림 안내"
            displayLabel="사용 안내"
            className="capture-info-button named-info-tooltip"
            content={
              <TooltipHelpContent
                title="울티마 스쿼드에서 놓치기 쉬운 순간을 알려드립니다."
                items={[
                  "울티마 스쿼드 화면 전체를 한 번만 선택하면 두 알림이 같은 화면을 함께 확인합니다.",
                  "장비 가방이 가득 차면 장비 알림을 재생합니다.",
                  "하단 진행도가 100%로 바뀌며 보스가 등장하면 보스 알림을 재생합니다.",
                  "반복을 켜면 첫 알림 뒤 설정한 간격과 횟수만큼 추가로 재생합니다.",
                  "가방을 비우거나 다음 스테이지로 넘어가면 각각 다음 알림을 다시 기다립니다.",
                ]}
              />
            }
            width={440}
          />
          <AlertChecklistBadge
            id="ultima-raid-alert-checklist"
            label="울티마 스쿼드 알림 체크리스트"
            title="울티마 스쿼드 알림 전 확인해주세요."
            items={[
              "인게임 설정 > UI > UI 투명도 > 전투 시 UI 투명도 적용 옵션을 꺼주세요.",
            ]}
            width={430}
          />
        </span>
        {headerAction}
      </header>

      <MotionCollapse
        className="alert-section-body"
        isCollapsed={isSectionCollapsed}
        aria-hidden={isSectionCollapsed}
      >
        <SharedRaidRegion
          snapshot={snapshot}
          hasStream={hasStream}
          hasRegion={hasRegion}
          canUseRegionPicker={canUseRegionPicker}
          onOpenRegionPicker={onOpenRegionPicker}
        />

        <section className="rune-table-wrap">
          <table className="rune-table ultima-raid-alert-table">
            <colgroup>
              <col className="col-rune-enabled" />
              <col className="col-rune-crop" />
              <col className="col-rune-detail" />
              <col className="col-rune-candidate" />
              <col className="col-rune-repeat" />
              <col className="col-rune-last-alert" />
              <col className="col-rune-status" />
              <col className="col-rune-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>활성</th>
                <th>알림</th>
                <th>상태 설명</th>
                <th>감지 상태</th>
                <th>반복</th>
                <th>마지막 알림</th>
                <th>상태</th>
                <th aria-label="울티마 스쿼드 알림 조작" />
              </tr>
            </thead>
            <tbody>
              <UltimaRaidAlertRow
                rowId="ultima-raid-equipment"
                title="장비 가방"
                enabled={config.enabled}
                isGloballyDisabled={isGloballyDisabled}
                isExpanded={equipmentRow.isExpanded}
                onToggleExpanded={equipmentRow.toggleExpanded}
                onEnabledChange={(enabled) => onChange({ enabled })}
                detail={getEquipmentStatusDetail(equipmentStatus)}
                detection={formatBagState(snapshot)}
                repeatConfig={config}
                lastAlertedAt={state.lastAlertedAt}
                now={now}
                statusView={equipmentStatusView}
                soundId={config.soundId}
                volume={config.volume}
                volumeWarningKey="ultima-raid-equipment"
                reportDisabled={isAlertIssueReportButtonDisabled({
                  featureEnabled: config.enabled,
                  isGloballyDisabled,
                  hasReportPayload:
                    hasStream && hasRegion && Boolean(onSubmitIssueReport),
                })}
                isSubmittingReport={isSubmittingIssueReport}
                onSoundChange={(soundId) => onChange({ soundId })}
                onVolumeChange={(volume) => onChange({ volume })}
                onRepeatChange={(patch) => onChange(patch)}
                onPreviewSound={onPreviewSound}
                onSubmitReport={onSubmitIssueReport}
              />
              <UltimaRaidAlertRow
                rowId="ultima-raid-boss"
                title="보스 등장"
                enabled={config.bossAlert.enabled}
                isGloballyDisabled={isGloballyDisabled}
                isExpanded={bossRow.isExpanded}
                onToggleExpanded={bossRow.toggleExpanded}
                onEnabledChange={(enabled) =>
                  onChange({
                    bossAlert: {
                      ...config.bossAlert,
                      enabled,
                    },
                  })
                }
                detail={getBossStatusDetail(bossStatus)}
                detection={formatBossState(snapshot)}
                repeatConfig={config.bossAlert}
                lastAlertedAt={state.boss.lastAlertedAt}
                now={now}
                statusView={bossStatusView}
                soundId={config.bossAlert.soundId}
                volume={config.bossAlert.volume}
                volumeWarningKey="ultima-raid-boss"
                reportDisabled={isAlertIssueReportButtonDisabled({
                  featureEnabled: config.bossAlert.enabled,
                  isGloballyDisabled,
                  hasReportPayload:
                    hasStream && hasRegion && Boolean(onSubmitBossIssueReport),
                })}
                isSubmittingReport={isSubmittingBossIssueReport}
                onSoundChange={(soundId) =>
                  updateBossAlert(config.bossAlert, onChange, { soundId })
                }
                onVolumeChange={(volume) =>
                  updateBossAlert(config.bossAlert, onChange, { volume })
                }
                onRepeatChange={(patch) =>
                  updateBossAlert(config.bossAlert, onChange, patch)
                }
                onPreviewSound={onPreviewSound}
                onSubmitReport={onSubmitBossIssueReport}
              />
            </tbody>
          </table>
        </section>
      </MotionCollapse>
    </section>
  );
}

function SharedRaidRegion({
  snapshot,
  hasStream,
  hasRegion,
  canUseRegionPicker,
  onOpenRegionPicker,
}: {
  snapshot: UltimaRaidEquipmentSnapshot | null;
  hasStream: boolean;
  hasRegion: boolean;
  canUseRegionPicker: boolean;
  onOpenRegionPicker: () => void;
}) {
  return (
    <section className="ultima-raid-shared-region">
      <span className="ultima-raid-shared-region-preview">
        {snapshot?.previewImageData && hasRegion ? (
          canUseRegionPicker ? (
            <FloatingTooltipButton
              className="rune-crop-image-button"
              type="button"
              tooltip="공통 감지 화면 다시 선택"
              tooltipId="ultima-raid-crop-reselect-tooltip"
              onClick={onOpenRegionPicker}
            >
              <ImageDataCanvas
                image={snapshot.previewImageData}
                ariaLabel="울티마 스쿼드 공통 감지 화면 미리보기"
              />
            </FloatingTooltipButton>
          ) : (
            <span className="rune-crop-image-readonly">
              <ImageDataCanvas
                image={snapshot.previewImageData}
                ariaLabel="울티마 스쿼드 공통 감지 화면 미리보기"
              />
            </span>
          )
        ) : (
          <span className="ultima-raid-shared-region-placeholder">
            <Crosshair size={18} />
          </span>
        )}
      </span>
      <span className="ultima-raid-shared-region-copy">
        <strong>공통 감지 화면</strong>
        <small>
          장비 가방과 보스 등장을 함께 확인하므로 울티마 스쿼드 화면 전체를
          선택하세요.
        </small>
      </span>
      {canUseRegionPicker ? (
        <button
          className="inline-action-button ultima-raid-region-button"
          type="button"
          onClick={onOpenRegionPicker}
        >
          <Crosshair size={16} />
          {hasRegion ? "다시 선택" : "영역 선택"}
        </button>
      ) : (
        <span className="ultima-raid-shared-region-state">
          {!hasStream ? "화면 공유 필요" : !hasRegion ? "알림을 켜주세요" : "선택됨"}
        </span>
      )}
    </section>
  );
}

function UltimaRaidAlertRow({
  rowId,
  title,
  enabled,
  isGloballyDisabled,
  isExpanded,
  onToggleExpanded,
  onEnabledChange,
  detail,
  detection,
  repeatConfig,
  lastAlertedAt,
  now,
  statusView,
  soundId,
  volume,
  volumeWarningKey,
  reportDisabled,
  isSubmittingReport,
  onSoundChange,
  onVolumeChange,
  onRepeatChange,
  onPreviewSound,
  onSubmitReport,
}: {
  rowId: string;
  title: string;
  enabled: boolean;
  isGloballyDisabled: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onEnabledChange: (enabled: boolean) => void;
  detail: string;
  detection: string;
  repeatConfig: Pick<
    UltimaRaidBossAlertConfig,
    | "repeatAlertEnabled"
    | "repeatAlertIntervalSeconds"
    | "repeatAlertMaxCount"
  >;
  lastAlertedAt: number | null;
  now: number;
  statusView: AlertRowStatusView;
  soundId: string;
  volume: number;
  volumeWarningKey: string;
  reportDisabled: boolean;
  isSubmittingReport: boolean;
  onSoundChange: (soundId: string) => void;
  onVolumeChange: (volume: number) => void;
  onRepeatChange: (patch: Partial<UltimaRaidBossAlertConfig>) => void;
  onPreviewSound: (soundId: string, volume: number) => void;
  onSubmitReport?: () => void;
}) {
  const editorId = `${rowId}-alert-editor`;

  return (
    <Fragment>
      <tr
        aria-controls={editorId}
        aria-expanded={isExpanded}
        className={[
          "dashboard-row",
          "rune-dashboard-row",
          !enabled ? "is-disabled-row" : "",
          isExpanded ? "expanded-row" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={onToggleExpanded}
        onKeyDown={(event) => {
          if (!isToggleKey(event) || isInteractiveTarget(event.target)) {
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
            checked={enabled}
            disabled={isGloballyDisabled}
            label={enabled ? "켜짐" : "꺼짐"}
            onClick={stopRowClick}
            onChange={onEnabledChange}
          />
        </td>
        <td>
          <CompactMetricCell className="ultima-raid-alert-name">
            {title}
          </CompactMetricCell>
        </td>
        <td>
          <CompactMetricCell className="status-detail-metric-cell">
            <span className="status-detail-metric-value">{detail}</span>
          </CompactMetricCell>
        </td>
        <td>
          <CompactMetricCell label="감지 상태">{detection}</CompactMetricCell>
        </td>
        <td>
          <span className="rune-repeat-control" onClick={stopRowClick}>
            <span className="rune-repeat-label">반복</span>
            <RepeatIntervalPicker
              value={repeatConfig.repeatAlertIntervalSeconds ?? 3}
              className="compact-repeat-picker"
              disabled={isGloballyDisabled}
              ariaLabel={`${title} 반복 알림 설정`}
              disabledOptionLabel="사용 안 함"
              isDisabledOptionSelected={
                repeatConfig.repeatAlertEnabled !== true
              }
              maxCount={
                repeatConfig.repeatAlertMaxCount ??
                DEFAULT_REPEAT_ALERT_MAX_COUNT
              }
              allowContinuous={false}
              onChange={(seconds) =>
                onRepeatChange({
                  repeatAlertEnabled: true,
                  repeatAlertIntervalSeconds: seconds,
                  repeatAlertMaxCount:
                    repeatConfig.repeatAlertMaxCount ??
                    DEFAULT_REPEAT_ALERT_MAX_COUNT,
                })
              }
              onDisabledOptionSelect={() =>
                onRepeatChange({ repeatAlertEnabled: false })
              }
              onMaxCountChange={(count) =>
                onRepeatChange({
                  repeatAlertEnabled: true,
                  repeatAlertIntervalSeconds:
                    repeatConfig.repeatAlertIntervalSeconds ?? 3,
                  repeatAlertMaxCount:
                    count ?? DEFAULT_REPEAT_ALERT_MAX_COUNT,
                })
              }
            />
          </span>
        </td>
        <td>
          <CompactMetricCell label="마지막 알림">
            <RelativeSecondsMetric timestamp={lastAlertedAt} now={now} />
          </CompactMetricCell>
        </td>
        <td>
          <span className="rune-status-cell">
            <span className={`rune-status-chip ${statusView.className}`}>
              <BellRing size={15} />
              {statusView.label}
            </span>
          </span>
        </td>
        <td className="row-actions-cell">
          <span className="row-actions">
            <FloatingTooltipButton
              aria-expanded={isExpanded}
              aria-label={isExpanded ? `${title} 설정 접기` : `${title} 설정 펼치기`}
              className="icon-button small expand-toggle-button"
              type="button"
              tooltip={isExpanded ? "설정 접기" : "설정 펼치기"}
              tooltipId={`${rowId}-row-expand-tooltip`}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpanded();
              }}
            >
              <ChevronRight size={17} />
            </FloatingTooltipButton>
          </span>
        </td>
      </tr>
      <AlertEditorRow
        isExpanded={isExpanded}
        colSpan={8}
        editorId={editorId}
        rowClassName="inline-editor-row rune-editor-row"
        editorClassName="inline-skill-editor rune-inline-editor"
        editorLayout="command-rail"
        disabled={isGloballyDisabled}
        soundId={soundId}
        soundLabel="알림음"
        sounds={DEFAULT_PICKER_ALERT_SOUNDS}
        volume={volume}
        volumeWarningKey={volumeWarningKey}
        reportLabel="감지 제보"
        reportDisabled={reportDisabled}
        isSubmittingReport={isSubmittingReport}
        onSoundChange={onSoundChange}
        onVolumeChange={onVolumeChange}
        onSubmitReport={onSubmitReport}
        onPreviewSound={(volumeOverride) =>
          onPreviewSound(soundId, volumeOverride ?? volume)
        }
      />
    </Fragment>
  );
}

function updateBossAlert(
  current: UltimaRaidBossAlertConfig,
  onChange: (patch: Partial<UltimaRaidEquipmentAlertConfig>) => void,
  patch: Partial<UltimaRaidBossAlertConfig>,
) {
  onChange({
    bossAlert: {
      ...current,
      ...patch,
    },
  });
}

function stopRowClick(event: SyntheticEvent) {
  event.stopPropagation();
}

function isToggleKey(event: KeyboardEvent): boolean {
  return event.key === "Enter" || event.key === " ";
}

function isInteractiveTarget(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("button, input, select, textarea, a"))
  );
}

function formatBagState(snapshot: UltimaRaidEquipmentSnapshot | null): string {
  if (!snapshot) {
    return "--";
  }
  if (!snapshot.layoutValid) {
    return "영역 확인";
  }
  if (snapshot.bagCountState === "unreadable") {
    return "확인 중";
  }
  if (snapshot.bagFullDetected) {
    return "가득 참";
  }
  if (snapshot.fullBannerDetected) {
    return "확인 중";
  }
  return "여유 있음";
}

function formatBossState(snapshot: UltimaRaidEquipmentSnapshot | null): string {
  if (!snapshot) {
    return "--";
  }
  if (!snapshot.layoutValid) {
    return "영역 확인";
  }
  if (snapshot.bossProgressState === "boss") {
    return "보스 등장";
  }
  if (snapshot.bossProgressState === "normal") {
    return "진행 중";
  }
  return "확인 중";
}

function getEquipmentStatusView(
  status: UltimaRaidEquipmentRuntimeStatus,
  state: UltimaRaidEquipmentRuntimeState,
): AlertRowStatusView {
  if (status === "alerted") {
    return { label: "장비 감지", className: "alerted" };
  }
  if (status === "candidate") {
    return { label: "확인 중", className: "candidate" };
  }
  if (status === "unavailable") {
    return { label: "감지 오류", className: "unavailable" };
  }
  if (status === "invalid-region") {
    return { label: "영역 확인 필요", className: "unavailable" };
  }
  if (status === "waiting" && state.lastDetectedAt) {
    return { label: "사라짐", className: "waiting" };
  }

  const labels: Record<UltimaRaidEquipmentRuntimeStatus, string> = {
    paused: "꺼짐",
    "no-stream": "화면 공유 필요",
    "no-region": "영역 선택 필요",
    "invalid-region": "영역 확인 필요",
    waiting: "장비 대기",
    candidate: "확인 중",
    alerted: "장비 감지",
    unavailable: "감지 오류",
  };
  return { label: labels[status], className: status };
}

function getBossStatusView(
  status: UltimaRaidBossRuntimeStatus,
): AlertRowStatusView {
  const labels: Record<UltimaRaidBossRuntimeStatus, string> = {
    paused: "꺼짐",
    "no-stream": "화면 공유 필요",
    "no-region": "영역 선택 필요",
    "invalid-region": "영역 확인 필요",
    initializing: "진행도 확인",
    waiting: "보스 대기",
    candidate: "확인 중",
    active: "보스 감지",
    unavailable: "감지 오류",
  };
  const classNames: Record<UltimaRaidBossRuntimeStatus, string> = {
    paused: "paused",
    "no-stream": "no-stream",
    "no-region": "no-region",
    "invalid-region": "unavailable",
    initializing: "waiting",
    waiting: "waiting",
    candidate: "candidate",
    active: "alerted",
    unavailable: "unavailable",
  };
  return { label: labels[status], className: classNames[status] };
}

function getEquipmentStatusDetail(
  status: UltimaRaidEquipmentRuntimeStatus,
): string {
  const details: Record<UltimaRaidEquipmentRuntimeStatus, string> = {
    paused: "알림 꺼짐",
    "no-stream": "화면 공유 후 울티마 스쿼드 화면 선택",
    "no-region": "울티마 스쿼드 화면 영역 선택 필요",
    "invalid-region": "울티마 스쿼드 화면 전체를 다시 선택해주세요",
    waiting: "장비 가방이 가득 차는지 확인 중",
    candidate: "장비 가방 가득 참 확인 중",
    alerted: "장비 가방을 비울 때까지 다음 알림 대기",
    unavailable: "울티마 스쿼드 화면 영역을 다시 선택해주세요",
  };
  return details[status];
}

function getBossStatusDetail(status: UltimaRaidBossRuntimeStatus): string {
  const details: Record<UltimaRaidBossRuntimeStatus, string> = {
    paused: "알림 꺼짐",
    "no-stream": "화면 공유 후 울티마 스쿼드 화면 선택",
    "no-region": "울티마 스쿼드 화면 영역 선택 필요",
    "invalid-region": "울티마 스쿼드 화면 전체를 다시 선택해주세요",
    initializing: "현재 스테이지 진행도 확인 중",
    waiting: "보스 등장을 기다리는 중",
    candidate: "보스 등장 상태 확인 중",
    active: "다음 스테이지까지 다음 알림 대기",
    unavailable: "울티마 스쿼드 화면 영역을 다시 선택해주세요",
  };
  return details[status];
}
