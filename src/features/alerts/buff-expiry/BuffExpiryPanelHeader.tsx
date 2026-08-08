import { AlertChecklistBadge } from "../../../shared/components/AlertChecklistBadge";
import {
  InfoTooltip,
  TooltipHelpContent,
} from "../../../shared/components/FloatingTooltip";
import { PanelStatusIndicator } from "../../../shared/components/PanelStatusIndicator";
import { BuffExpirySupportedBuffChip } from "./BuffExpiryHeaderBadges";

export function BuffExpiryPanelHeader({
  isActive,
  isEnabled,
}: {
  isActive: boolean;
  isEnabled: boolean;
}) {
  return (
    <div className="rune-title-row">
      <div className="buff-expiry-title-main">
        <PanelStatusIndicator
          isActive={isActive}
          isEnabled={isEnabled}
          label="버프 종료 알림"
        />
        <h2>버프 종료 알림</h2>
      </div>
      <InfoTooltip
        id="buff-expiry-tooltip"
        label="버프 종료 알림 안내"
        displayLabel="사용 안내"
        className="capture-info-button named-info-tooltip"
        content={<BuffExpiryInfoTooltipContent />}
        width={430}
        fitContent
      />
      <AlertChecklistBadge
        id="buff-expiry-checklist"
        label="버프 종료 알림 체크리스트"
        title="버프 종료 알림 전 확인해주세요."
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
      <BuffExpirySupportedBuffChip />
    </div>
  );
}

function BuffExpiryInfoTooltipContent() {
  return (
    <TooltipHelpContent
      title="우상단 버프칸의 지원 버프 종료 시점을 추적합니다."
      items={[
        "지원 버프 아이콘과 남은 시간 흐름이 안정적으로 맞을 때 알림을 확정합니다.",
        "선택한 대상 그룹만 추적합니다.",
        "음수 알림은 버프가 끝난 뒤 N초 후에 울립니다.",
        "버프칸이 길라잡이 UI나 다른 창에 가려지면 감지하지 못할 수 있습니다.",
        "잘못 울리거나 놓친 경우 감지 제보를 보내주세요.",
      ]}
    />
  );
}
