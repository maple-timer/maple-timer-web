import { Switch } from "@astryxdesign/core/Switch";
import type { MouseEventHandler } from "react";

export function MotionSwitch({
  ariaLabel,
  checked,
  className = "",
  disabled = false,
  label,
  onClick,
  onChange,
}: {
  ariaLabel?: string;
  checked: boolean;
  className?: string;
  disabled?: boolean;
  label?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onChange: (checked: boolean) => void;
}) {
  const stateClass = checked ? "is-on" : "is-off";
  const disabledClass = disabled ? "is-disabled" : "";
  const accessibleLabel = ariaLabel ?? label ?? (checked ? "켜짐" : "꺼짐");

  return (
    <div
      className={["motion-switch", stateClass, disabledClass, className].filter(Boolean).join(" ")}
      data-astryx-theme="neutral"
      onClick={onClick}
    >
      <Switch
        className="motion-switch-control"
        label={accessibleLabel}
        isLabelHidden={!label}
        value={checked}
        isDisabled={disabled}
        onChange={(nextChecked) => onChange(nextChecked)}
      />
    </div>
  );
}
