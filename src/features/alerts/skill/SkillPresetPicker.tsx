import { Check } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import {
  getSkillPreset,
  normalizeSkillPresetId,
  SKILL_PRESETS,
  type SkillPreset,
} from "../../../lib/skillPresets";
import {
  MotionDropdownChevron,
  MotionDropdownMenu,
} from "../../../shared/components/MotionDropdown";
import type { SkillPresetId } from "../../../types";

type SkillPresetPickerProps = {
  value: string;
  ariaLabel?: string;
  selectedLabelOverride?: string;
  disabled?: boolean;
  onChange: (presetId: SkillPresetId) => void;
};

function SkillPresetIcon({ preset }: { preset: SkillPreset }) {
  return (
    <span className="skill-preset-picker-icon" aria-hidden="true">
      {preset.iconSrc ? (
        <img src={preset.iconSrc} alt="" width="24" height="24" draggable={false} />
      ) : null}
    </span>
  );
}

export function SkillPresetPicker({
  value,
  ariaLabel = "스킬",
  selectedLabelOverride,
  disabled = false,
  onChange,
}: SkillPresetPickerProps) {
  const [isOpen, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selectedPresetId = normalizeSkillPresetId(value);
  const selectedPreset = getSkillPreset(selectedPresetId);
  const closeMenu = useCallback(() => setOpen(false), []);

  return (
    <div className="skill-preset-picker" ref={pickerRef}>
      <button
        className="skill-preset-picker-trigger"
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        data-preset-id={selectedPresetId}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <SkillPresetIcon preset={selectedPreset} />
        <span className="skill-preset-picker-selected">
          {selectedLabelOverride ?? selectedPreset.label}
        </span>
        <MotionDropdownChevron isOpen={isOpen} />
      </button>

      <MotionDropdownMenu
        ariaLabel={ariaLabel}
        className="skill-preset-picker-menu"
        disabled={disabled}
        id={listboxId}
        isOpen={isOpen}
        maxHeight={260}
        minWidth={340}
        pickerRef={pickerRef}
        triggerRef={triggerRef}
        onClose={closeMenu}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {SKILL_PRESETS.map((preset) => {
          const isSelected = preset.id === selectedPresetId;
          return (
            <button
              className={
                isSelected
                  ? "skill-preset-picker-option selected"
                  : "skill-preset-picker-option"
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
              <SkillPresetIcon preset={preset} />
              <span>{preset.label}</span>
              {isSelected && <Check size={15} aria-hidden="true" />}
            </button>
          );
        })}
      </MotionDropdownMenu>
    </div>
  );
}
