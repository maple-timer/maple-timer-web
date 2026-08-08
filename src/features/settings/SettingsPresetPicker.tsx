import { Check, Pencil, Trash2 } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import {
  MotionDropdownChevron,
  MotionDropdownMenu,
} from "../../shared/components/MotionDropdown";
import { FloatingTooltipButton } from "../../shared/components/FloatingTooltip";
import type { SettingsPreset } from "./settingsPresets";

export type SettingsPresetPickerProps = {
  presets: SettingsPreset[];
  selectedPresetId: string;
  disabled: boolean;
  onChange: (presetId: string) => void;
  onRequestRename: (preset: SettingsPreset) => void;
  onRequestDelete: (preset: SettingsPreset) => void;
};

export function SettingsPresetPicker({
  presets,
  selectedPresetId,
  disabled,
  onChange,
  onRequestRename,
  onRequestDelete,
}: SettingsPresetPickerProps) {
  const [isOpen, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? null;
  const selectedLabel = selectedPreset?.name ?? "보유 프리셋 없음";
  const closeMenu = useCallback(() => setOpen(false), []);

  return (
    <div className="settings-preset-picker" ref={pickerRef}>
      <button
        className="settings-preset-picker-trigger"
        ref={triggerRef}
        type="button"
        aria-label="보유 프리셋"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <span className="settings-preset-picker-selected">{selectedLabel}</span>
        <MotionDropdownChevron isOpen={isOpen} />
      </button>

      <MotionDropdownMenu
        ariaLabel="보유 프리셋"
        className="settings-preset-picker-menu"
        disabled={disabled}
        id={listboxId}
        isOpen={isOpen}
        maxHeight={260}
        minWidth={260}
        outsideMouseDownCapture
        pickerRef={pickerRef}
        triggerRef={triggerRef}
        onClose={closeMenu}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {presets.map((preset) => {
          const isSelected = preset.id === selectedPresetId;
          return (
            <div
              className={
                isSelected
                  ? "settings-preset-picker-option selected"
                  : "settings-preset-picker-option"
              }
              key={preset.id}
              role="option"
              aria-selected={isSelected}
            >
              <button
                className="settings-preset-picker-option-main"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(preset.id);
                  closeMenu();
                }}
              >
                <span>{preset.name}</span>
                {isSelected && <Check size={15} aria-hidden="true" />}
              </button>
              <FloatingTooltipButton
                className="settings-preset-picker-edit"
                type="button"
                aria-label={`${preset.name} 이름 변경`}
                tooltipId={`settings-preset-edit-${preset.id}`}
                tooltip="이름 변경"
                onClick={(event) => {
                  event.stopPropagation();
                  closeMenu();
                  onRequestRename(preset);
                }}
              >
                <Pencil size={14} aria-hidden="true" />
              </FloatingTooltipButton>
              <FloatingTooltipButton
                className="settings-preset-picker-delete"
                type="button"
                aria-label={`${preset.name} 삭제`}
                tooltipId={`settings-preset-delete-${preset.id}`}
                tooltip="삭제"
                onClick={(event) => {
                  event.stopPropagation();
                  closeMenu();
                  onRequestDelete(preset);
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
              </FloatingTooltipButton>
            </div>
          );
        })}
      </MotionDropdownMenu>
    </div>
  );
}
