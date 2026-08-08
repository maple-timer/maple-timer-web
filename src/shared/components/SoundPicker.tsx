import { Check, Music, Play } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import {
  DEFAULT_PICKER_ALERT_SOUNDS,
  getAlertSound,
  type AlertSound,
} from "../../lib/sounds";
import { trackCustomSoundSelected } from "../../lib/analyticsEvents";
import { FloatingTooltipButton } from "./FloatingTooltip";
import { MotionDropdownChevron, MotionDropdownMenu } from "./MotionDropdown";
import { useSoundPickerCustomSounds } from "./SoundPickerCustomSoundsContext";

type SoundPickerProps = {
  value: string;
  disabled?: boolean;
  ariaLabel?: string;
  previewLabel?: string;
  sounds?: AlertSound[];
  onChange: (soundId: string) => void;
  onPreview?: () => void;
};

export function SoundPicker({
  value,
  disabled = false,
  ariaLabel = "알람음",
  previewLabel = "알람음 재생",
  sounds = DEFAULT_PICKER_ALERT_SOUNDS,
  onChange,
  onPreview,
}: SoundPickerProps) {
  const [isOpen, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const {
    customSounds: customAlertSounds,
    onManageCustomSounds: openCustomSoundManager,
  } = useSoundPickerCustomSounds();
  const selectedSound =
    customAlertSounds.find((sound) => sound.id === value) ??
    sounds.find((sound) => sound.id === value) ??
    getAlertSound(value);
  const closeMenu = useCallback(() => setOpen(false), []);

  return (
    <div className={onPreview ? "sound-picker has-preview" : "sound-picker"} ref={pickerRef}>
      <button
        className="sound-picker-trigger"
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
        <span className="sound-picker-selected">{selectedSound.label}</span>
        <MotionDropdownChevron isOpen={isOpen} />
      </button>
      {onPreview && (
        <FloatingTooltipButton
          className="sound-picker-preview-button"
          type="button"
          aria-label={previewLabel}
          tooltip={previewLabel}
          tooltipId={`${listboxId}-preview-tooltip`}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onPreview();
          }}
        >
          <Play size={15} aria-hidden="true" />
        </FloatingTooltipButton>
      )}

      <MotionDropdownMenu
        ariaLabel={ariaLabel}
        className="sound-picker-menu"
        disabled={disabled}
        id={listboxId}
        isOpen={isOpen}
        maxHeight={280}
        minWidth={320}
        pickerRef={pickerRef}
        triggerRef={triggerRef}
        onClose={closeMenu}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="sound-picker-option sound-picker-manage-option"
          type="button"
          role="option"
          aria-selected="false"
          onClick={(event) => {
            event.stopPropagation();
            openCustomSoundManager();
            closeMenu();
          }}
        >
          <span>{customAlertSounds.length > 0 ? "내 알림음 관리..." : "내 알림음 추가..."}</span>
          <Music size={15} aria-hidden="true" />
        </button>
        {customAlertSounds.length > 0 && (
          <>
            {customAlertSounds.map((sound) => {
              const isSelected = sound.id === selectedSound.id;
              return (
                <button
                  className={isSelected ? "sound-picker-option selected" : "sound-picker-option"}
                  key={sound.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={(event) => {
                    event.stopPropagation();
                    onChange(sound.id);
                    trackCustomSoundSelected();
                    closeMenu();
                  }}
                >
                  <span>{sound.label}</span>
                  {isSelected && <Check size={15} aria-hidden="true" />}
                </button>
              );
            })}
            <div className="sound-picker-divider" role="presentation" />
          </>
        )}
        {sounds.map((sound) => {
          const isSelected = sound.id === selectedSound.id;
          return (
            <button
              className={isSelected ? "sound-picker-option selected" : "sound-picker-option"}
              key={sound.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={(event) => {
                event.stopPropagation();
                onChange(sound.id);
                closeMenu();
              }}
            >
              <span>{sound.label}</span>
              {isSelected && <Check size={15} aria-hidden="true" />}
            </button>
          );
        })}
      </MotionDropdownMenu>
    </div>
  );
}
