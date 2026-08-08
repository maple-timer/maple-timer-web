import { m as motion, useReducedMotion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { selectedPillTransition } from "../motionPresets";

export type MotionSegmentedControlOption<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
  tooltip?: string;
  tooltipAlign?: "end";
};

export function MotionSegmentedControl<T extends string>({
  ariaLabel,
  className,
  optionClassName,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  className: string;
  optionClassName: string;
  options: Array<MotionSegmentedControlOption<T>>;
  value: T;
  onChange: (value: T) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const style = {
    "--motion-segment-count": options.length,
  } as CSSProperties;

  return (
    <div
      className={`motion-segmented-control ${className}`.trim()}
      role="group"
      aria-label={ariaLabel}
      style={style}
    >
      <motion.span
        className="motion-segmented-control-pill"
        aria-hidden="true"
        initial={false}
        animate={{ x: `${selectedIndex * 100}%` }}
        transition={shouldReduceMotion ? { duration: 0 } : selectedPillTransition}
      />
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            className={`${optionClassName}${selected ? " selected" : ""}`}
            type="button"
            aria-pressed={selected}
            disabled={option.disabled}
            data-header-tooltip={option.tooltip}
            data-header-tooltip-align={option.tooltipAlign}
            onClick={() => {
              if (!selected) {
                onChange(option.value);
              }
            }}
          >
            {option.icon}
            <span>{option.label}</span>
            {option.badge}
          </button>
        );
      })}
    </div>
  );
}
