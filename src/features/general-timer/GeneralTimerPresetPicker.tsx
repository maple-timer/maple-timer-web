import { Check } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import {
  GENERAL_TIMER_PRESETS,
  getGeneralTimerPreset,
} from "../../domain/general-timer/generalTimers";
import type { GeneralTimerPresetId } from "../../types";
import {
  MotionDropdownChevron,
  MotionDropdownMenu,
} from "../../shared/components/MotionDropdown";

function GeneralTimerPresetIcon({
  iconLabel,
  iconPaths,
}: {
  iconLabel: string;
  iconPaths: string[];
}) {
  if (iconPaths.length === 0) {
    return (
      <span className="general-timer-preset-icon text-icon" aria-hidden="true">
        <span>{iconLabel}</span>
      </span>
    );
  }

  return (
    <span className="general-timer-preset-icon image-icons" aria-hidden="true">
      {iconPaths.map((iconPath) => (
        <img key={iconPath} src={iconPath} alt="" draggable={false} />
      ))}
    </span>
  );
}

export function GeneralTimerPresetPicker({
  value,
  disabled = false,
  onChange,
}: {
  value: GeneralTimerPresetId;
  disabled?: boolean;
  onChange: (presetId: GeneralTimerPresetId) => void;
}) {
  const [isOpen, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedPreset = getGeneralTimerPreset(value);
  const closeMenu = useCallback(() => setOpen(false), []);

  return (
    <div className="general-timer-preset-picker" ref={pickerRef} data-interactive="true">
      <button
        className="general-timer-preset-trigger"
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label="일반 타이머 종류"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <GeneralTimerPresetIcon
          iconLabel={selectedPreset.iconLabel}
          iconPaths={selectedPreset.iconPaths}
        />
        <span className="general-timer-preset-label">{selectedPreset.label}</span>
        <MotionDropdownChevron isOpen={isOpen} />
      </button>
      <MotionDropdownMenu
        ariaLabel="일반 타이머 종류"
        className="general-timer-preset-menu"
        disabled={disabled}
        isOpen={isOpen}
        maxHeight={260}
        minWidth={220}
        pickerRef={pickerRef}
        triggerRef={triggerRef}
        onClose={closeMenu}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {GENERAL_TIMER_PRESETS.map((preset) => {
          const isSelected = preset.id === value;
          return (
            <button
              className={
                isSelected
                  ? "general-timer-preset-option selected"
                  : "general-timer-preset-option"
              }
              key={preset.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={(event) => {
                event.stopPropagation();
                onChange(preset.id);
                closeMenu();
              }}
            >
              <GeneralTimerPresetIcon
                iconLabel={preset.iconLabel}
                iconPaths={preset.iconPaths}
              />
              <span>{preset.label}</span>
              {isSelected && <Check size={15} aria-hidden="true" />}
            </button>
          );
        })}
      </MotionDropdownMenu>
    </div>
  );
}
