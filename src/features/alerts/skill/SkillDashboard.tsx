import { Plus, Shuffle } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { SkillSnapshot } from "../../../alertTypes";
import { getSkillBuffDurationTargetForSkill } from "../../../lib/skillBuffDuration/skillBuffDurationTargets";
import { createRuntimeState } from "../../../lib/timer";
import type { SkillConfig, SkillRuntimeState } from "../../../types";
import {
  FloatingTooltipButton,
  FloatingTooltipPortal,
  getFloatingTooltipPosition,
  InfoTooltip,
  TooltipHelpContent,
  type FloatingTooltipState,
} from "../../../shared/components/FloatingTooltip";
import { AlertChecklistBadge } from "../../../shared/components/AlertChecklistBadge";
import { MapleHoverCard } from "../../../shared/components/MapleHoverCard";
import { SkillDashboardRow } from "./SkillDashboardRow";
import { MotionCollapse } from "../../../shared/components/MotionCollapse";
import { PanelStatusIndicator } from "../../../shared/components/PanelStatusIndicator";

export {
  getSkillRowVisualState,
  SKILL_STATUS_LABELS as STATUS_LABELS,
} from "./skillDashboardUtils";

function SkillSampleGuideBadge() {
  return (
    <MapleHoverCard
      className="skill-sample-guide-hover-card"
      content={
        <div className="skill-sample-guide-tooltip-content">
          <strong>내 직업 설치기도 지원하고 싶다면</strong>
          <ul>
            <li>직업 설치기는 직업마다 버프 아이콘이 달라 실제 사냥 영상 샘플이 필요합니다.</li>
            <li>우상단 버프칸이 보이는 사냥 영상을 유튜브에 업로드한 뒤 링크를 보내주세요.</li>
            <li>영상은 길수록 도움이 되며 닉네임, 채팅, 미니맵은 가려도 괜찮습니다.</li>
          </ul>
        </div>
      }
      width={640}
    >
      <button
        aria-label="내 직업 설치기 지원 안내"
        className="skill-sample-guide-badge"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        내 직업 설치기
      </button>
    </MapleHoverCard>
  );
}

function SkillBuffDurationRealtimeUpdateBadge() {
  return (
    <MapleHoverCard
      className="skill-realtime-update-hover-card"
      content={
        <div className="skill-realtime-update-tooltip-content">
          <TooltipHelpContent
            title="버프칸 스킬 감지는 계속 업데이트 중입니다."
            items={[
              "버프칸에서 남은 시간을 읽는 스킬 감지 기준을 제보 기반으로 계속 보강하고 있습니다.",
              "지원 스킬이 감지되지 않거나 잘못 잡히면 제보하기를 보내주세요.",
              "최근 업데이트 : 6월 28일 17:02",
            ]}
          />
        </div>
      }
      width={520}
    >
      <button
        aria-label="버프칸 스킬 감지 업데이트 안내"
        className="buff-expiry-feedback-indicator testing"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <span className="buff-expiry-feedback-dot" aria-hidden="true" />
        실시간 업데이트 중
      </button>
    </MapleHoverCard>
  );
}

function InitialAlertJitterTooltipContent() {
  return (
    <div className="skill-initial-jitter-tooltip-content">
      <TooltipHelpContent
        title="최초 알림에만 랜덤 지연을 더합니다."
        items={[
          "매 사이클 0~2초 사이에서 늦춰 울립니다.",
          "지연 시간은 0.5초 단위로 새로 정합니다.",
          "반복 알림에는 적용되지 않습니다.",
        ]}
      />
    </div>
  );
}

