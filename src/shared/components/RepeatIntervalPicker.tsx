import { Check } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import {
  normalizeRepeatAlertMaxCount,
  normalizeRepeatAlertIntervalSeconds,
  REPEAT_ALERT_MAX_COUNT_OPTIONS,
  REPEAT_ALERT_INTERVAL_OPTIONS,
} from "../../lib/repeatAlerts";
import { MotionDropdownChevron, MotionDropdownMenu } from "./MotionDropdown";

type RepeatIntervalPickerProps = {
  value?: number;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  disabledOptionLabel?: string;
  isDisabledOptionSelected?: boolean;
  maxCount?: number | null;
  allowContinuous?: boolean;
  onChange: (seconds: number) => void;
  onDisabledOptionSelect?: () => void;
  onMaxCountChange?: (count: number | null) => void;
};

function getRepeatIntervalLabel(seconds: number) {
  return `${seconds}초 간격`;
}

function getRepeatMaxCountLabel(count: number | null) {
  return count === null ? "계속 반복" : `${count}회 반복`;
}

function getRepeatSummaryLabel(seconds: number, count: number | null) {
  return `${seconds}초 · ${count === null ? "계속" : `${count}회`}`;
}

export function RepeatIntervalPicker({
  value,
  disabled = false,
  ariaLabel,
  className,
  disabledOptionLabel,
  isDisabledOptionSelected = false,
  maxCount,
  allowContinuous = true,
  onChange,
  onDisabledOptionSelect,
  onMaxCountChange,
}: RepeatIntervalPickerProps) {
  const [isOpen, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selectedInterval = normalizeRepeatAlertIntervalSeconds(value);
  const hasMaxCountOptions = Boolean(onMaxCountChange);
  const selectedMaxCount = normalizeRepeatAlertMaxCount(maxCount, null);
  const selectedLabel =
    disabledOptionLabel && isDisabledOptionSelected
      ? disabledOptionLabel
      : hasMaxCountOptions
        ? getRepeatSummaryLabel(selectedInterval, selectedMaxCount)
        : getRepeatIntervalLabel(selectedInterval);
  const closeMenu = useCallback(() => setOpen(false), []);

  return (
    <div className={["repeat-interval-picker", className].filter(Boolean).join(" ")} ref={pickerRef}>
      <button
        className="repeat-interval-picker-trigger"
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <span className="repeat-interval-picker-selected">{selectedLabel}</span>
        <MotionDropdownChevron isOpen={isOpen} />
      </button>

      <MotionDropdownMenu
        ariaLabel={ariaLabel}
        className={[
          "repeat-interval-picker-menu",
          hasMaxCountOptions ? "repeat-interval-picker-menu-wide" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled}
        id={listboxId}
        isOpen={isOpen}
        maxHeight={hasMaxCountOptions ? 260 : 180}
        minWidth={hasMaxCountOptions ? 252 : 128}
        pickerRef={pickerRef}
        triggerRef={triggerRef}
        onClose={closeMenu}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {disabledOptionLabel && onDisabledOptionSelect && (
          <button
            className={
              isDisabledOptionSelected
                ? "repeat-interval-picker-option selected"
                : "repeat-interval-picker-option"
            }
            type="button"
            role="option"
            aria-selected={isDisabledOptionSelected}
            onClick={(event) => {
              event.stopPropagation();
              onDisabledOptionSelect();
              closeMenu();
            }}
          >
            <span>{disabledOptionLabel}</span>
            {isDisabledOptionSelected && <Check size={15} aria-hidden="true" />}
          </button>
        )}
        {hasMaxCountOptions && onMaxCountChange ? (
          <div className="repeat-interval-picker-columns">
            <div className="repeat-interval-picker-column">
              <div className="repeat-interval-picker-section-label">간격</div>
              {REPEAT_ALERT_INTERVAL_OPTIONS.map((seconds) => {
                const isSelected = !isDisabledOptionSelected && seconds === selectedInterval;
                return (
                  <button
                    className={
                      isSelected
                        ? "repeat-interval-picker-option selected"
                        : "repeat-interval-picker-option"
                    }
                    key={seconds}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={(event) => {
                      event.stopPropagation();
                      onChange(seconds);
                      closeMenu();
                    }}
                  >
                    <span>{getRepeatIntervalLabel(seconds)}</span>
                    {isSelected && <Check size={15} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            <div className="repeat-interval-picker-column">
              <div className="repeat-interval-picker-section-label">반복 횟수</div>
              {REPEAT_ALERT_MAX_COUNT_OPTIONS.map((count) => {
                const isSelected = !isDisabledOptionSelected && selectedMaxCount === count;
                return (
                  <button
                    className={
                      isSelected
                        ? "repeat-interval-picker-option selected"
                        : "repeat-interval-picker-option"
                    }
                    key={count}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMaxCountChange(count);
                      closeMenu();
                    }}
                  >
                    <span>{getRepeatMaxCountLabel(count)}</span>
                    {isSelected && <Check size={15} aria-hidden="true" />}
                  </button>
                );
              })}
              {allowContinuous && (
                <button
                  className={
                    !isDisabledOptionSelected && selectedMaxCount === null
                      ? "repeat-interval-picker-option selected"
                      : "repeat-interval-picker-option"
                  }
                  type="button"
                  role="option"
                  aria-selected={!isDisabledOptionSelected && selectedMaxCount === null}
                  onClick={(event) => {
                    event.stopPropagation();
                    onMaxCountChange(null);
                    closeMenu();
                  }}
                >
                  <span>{getRepeatMaxCountLabel(null)}</span>
                  {!isDisabledOptionSelected && selectedMaxCount === null && (
                    <Check size={15} aria-hidden="true" />
                  )}
                </button>
              )}
            </div>
          </div>
        ) : (
          REPEAT_ALERT_INTERVAL_OPTIONS.map((seconds) => {
            const isSelected = !isDisabledOptionSelected && seconds === selectedInterval;
            return (
              <button
                className={
                  isSelected
                    ? "repeat-interval-picker-option selected"
                    : "repeat-interval-picker-option"
                }
                key={seconds}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(seconds);
                  closeMenu();
                }}
              >
                <span>{getRepeatIntervalLabel(seconds)}</span>
                {isSelected && <Check size={15} aria-hidden="true" />}
              </button>
            );
          })
        )}
      </MotionDropdownMenu>
    </div>
  );
}
