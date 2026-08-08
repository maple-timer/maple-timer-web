import { useEffect, useState } from "react";
import {
  getGeneralTimerPreset,
  MAX_GENERAL_TIMER_NAME_LENGTH,
  normalizeGeneralTimerName,
} from "../../domain/general-timer/generalTimers";
import { DEFAULT_PICKER_ALERT_SOUNDS } from "../../lib/sounds";
import type { GeneralTimerConfig } from "../../types";
import { AlertEditorRow } from "../../shared/components/AlertEditorRow";

function GeneralTimerNameField({
  timer,
  isDisabled,
  onChange,
}: {
  timer: GeneralTimerConfig;
  isDisabled: boolean;
  onChange: (timerId: string, patch: Partial<GeneralTimerConfig>) => void;
}) {
  const savedName = timer.name ?? "";
  const [draft, setDraft] = useState(savedName);
  const [isFocused, setFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(savedName);
    }
  }, [isFocused, savedName]);

  const commitDraft = () => {
    const nextName = normalizeGeneralTimerName(draft);
    setDraft(nextName ?? "");
    if (nextName !== timer.name) {
      onChange(timer.id, { name: nextName });
    }
  };

  return (
    <>
      <div className="inline-editor-field-heading">
        <span className="inline-editor-field-label">이름</span>
      </div>
      <div className="inline-editor-field-control">
        <input
          aria-label="일반 타이머 이름"
          className="general-timer-name-input"
          disabled={isDisabled}
          maxLength={MAX_GENERAL_TIMER_NAME_LENGTH}
          placeholder={getGeneralTimerPreset(timer.presetId).label}
          type="text"
          value={draft}
          onBlur={() => {
            setFocused(false);
            commitDraft();
          }}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return;
            }
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setDraft(savedName);
              event.currentTarget.blur();
            }
          }}
        />
      </div>
    </>
  );
}

export function GeneralTimerEditorRow({
  timer,
  isExpanded,
  colSpan,
  isDisabled,
  onChange,
  onPreviewSound,
}: {
  timer: GeneralTimerConfig;
  isExpanded: boolean;
  colSpan: number;
  isDisabled: boolean;
  onChange: (timerId: string, patch: Partial<GeneralTimerConfig>) => void;
  onPreviewSound: (soundId: string, volume: number) => void;
}) {
  return (
    <AlertEditorRow
      isExpanded={isExpanded}
      colSpan={colSpan}
      editorId={`general-timer-editor-${timer.id}`}
      rowClassName="general-timer-editor-row"
      editorClassName="general-timer-inline-editor"
      editorLayout="command-rail"
      disabled={isDisabled}
      soundId={timer.soundId}
      soundLabel="알림음"
      sounds={DEFAULT_PICKER_ALERT_SOUNDS}
      volume={timer.volume}
      volumeWarningKey={`general-timer-${timer.id}`}
      volumeAriaLabelPrefix="일반 타이머 볼륨"
      extraContent={
        <GeneralTimerNameField timer={timer} isDisabled={isDisabled} onChange={onChange} />
      }
      onSoundChange={(soundId) => onChange(timer.id, { soundId })}
      onVolumeChange={(volume) => onChange(timer.id, { volume })}
      onPreviewSound={(volumeOverride) => onPreviewSound(timer.soundId, volumeOverride ?? timer.volume)}
    />
  );
}