export function SkillDashboard({
  skills,
  states,
  snapshots,
  selectedSkillId,
  expandedSkillIds,
  hasStream,
  isGameViewportReady = true,
  canPickRegion,
  currentLayoutKey = null,
  showDebugColumns = false,
  isGloballyDisabled = false,
  initialAlertJitterEnabled = false,
  alertVolume,
  onSelectSkill,
  onToggleExpandedSkill,
  onAddSkill,
  onInitialAlertJitterEnabledChange,
  onChangeSkill,
  onDeleteSkill,
  onOpenRegionPicker,
  onPreviewSound,
  onSubmitMisreadReport = () => undefined,
  submittingMisreadSkillId = null,
  embedded = false,
  headerAction,
  isSectionCollapsed = false,
}: {
  skills: SkillConfig[];
  states: Record<string, SkillRuntimeState>;
  snapshots: Record<string, SkillSnapshot>;
  selectedSkillId: string;
  expandedSkillIds: string[];
  hasStream: boolean;
  isGameViewportReady?: boolean;
  canPickRegion: boolean;
  currentLayoutKey?: string | null;
  showDebugColumns?: boolean;
  isGloballyDisabled?: boolean;
  initialAlertJitterEnabled?: boolean;
  alertVolume: number;
  onSelectSkill: (id: string) => void;
  onToggleExpandedSkill: (id: string) => void;
  onAddSkill: () => void;
  onInitialAlertJitterEnabledChange?: (enabled: boolean) => void;
  onChangeSkill: (skillId: string, patch: Partial<SkillConfig>) => void;
  onAlertVolumeChange: (volume: number) => void;
  onDeleteSkill: (id: string) => void;
  onOpenRegionPicker: (id: string) => void;
  onPreviewSound: (soundId: string, volume: number) => void;
  onSubmitMisreadReport?: (id: string) => void;
  submittingMisreadSkillId?: string | null;
  embedded?: boolean;
  headerAction?: ReactNode;
  isSectionCollapsed?: boolean;
}) {
  const now = Date.now();
  const hasEnabledSkill = skills.some((skill) => skill.enabled);
  const isSkillPanelActive =
    hasEnabledSkill && hasStream && isGameViewportReady && !isGloballyDisabled;
  const hasBuffDurationSkill = skills.some((skill) => Boolean(getSkillBuffDurationTargetForSkill(skill)));
  const [floatingTooltip, setFloatingTooltip] = useState<FloatingTooltipState | null>(null);
  const showFloatingTooltip = (id: string, text: string, target: HTMLElement) => {
    setFloatingTooltip({
      id,
      text,
      anchor: target,
      ...getFloatingTooltipPosition(target),
    });
  };
  const showInitialJitterTooltip = (target: HTMLElement) => {
    const position = getFloatingTooltipPosition(target);
    setFloatingTooltip({
      id: "skill-initial-jitter-tooltip",
      content: <InitialAlertJitterTooltipContent />,
      anchor: target,
      left: position.left,
      top: position.top,
      placement: position.placement,
      fitContent: true,
    });
  };
  const hideFloatingTooltip = () => setFloatingTooltip(null);

  return (
    <section className={embedded ? "dashboard-panel embedded-dashboard-panel" : "dashboard-panel"}>
      <div className="panel-heading compact">
        <div>
          <div className="dashboard-title-row">
            <PanelStatusIndicator
              isActive={isSkillPanelActive}
              isEnabled={hasEnabledSkill}
              label="스킬 알림"
            />
            <h2>스킬 알림</h2>
            <InfoTooltip
              id="alert-threshold-tooltip"
              label="알림 시점 안내"
              displayLabel="사용 안내"
              className="column-info-button skill-threshold-info-button named-info-tooltip"
              iconSize={14}
              content={
                <div className="skill-threshold-tooltip-content">
                  <TooltipHelpContent
                    title="스킬 종류에 맞춰 남은 시간을 계산합니다."
                    items={[
                      "퀵슬롯 스킬은 선택한 아이콘의 쿨타임 숫자를 읽어 설치기 종료 시점을 추정합니다.",
                      "정밀 스킬은 우상단 버프칸의 아이콘과 남은 시간을 읽어 종료 시점을 계산합니다.",
                      "자석펫으로 솔 야누스 시간이 연장되어도 버프칸 감지는 갱신된 남은 시간에 맞춰 알림을 보정합니다.",
                      "알림 시점은 스킬이 끝나기 N초 전이며, 음수는 끝난 뒤 N초 후 알림입니다.",
                      "반복 알림은 최초 알림 이후에만 추가로 울립니다.",
                      "감지가 불안정하면 해당 행의 감지 제보를 보내주세요.",
                    ]}
                  />
                </div>
              }
              width={640}
            />
            <AlertChecklistBadge
              id="skill-alert-checklist"
              label="스킬 알림 체크리스트"
              title="스킬 알림 전 확인해주세요."
              items={[
                "확장 UI를 사용한다면 화면 공유 메뉴에서 게임 영역을 설정해주세요.",
                <>
                  인게임 설정 &gt; UI &gt; 퀵슬롯&버프 시간표시는 [중앙, 크게]를 권장합니다.
                  <img
                    className="alert-checklist-image"
                    src="/media/quickslot-buff-time-large-center.png"
                    alt="퀵슬롯과 버프 시간 표시가 중앙, 크게로 설정된 예시"
                  />
                </>,
                <>
                  인게임 설정 &gt; UI &gt; 버프 정렬 옵션을 모두 켜주세요.
                </>,
                <>
                  인게임 설정 &gt; UI &gt; 퀵슬롯&버프표시방식은 [분 + 초]를 권장합니다.
                  <img
                    className="alert-checklist-image"
                    src="/media/buff-sort-options.png"
                    alt="버프 표시 방식, 자동 정렬 적용, 버프 최소화 기능 사용 설정 예시"
                  />
                </>,
              ]}
              width={430}
            />
            <SkillSampleGuideBadge />
            {hasBuffDurationSkill && <SkillBuffDurationRealtimeUpdateBadge />}
          </div>
        </div>
        <div className="panel-heading-actions">
          {!isSectionCollapsed && (
            <>
              {onInitialAlertJitterEnabledChange && (
                <button
                  aria-label={
                    initialAlertJitterEnabled
                      ? "최초 알림 랜덤 지연 끄기"
                      : "최초 알림 랜덤 지연 켜기"
                  }
                  aria-pressed={initialAlertJitterEnabled}
                  aria-describedby="skill-initial-jitter-tooltip"
                  className={[
                    "panel-heading-ghost-button",
                    "skill-initial-jitter-toggle",
                    initialAlertJitterEnabled ? "is-active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  onBlur={hideFloatingTooltip}
                  onClick={(event) => {
                    event.stopPropagation();
                    onInitialAlertJitterEnabledChange(!initialAlertJitterEnabled);
                  }}
                  onFocus={(event) => {
                    showInitialJitterTooltip(event.currentTarget);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      hideFloatingTooltip();
                    }
                  }}
                  onMouseEnter={(event) => {
                    showInitialJitterTooltip(event.currentTarget);
                  }}
                  onMouseLeave={hideFloatingTooltip}
                >
                  <Shuffle size={15} strokeWidth={1.9} aria-hidden="true" />
                  <span>랜덤 지연</span>
                </button>
              )}
              <FloatingTooltipButton
                aria-label="스킬 추가"
                className="panel-heading-icon-button panel-heading-add-button"
                tooltip="스킬 추가"
                tooltipId="skill-add-tooltip"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onAddSkill();
                }}
              >
                <Plus size={19} strokeWidth={1.9} />
              </FloatingTooltipButton>
            </>
          )}
          {headerAction}
        </div>
      </div>

      <MotionCollapse
        className="alert-section-body"
        isCollapsed={isSectionCollapsed}
        aria-hidden={isSectionCollapsed}
      >
          <div className="skill-table-wrap" onScroll={hideFloatingTooltip}>
            <div className={showDebugColumns ? "skill-table debug" : "skill-table"} role="table">
              <div className="skill-table-body" role="rowgroup">
                {skills.length === 0 ? (
                  <button
                    className="empty-alert-state empty-alert-state--interactive skill-empty-state"
                    type="button"
                    aria-label="빈 스킬 알림 추가"
                    onClick={onAddSkill}
                  >
                    <span className="empty-alert-state-copy">
                      <strong>등록된 스킬 알림이 없습니다</strong>
                      <span>오른쪽 + 버튼으로 새 알림을 추가할 수 있습니다.</span>
                    </span>
                    <span className="empty-alert-state-action" aria-hidden="true">
                      <Plus size={17} strokeWidth={1.9} />
                      스킬 추가
                    </span>
                  </button>
                ) : (
                  skills.map((skill) => (
                    <SkillDashboardRow
                      key={skill.id}
                      skill={skill}
                      state={states[skill.id] ?? createRuntimeState(skill.id)}
                      snapshot={snapshots[skill.id]}
                      now={now}
                      selectedSkillId={selectedSkillId}
                      isExpanded={expandedSkillIds.includes(skill.id)}
                      hasStream={hasStream}
                      isGameViewportReady={isGameViewportReady}
                      canPickRegion={canPickRegion}
                      currentLayoutKey={currentLayoutKey}
                      showDebugColumns={showDebugColumns}
                      isGloballyDisabled={isGloballyDisabled}
                      isSubmittingMisread={submittingMisreadSkillId === skill.id}
                      onSelectSkill={onSelectSkill}
                      onToggleExpandedSkill={onToggleExpandedSkill}
                      onChangeSkill={onChangeSkill}
                      onDeleteSkill={onDeleteSkill}
                      onOpenRegionPicker={onOpenRegionPicker}
                      onPreviewSound={onPreviewSound}
                      onSubmitMisreadReport={onSubmitMisreadReport}
                      showFloatingTooltip={showFloatingTooltip}
                      hideFloatingTooltip={hideFloatingTooltip}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
      </MotionCollapse>
      {!isSectionCollapsed && floatingTooltip && (
        <FloatingTooltipPortal tooltip={floatingTooltip} onDismiss={hideFloatingTooltip} />
      )}
    </section>
  );
}
