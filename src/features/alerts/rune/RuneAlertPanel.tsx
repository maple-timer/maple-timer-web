import { type ReactNode } from "react";
import type { RuneRuntimeState, RuneSnapshot } from "../../../alertTypes";
import { useExpandableRowController } from "../shared/useExpandableRowController";
import type { RuneAlertConfig } from "../../../types";
import {
  InfoTooltip,
  TooltipHelpContent,
} from "../../../shared/components/FloatingTooltip";
import { MapleHoverCard } from "../../../shared/components/MapleHoverCard";
import { MotionCollapse } from "../../../shared/components/MotionCollapse";
import { PanelStatusIndicator } from "../../../shared/components/PanelStatusIndicator";
import { RuneAlertRow } from "./RuneAlertRow";

function RuneRealtimeUpdateBadge() {
  return (
    <MapleHoverCard
      className="rune-realtime-update-hover-card"
      content={
        <TooltipHelpContent
          title="룬 감지는 계속 업데이트 중입니다."
          items={[
            "룬 미감지나 오인식 제보를 바탕으로 감지 로직을 계속 보강하고 있습니다.",
            "룬이 떴는데 감지되지 않거나 다른 것을 룬으로 잡으면 감지 제보를 보내주세요.",
            "최근 업데이트 : 8월 6일 13:30",
          ]}
        />
      }
      width={430}
    >
      <button
        aria-label="룬 감지 업데이트 안내"
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

export function RuneAlertPanel({
  config,
  state,
  snapshot,
  hasStream,
  canPickRegion,
  currentLayoutKey,
  showDebug,
  isGloballyDisabled = false,
  onChange,
  onOpenRegionPicker,
  onResetDetection,
  onPreviewSound,
  onSubmitDebugSample,
  isSubmittingDebugSample,
  onSubmitFalsePositive,
  isSubmittingFalsePositive,
  embedded = false,
  headerAction,
  isSectionCollapsed = false,
}: {
  config: RuneAlertConfig;
  state: RuneRuntimeState;
  snapshot: RuneSnapshot | null;
  hasStream: boolean;
  canPickRegion: boolean;
  currentLayoutKey: string | null;
  showDebug: boolean;
  isGloballyDisabled?: boolean;
  onChange: (patch: Partial<RuneAlertConfig>) => void;
  onOpenRegionPicker: () => void;
  onResetDetection: () => void;
  alertVolume: number;
  onAlertVolumeChange: (volume: number) => void;
  onPreviewSound: (soundId: string, volume: number) => void;
  onSubmitDebugSample: () => void;
  isSubmittingDebugSample: boolean;
  onSubmitFalsePositive: () => void;
  isSubmittingFalsePositive: boolean;
  embedded?: boolean;
  headerAction?: ReactNode;
  isSectionCollapsed?: boolean;
}) {
  const now = Date.now();
  const { isExpanded, toggleExpanded } = useExpandableRowController();
  const isRunePanelActive = config.enabled && hasStream && !isGloballyDisabled;

  return (
    <section
      className={embedded ? "rune-alert-panel embedded-rune-alert-panel" : "rune-alert-panel"}
    >
      <div className="panel-heading rune-heading">
        <div>
          <div className="rune-title-row">
            <PanelStatusIndicator
              isActive={isRunePanelActive}
              isEnabled={config.enabled}
              label="룬 알림"
            />
            <h2>룬 알림</h2>
            <InfoTooltip
              id="rune-alert-tooltip"
              label="룬 알림 안내"
              displayLabel="사용 안내"
              className="capture-info-button named-info-tooltip"
              content={
                <TooltipHelpContent
                  title="선택한 미니맵 영역에서 룬 아이콘을 감지합니다."
                  items={[
                    "미니맵 내부 지도 영역만 선택하면 오탐이 줄어듭니다.",
                    "캐릭터와 룬이 겹쳐 있으면 감지되지 않을 수 있습니다.",
                    "마을이나 이벤트 UI가 미니맵을 가리면 오작동할 수 있습니다.",
                    "미감지나 오인식은 감지 제보로 보내주세요.",
                  ]}
                />
              }
              width={410}
            />
            <RuneRealtimeUpdateBadge />
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
          <table className="rune-table">
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
                <th>Crop</th>
                <th>상태 설명</th>
                <th>
                  <span className="column-help-label">
                    최근 감지
                    <InfoTooltip
                      id="rune-false-positive-tooltip"
                      label="룬 감지 제보 안내"
                      className="column-info-button"
                      iconSize={14}
                      content={
                        <TooltipHelpContent
                          title="감지가 이상하면 샘플을 보내주세요."
                          items={[
                            "최근 감지는 실제 룬 알림이 울린 후보만 표시합니다.",
                            "룬이 떴는데 감지가 안 되거나 다른 것을 룬으로 감지할 때 사용합니다.",
                            "오른쪽 화살표를 눌러 설정을 펼친 뒤 감지 제보를 눌러주세요.",
                            "보내주신 샘플을 확인해 감지 로직을 빠르게 수정하겠습니다.",
                          ]}
                        />
                      }
                      width={430}
                    />
                  </span>
                </th>
                <th>
                  <span className="column-help-label">
                    반복
                    <InfoTooltip
                      id="rune-repeat-alert-tooltip"
                      label="룬 반복 알림 안내"
                      className="column-info-button"
                      iconSize={14}
                      content={
                        <TooltipHelpContent
                          title="룬이 남아 있으면 다시 울립니다."
                          items={[
                            "룬 알림이 울린 뒤에도 룬이 계속 감지되면 선택한 간격으로 다시 알립니다.",
                            "반복 시점마다 룬이 실제로 감지되는지 다시 확인합니다.",
                          ]}
                        />
                      }
                      width={400}
                    />
                  </span>
                </th>
                <th>룬 감지</th>
                <th>상태</th>
                <th aria-label="룬 알림 조작" />
              </tr>
            </thead>
            <tbody>
              <RuneAlertRow
                config={config}
                state={state}
                snapshot={snapshot}
                now={now}
                isExpanded={isExpanded}
                hasStream={hasStream}
                canPickRegion={canPickRegion}
                currentLayoutKey={currentLayoutKey}
                showDebug={showDebug}
                isGloballyDisabled={isGloballyDisabled}
                isSubmittingDebugSample={isSubmittingDebugSample}
                isSubmittingFalsePositive={isSubmittingFalsePositive}
                onToggleExpanded={toggleExpanded}
                onChange={onChange}
                onOpenRegionPicker={onOpenRegionPicker}
                onResetDetection={onResetDetection}
                onPreviewSound={onPreviewSound}
                onSubmitDebugSample={onSubmitDebugSample}
                onSubmitFalsePositive={onSubmitFalsePositive}
              />
            </tbody>
          </table>
        </div>
      </MotionCollapse>
    </section>
  );
}
