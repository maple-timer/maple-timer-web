import { Slider } from "@astryxdesign/core/Slider";
import { type ReactNode, type SyntheticEvent, useMemo } from "react";

export function MotionVolumeSlider({
  label = "볼륨",
  value,
  valueLabel,
  ariaLabel,
  min = 0,
  max,
  step,
  disabled = false,
  boostThreshold,
  showValue = true,
  className,
  onChange,
  onPointerUp,
  onKeyUp,
  onBlur,
  onClick,
}: {
  label?: ReactNode;
  value: number;
  valueLabel: string;
  ariaLabel: string;
  min?: number;
  max: number;
  step: number;
  disabled?: boolean;
  boostThreshold?: number;
  showValue?: boolean;
  className?: string;
  onChange: (value: number) => void;
  onPointerUp?: () => void;
  onKeyUp?: () => void;
  onBlur?: () => void;
  onClick?: (event: SyntheticEvent) => void;
}) {
  const safeMax = Number.isFinite(max) && max > min ? max : min + 1;
  const safeValue = Math.min(safeMax, Math.max(min, Number.isFinite(value) ? value : min));
  const isBoosted = boostThreshold !== undefined && safeValue > boostThreshold;
  const sliderLabel = typeof label === "string" ? label : ariaLabel;
  const handleChangeEnd = () => {
    if (onPointerUp) {
      onPointerUp();
      return;
    }
    if (onKeyUp) {
      onKeyUp();
      return;
    }
    onBlur?.();
  };

  const classNames = useMemo(
    () =>
      [
        "motion-volume-slider",
        className,
        isBoosted ? "is-boosted" : "",
        disabled ? "is-disabled" : "",
      ]
        .filter(Boolean)
        .join(" "),
    [className, disabled, isBoosted],
  );

  return (
    <div className={classNames} data-astryx-theme="neutral" onClick={onClick}>
      {label !== null && <span className="motion-volume-label">{label}</span>}
      <span className="motion-volume-track-shell">
        <Slider
          className="motion-volume-astryx-slider"
          label={sliderLabel}
          isLabelHidden
          value={safeValue}
          min={min}
          max={safeMax}
          step={step}
          isDisabled={disabled}
          width="100%"
          valueDisplay="none"
          formatValue={() => valueLabel}
          onChange={onChange}
          onChangeEnd={handleChangeEnd}
          onBlur={onBlur}
        />
      </span>
      {showValue && <strong className="motion-volume-value">{valueLabel}</strong>}
    </div>
  );
}
