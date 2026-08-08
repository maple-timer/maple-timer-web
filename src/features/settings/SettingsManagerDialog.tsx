import {
  Download,
  FileInput,
  RefreshCw,
  RotateCcw,
  Save,
  Upload,
  X,
} from "lucide-react";
import { useRef } from "react";
import { MotionDialogFrame } from "../../shared/components/MotionDialogFrame";
import { useSettingsManagerActionDialogs } from "./useSettingsManagerActionDialogs";
import type { SettingsPreset } from "./settingsPresets";
import { SettingsManagerActionDialogs } from "./SettingsManagerActionDialogs";
import { SettingsPresetPicker } from "./SettingsPresetPicker";

export function SettingsManagerDialog({
  presets,
  currentSettingsPresetName,
  selectedPresetId,
  isApplyHintVisible,
  onSelectedPresetChange,
  onSaveNewPreset,
  onRenamePreset,
  onOverwritePreset,
  onDeletePreset,
  onApplyPreset,
  onExportAllPresets,
  onExportSelectedPreset,
  onImportSettings,
  onResetSettings,
  onClose,
}: {
  presets: SettingsPreset[];
  currentSettingsPresetName: string | null;
  selectedPresetId: string;
  isApplyHintVisible: boolean;
  onSelectedPresetChange: (presetId: string) => void;
  onSaveNewPreset: (name: string) => void;
  onRenamePreset: (presetId: string, name: string) => void;
  onOverwritePreset: (presetId: string) => void;
  onDeletePreset: (presetId: string) => void;
  onApplyPreset: (presetId: string) => void;
  onExportAllPresets: () => void;
  onExportSelectedPreset: (presetId: string) => void;
  onImportSettings: (file: File) => void;
  onResetSettings: () => void;
  onClose: () => void;
}) {
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? null;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasSelectedPreset = Boolean(selectedPreset);
  const {
    requestSaveNewPreset,
    requestRenamePreset,
    requestOverwritePreset,
    requestDeletePreset,
    requestReset,
    actionDialogProps,
  } = useSettingsManagerActionDialogs({
    presets,
    selectedPreset,
    onSaveNewPreset,
    onRenamePreset,
    onOverwritePreset,
    onDeletePreset,
    onResetSettings,
  });
  const currentSettingsLabel = currentSettingsPresetName
    ? `"${currentSettingsPresetName}"에 저장됨`
    : "없음";

  return (
    <>
      <MotionDialogFrame
        backdropClassName="settings-manager-backdrop"
        dialogClassName="settings-manager-dialog"
        labelledBy="settings-manager-title"
        onBackdropMouseDown={onClose}
        onDialogMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-manager-dialog-header">
          <div className="settings-manager-header-main">
            <div>
              <p className="eyebrow">Settings</p>
              <h2 id="settings-manager-title">프리셋 / 설정 백업</h2>
            </div>
            <div className="settings-manager-current-state" aria-label="현재 화면 설정">
              <span>현재 화면 설정</span>
              <strong>{currentSettingsLabel}</strong>
            </div>
          </div>
          <button className="icon-button small" type="button" aria-label="닫기" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <section className="settings-dialog-section settings-preset-section">
          <div className="settings-dialog-section-heading">
            <h3>프리셋</h3>
            <p>알림 구성을 저장해 필요할 때 적용합니다.</p>
          </div>

          <div className="settings-preset-workflow">
            <div className="settings-preset-control-row">
              <label className="field-label settings-preset-select">
                보유 프리셋
                <SettingsPresetPicker
                  presets={presets}
                  selectedPresetId={selectedPresetId}
                  disabled={presets.length === 0}
                  onChange={onSelectedPresetChange}
                  onRequestRename={requestRenamePreset}
                  onRequestDelete={requestDeletePreset}
                />
              </label>
              <button
                className={
                  isApplyHintVisible
                    ? "primary-button settings-preset-apply-button settings-manager-ghost-action attention"
                    : "primary-button settings-preset-apply-button settings-manager-ghost-action"
                }
                type="button"
                disabled={!hasSelectedPreset}
                onClick={() => selectedPreset && onApplyPreset(selectedPreset.id)}
              >
                <FileInput size={16} />
                적용
              </button>
            </div>
            <div className="settings-preset-actions">
              <button
                className="secondary-button settings-manager-ghost-action"
                type="button"
                disabled={!hasSelectedPreset}
                onClick={() => selectedPreset && requestOverwritePreset(selectedPreset)}
              >
                <RefreshCw size={16} />
                현재 설정으로 갱신
              </button>
              <button
                className="secondary-button settings-manager-ghost-action"
                type="button"
                onClick={requestSaveNewPreset}
              >
                <Save size={16} />
                새 프리셋 저장
              </button>
            </div>
            {isApplyHintVisible && (
              <p className="settings-preset-apply-hint">
                선택한 프리셋은 적용 전입니다. 적용을 누르면 현재 설정으로 바뀝니다.
              </p>
            )}
          </div>
        </section>

        <section className="settings-dialog-section settings-backup-section">
          <div className="settings-backup-copy">
            <div className="settings-dialog-section-heading">
              <h3>설정 백업</h3>
              <p>다른 PC, 브라우저, 캐시 초기화 후 복구할 때 JSON 파일을 사용합니다.</p>
            </div>
            <div className="settings-backup-notes">
              <p className="settings-manager-note">
                유효하지 않은 값은 기본값으로 보정되며 실행 중인 타이머 상태는 저장하지 않습니다.
              </p>
              <p className="settings-manager-note strong">
                사용자 알림음 파일은 백업에 포함되지 않아 다시 업로드해야 합니다.
              </p>
            </div>
          </div>
          <div className="settings-file-actions">
            <button
              className="secondary-button settings-manager-ghost-action"
              type="button"
              disabled={presets.length === 0}
              onClick={onExportAllPresets}
            >
              <Download size={16} />
              모든 프리셋 내보내기
            </button>
            <button
              className="secondary-button settings-manager-ghost-action"
              type="button"
              disabled={!hasSelectedPreset}
              onClick={() => selectedPreset && onExportSelectedPreset(selectedPreset.id)}
            >
              <Download size={16} />
              선택한 프리셋 내보내기
            </button>
            <button
              className="secondary-button settings-manager-ghost-action"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={16} />
              프리셋 불러오기
            </button>
            <input
              ref={fileInputRef}
              className="settings-file-input"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) {
                  onImportSettings(file);
                }
              }}
            />
          </div>
        </section>

        <section className="settings-dialog-section danger-zone">
          <div className="settings-dialog-section-heading">
            <h3>현재 설정 초기화</h3>
            <p>
              스킬, 룬, 사냥 멈춤 알림, 일반 타이머 설정을 기본값으로 되돌립니다.
              화면 공유와 저장된 프리셋은 유지됩니다.
            </p>
          </div>
          <button
            className="danger-button settings-manager-danger-ghost"
            type="button"
            onClick={requestReset}
          >
            <RotateCcw size={16} />
            현재 설정 초기화
          </button>
        </section>
      </MotionDialogFrame>

      <SettingsManagerActionDialogs {...actionDialogProps} />
    </>
  );
}
