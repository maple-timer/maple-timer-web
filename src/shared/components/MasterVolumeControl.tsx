import { Popover } from "@astryxdesign/core/Popover";
import { ChevronDown, Play, Volume2 } from "lucide-react";
import { useState } from "react";
import { clampMasterVolume, getMasterVolumePercentLabel } from "../../lib/volume";
import { MotionVolumeSlider } from "./MotionVolumeSlider";

export function MasterVolumeControl({
  volume,
  onChange,
  onPreview,
}: {
  volume: number;
  onChange: (volume: number) => void;
  onPreview: () => void;
}) {
  const [isOpen, setOpen] = useState(false);
  const normalizedVolume = clampMasterVolume(volume);
  const percentLabel = getMasterVolumePercentLabel(normalizedVolume);

  return (
    <div className="master-volume-control" data-astryx-theme="neutral">
      <Popover
        className="master-volume-popover"
        label="마스터 볼륨 설정"
        placement="below"
        alignment="end"
        width="min(330px, calc(100vw - 32px))"
        isOpen={isOpen}
        onOpenChange={setOpen}
        hasAutoFocus={false}
        hasCloseButton={false}
        content={
          isOpen ? (
            <>
              <div className="master-volume-popover-header">
                <span>마스터 볼륨</span>
                <strong>{percentLabel}</strong>
              </div>
              <MotionVolumeSlider
                className="master-volume-slider"
                label={null}
                value={Math.round(normalizedVolume * 100)}
                valueLabel={percentLabel}
                ariaLabel="마스터 볼륨"
                max={100}
                step={5}
                showValue={false}
                onChange={(value) => onChange(value / 100)}
              />
              <p>
                모든 알림 소리에 공통으로 적용됩니다. 스킬별 볼륨 설정은 그대로 유지됩니다.
              </p>
              <button
                className="master-volume-preview-button"
                type="button"
                onClick={onPreview}
              >
                <Play size={15} />
                미리 듣기
              </button>
            </>
          ) : null
        }
      >
        {({ ref, onClick, ...triggerProps }) => (
          <button
            ref={(element) => ref(element)}
            className="secondary-button master-volume-trigger"
            type="button"
            onClick={onClick}
            {...triggerProps}
          >
            <Volume2 size={16} />
            <span>마스터 볼륨</span>
            <strong>{percentLabel}</strong>
            <ChevronDown size={15} aria-hidden />
          </button>
        )}
      </Popover>
    </div>
  );
}
