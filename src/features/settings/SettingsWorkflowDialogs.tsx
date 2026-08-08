import { AnimatePresence } from "motion/react";
import {
  SettingsApplyConfirmDialog,
  type PendingSettingsApply,
} from "./SettingsApplyConfirmDialog";
import { SettingsConfirmDialog, SettingsTextInputDialog } from "./SettingsActionDialog";
import type {
  PendingSettingsPresetImport,
  PendingSettingsReplacementAction,
} from "./useSettingsPresetController";

export type SettingsWorkflowDialogsProps = {
  pendingSettingsPresetImport: PendingSettingsPresetImport | null;
  pendingSettingsReplacementAction: PendingSettingsReplacementAction | null;
  isUnsavedSettingsSavePromptOpen: boolean;
  pendingSettingsApply: PendingSettingsApply | null;
  onCancelSettingsPresetImport: () => void;
  onConfirmSettingsPresetImport: () => void;
  onSelectAllImportedSettingsPresets: () => void;
  onClearImportedSettingsPresetSelection: () => void;
  onToggleImportedSettingsPreset: (presetId: string, isSelected: boolean) => void;
  onCancelUnsavedSettingsReplacement: () => void;
  onConfirmUnsavedSettingsReplacement: () => void;
  onOpenUnsavedSettingsSavePrompt: () => void;
  onCloseUnsavedSettingsSavePrompt: () => void;
  onSaveCurrentSettingsBeforeReplacement: (name: string) => string | void;
  onCancelSettingsApply: () => void;
  onConfirmSettingsApply: () => void;
};

export function SettingsWorkflowDialogs({
  pendingSettingsPresetImport,
  pendingSettingsReplacementAction,
  isUnsavedSettingsSavePromptOpen,
  pendingSettingsApply,
  onCancelSettingsPresetImport,
  onConfirmSettingsPresetImport,
  onSelectAllImportedSettingsPresets,
  onClearImportedSettingsPresetSelection,
  onToggleImportedSettingsPreset,
  onCancelUnsavedSettingsReplacement,
  onConfirmUnsavedSettingsReplacement,
  onOpenUnsavedSettingsSavePrompt,
  onCloseUnsavedSettingsSavePrompt,
  onSaveCurrentSettingsBeforeReplacement,
  onCancelSettingsApply,
  onConfirmSettingsApply,
}: SettingsWorkflowDialogsProps) {
  return (
    <AnimatePresence>
      {pendingSettingsPresetImport && (
        <SettingsConfirmDialog
          key="settings-preset-import"
          title="설정 파일을 프리셋으로 불러올까요?"
          description={`"${pendingSettingsPresetImport.fileName}" 파일에서 불러올 프리셋을 선택합니다. 현재 설정은 변경하지 않습니다.`}
          cancelLabel="불러오지 않기"
          confirmLabel="선택한 프리셋 추가"
          confirmDisabled={pendingSettingsPresetImport.selectedPresetIds.length === 0}
          onCancel={onCancelSettingsPresetImport}
          onConfirm={onConfirmSettingsPresetImport}
        >
          <dl className="settings-apply-summary">
            <div>
              <dt>선택됨</dt>
              <dd>{pendingSettingsPresetImport.selectedPresetIds.length}개</dd>
            </div>
            <div>
              <dt>파일 안 프리셋</dt>
              <dd>{pendingSettingsPresetImport.presets.length}개</dd>
            </div>
            <div>
              <dt>현재 설정</dt>
              <dd>유지</dd>
            </div>
          </dl>
          <div className="settings-import-selection">
            <div className="settings-import-selection-header">
              <strong>불러올 프리셋</strong>
              <div className="settings-import-selection-actions">
                <button
                  className="settings-inline-button"
                  type="button"
                  onClick={onSelectAllImportedSettingsPresets}
                >
                  전체 선택
                </button>
                <button
                  className="settings-inline-button"
                  type="button"
                  onClick={onClearImportedSettingsPresetSelection}
                >
                  전체 해제
                </button>
              </div>
            </div>
            <div className="settings-import-option-list">
              {pendingSettingsPresetImport.presets.map((preset) => {
                const isChecked = pendingSettingsPresetImport.selectedPresetIds.includes(preset.id);
                return (
                  <label className="settings-import-option" key={preset.id}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(event) =>
                        onToggleImportedSettingsPreset(preset.id, event.target.checked)
                      }
                    />
                    <span>{preset.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
          {pendingSettingsPresetImport.warnings &&
            pendingSettingsPresetImport.warnings.length > 0 && (
              <ul className="settings-apply-warnings">
                {pendingSettingsPresetImport.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
        </SettingsConfirmDialog>
      )}

      {pendingSettingsReplacementAction && !isUnsavedSettingsSavePromptOpen && (
        <SettingsConfirmDialog
          key="settings-unsaved-replacement"
          title="현재 설정을 저장하지 않고 변경할까요?"
          description="현재 메인 화면의 설정과 같은 보유 프리셋이 없습니다. 계속하면 지금 설정을 프리셋으로 다시 복구하기 어렵습니다."
          cancelLabel="돌아가기"
          extraActionLabel="새 프리셋으로 저장"
          confirmLabel={
            pendingSettingsReplacementAction.kind === "reset" ? "그대로 초기화" : "그대로 적용"
          }
          confirmVariant="danger"
          onCancel={onCancelUnsavedSettingsReplacement}
          onExtraAction={onOpenUnsavedSettingsSavePrompt}
          onConfirm={onConfirmUnsavedSettingsReplacement}
        />
      )}

      {pendingSettingsReplacementAction && isUnsavedSettingsSavePromptOpen && (
        <SettingsTextInputDialog
          key="settings-unsaved-save"
          title="현재 설정 저장"
          description="현재 메인 화면의 설정을 새 보유 프리셋으로 저장한 뒤 계속 진행합니다."
          label="프리셋 이름"
          initialValue="현재 설정"
          cancelLabel="돌아가기"
          confirmLabel="저장 후 계속"
          onCancel={onCloseUnsavedSettingsSavePrompt}
          onConfirm={onSaveCurrentSettingsBeforeReplacement}
        />
      )}

      {pendingSettingsApply && (
        <SettingsApplyConfirmDialog
          key="settings-apply"
          pending={pendingSettingsApply}
          onCancel={onCancelSettingsApply}
          onConfirm={onConfirmSettingsApply}
        />
      )}
    </AnimatePresence>
  );
}
