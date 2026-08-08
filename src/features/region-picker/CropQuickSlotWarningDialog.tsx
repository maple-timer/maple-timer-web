import { AlertTriangle } from "lucide-react";
import { MotionDialogFrame } from "../../shared/components/MotionDialogFrame";
import type { CropPlacementWarningType } from "./cropSelectionUtils";

const WARNING_CONTENT: Record<
  CropPlacementWarningType,
  {
    title: string;
    description: string;
    items: string[];
    videoSrc: string;
    videoLabel: string;
  }
> = {
  "skill-quickslot": {
    title: "퀵슬롯 위치를 확인해주세요",
    description:
      "스킬 알림은 화면 오른쪽 아래의 움직이지 않는 퀵슬롯 스킬 아이콘을 기준으로 가장 안정적으로 동작합니다.",
    items: [
      "선택한 곳이 퀵슬롯 창의 스킬 아이콘인지 확인해주세요.",
      "버프 즐겨찾기 창이나 우상단 버프창을 선택하면 알림 시간이 꼬일 수 있습니다.",
      "예시처럼 여백 없이 스킬 아이콘 부분만 선택해주세요.",
    ],
    videoSrc: "/media/quickslot-crop-guide.mp4",
    videoLabel: "퀵슬롯 crop 좋은 예시와 나쁜 예시 영상",
  },
};

export function CropQuickSlotWarningDialog({
  warningType,
  onCancel,
  onConfirm,
}: {
  warningType: CropPlacementWarningType;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const content = WARNING_CONTENT[warningType];

  return (
    <MotionDialogFrame
      backdropClassName="crop-warning-layer"
      dialogClassName={`crop-warning-dialog type-${warningType}`}
      dialogRole="alertdialog"
      labelledBy="crop-warning-title"
    >
        <div className="crop-warning-icon">
          <AlertTriangle size={22} />
        </div>
        <div className="crop-warning-copy">
          <h3 id="crop-warning-title">{content.title}</h3>
          <p>{content.description}</p>
          <ul className="crop-warning-list">
            {content.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="crop-warning-media">
          <video
            src={content.videoSrc}
            aria-label={content.videoLabel}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
          />
        </div>
        <div className="crop-warning-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            다시 선택
          </button>
          <button className="primary-button" type="button" onClick={onConfirm}>
            그래도 적용
          </button>
        </div>
    </MotionDialogFrame>
  );
}
