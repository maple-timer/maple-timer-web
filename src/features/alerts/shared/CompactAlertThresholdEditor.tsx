import { useEffect, useRef, useState, type MouseEvent } from "react";
import { AnimatedNumber } from "../../../shared/components/AnimatedNumber";
import { DeferredNumberInput } from "../../../shared/components/DeferredNumberInput";

export function CompactAlertThresholdEditor({
  ariaLabel,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  label = "알림",
  suffix,
  rangeHint,
  className = "",
  formatDisplayValue = (seconds) => ({
    value: seconds,
    suffix,
    label: `${seconds}${suffix}`,
  }),
  onCommit,
}: {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  label?: string;
  suffix: string;
  rangeHint?: string;
  className?: string;
  formatDisplayValue?: (value: number) => { value: number; suffix: string; label: string };
  onCommit: (value: number) => void;
}) {
  const [isEditing, setEditing] = useState(false);
  const editorRef = useRef<HTMLLabelElement | null>(null);
  const displayValue = formatDisplayValue(value);

  useEffect(() => {
    if (!isEditing) {
      return undefined;
    }

    const closeAfterCurrentEvent = () => {
      window.setTimeout(() => setEditing(false), 0);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!editorRef.current?.contains(event.target as Node)) {
        closeAfterCurrentEvent();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeAfterCurrentEvent();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isEditing]);

  const stopRowClick = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  if (isEditing && !disabled) {
    return (
      <label
        ref={editorRef}
        className={`threshold-editor hunt-threshold-editor compact-threshold-editor ${className}`}
        onBlur={(event) => {
          const currentTarget = event.currentTarget;
          window.setTimeout(() => {
            if (!currentTarget.contains(document.activeElement)) {
              setEditing(false);
            }
          }, 0);
        }}
        onClick={stopRowClick}
      >
        <span className="threshold-control" data-range-hint={rangeHint}>
          <DeferredNumberInput
            ariaLabel={ariaLabel}
            autoFocus
            className="threshold-input"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onCommit={(nextValue) => {
              onCommit(nextValue);
              setEditing(false);
            }}
            onEditingComplete={() => setEditing(false)}
          />
        </span>
        <span className="threshold-unit">{displayValue.suffix}</span>
      </label>
    );
  }

  return (
    <button
      aria-label={`${ariaLabel}: ${displayValue.label}`}
      className={`compact-threshold-trigger ${className}`}
      disabled={disabled}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
    >
      <span className="compact-threshold-label">{label}</span>
      <span className="compact-threshold-value">
        <AnimatedNumber
          ariaHidden
          className="compact-threshold-number animated-inline-number-flow"
          value={displayValue.value}
        />
        <span>{displayValue.suffix}</span>
      </span>
    </button>
  );
}
