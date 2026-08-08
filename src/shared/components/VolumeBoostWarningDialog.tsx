import { Play, X } from "lucide-react";
import { type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { getVolumePercentLabel } from "../../lib/volume";
import { MotionDialogFrame } from "./MotionDialogFrame";

export function VolumeBoostWarningDialog({
  volume,
  onPreview,
  onCancel,
  onConfirm,
}: {
  volume: number;
  onPreview: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const stopClick = (event: MouseEvent) => event.stopPropagation();
  const volumeLabel = getVolumePercentLabel(volume);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <MotionDialogFrame
      backdropClassName="confirm-backdrop volume-boost-backdrop"
      dialogClassName="confirm-dialog volume-boost-dialog"
      dialogRole="alertdialog"
      labelledBy="volume-boost-title"
      onBackdropClick={stopClick}
      onDialogClick={stopClick}
    >
      <div className="volume-boost-header">
        <div>
          <p className="eyebrow">Sound Check</p>
          <h2 id="volume-boost-title">{volumeLabel} 볼륨을 확인해 주세요.</h2>
          <p>
            증폭 볼륨은 환경에 따라 크게 들릴 수 있습니다. 적용 전에 짧게 들어볼 수 있어요.
          </p>
        </div>
        <button className="volume-boost-close-button" type="button" aria-label="닫기" onClick={onCancel}>
          <X size={18} />
        </button>
      </div>
      <button className="volume-boost-preview-card" type="button" onClick={onPreview}>
        <span className="volume-boost-play-orb" aria-hidden="true">
          <Play size={18} />
        </span>
        <span className="volume-boost-preview-copy">
          <strong>{volumeLabel} 미리 듣기</strong>
          <span>알림음이 실제로 들리는 크기를 먼저 확인합니다.</span>
        </span>
        <span className="volume-boost-wave" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      </button>
      <div className="confirm-actions volume-boost-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>
          취소
        </button>
        <button className="primary-button" type="button" onClick={onConfirm}>
          증폭 사용
        </button>
      </div>
    </MotionDialogFrame>,
    document.body,
  );
}
