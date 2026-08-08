import { AnimatePresence } from "motion/react";
import type { SettingsPreset } from "./settingsPresets";
import { SettingsConfirmDialog, SettingsTextInputDialog } from "./SettingsActionDialog";

export type SettingsManagerActionDialogsProps = {
  newPresetInitialName: string | null;
  renamePreset: SettingsPreset | null;
  overwritePreset: SettingsPreset | null;
  deletePreset: SettingsPreset | null;
  isResetConfirmOpen: boolean;
  onCancelNewPreset: () => void;
  onConfirmNewPreset: (name: string) => string | void;
  onCancelRenamePreset: () => void;
  onConfirmRenamePreset: (name: string) => string | void;
  onCancelOverwritePreset: () => void;
  onConfirmOverwritePreset: () => void;
  onCancelDeletePreset: () => void;
  onConfirmDeletePreset: () => void;
  onCancelReset: () => void;
  onConfirmReset: () => void;
};

export function SettingsManagerActionDialogs({
  newPresetInitialName,
  renamePreset,
  overwritePreset,
  deletePreset,
  isResetConfirmOpen,
  onCancelNewPreset,
  onConfirmNewPreset,
  onCancelRenamePreset,
  onConfirmRenamePreset,
  onCancelOverwritePreset,
  onConfirmOverwritePreset,
  onCancelDeletePreset,
  onConfirmDeletePreset,
  onCancelReset,
  onConfirmReset,
}: SettingsManagerActionDialogsProps) {
  return (
    <AnimatePresence>
      {newPresetInitialName !== null && (
        <SettingsTextInputDialog
          key="settings-new-preset"
          title="새 프리셋 저장"
          description="현재 알림 구성을 새 프리셋으로 저장합니다."
          label="프리셋 이름"
          initialValue={newPresetInitialName}
          cancelLabel="취소"
          confirmLabel="저장"
          onCancel={onCancelNewPreset}
          onConfirm={onConfirmNewPreset}
        />
      )}

      {renamePreset && (
        <SettingsTextInputDialog
          key="settings-rename-preset"
          title="프리셋 이름 변경"
          description={`"${renamePreset.name}" 프리셋 이름을 변경합니다.`}
          label="프리셋 이름"
          initialValue={renamePreset.name}
          cancelLabel="그대로 두기"
          confirmLabel="이름 변경"
          onCancel={onCancelRenamePreset}
          onConfirm={onConfirmRenamePreset}
        />
      )}

      {overwritePreset && (
        <SettingsConfirmDialog
          key="settings-overwrite-preset"
          title={`"${overwritePreset.name}" 프리셋을 갱신할까요?`}
          description="저장된 프리셋 내용을 현재 설정으로 덮어씁니다."
          cancelLabel="그대로 두기"
          confirmLabel="갱신하기"
          onCancel={onCancelOverwritePreset}
          onConfirm={onConfirmOverwritePreset}
        />
      )}

      {deletePreset && (
        <SettingsConfirmDialog
          key="settings-delete-preset"
          title={`"${deletePreset.name}" 프리셋을 삭제할까요?`}
          description="삭제한 프리셋은 되돌릴 수 없습니다. 현재 적용된 설정 자체는 유지됩니다."
          cancelLabel="유지하기"
          confirmLabel="삭제하기"
          confirmVariant="danger"
          onCancel={onCancelDeletePreset}
          onConfirm={onConfirmDeletePreset}
        />
      )}

      {isResetConfirmOpen && (
        <SettingsConfirmDialog
          key="settings-reset"
          title="현재 설정을 초기화할까요?"
          description="스킬, 룬, 사냥 멈춤 알림, 일반 타이머 설정과 감지 상태를 기본값으로 되돌립니다. 화면 공유와 저장된 프리셋은 유지됩니다."
          cancelLabel="유지하기"
          confirmLabel="초기화하기"
          confirmVariant="danger"
          onCancel={onCancelReset}
          onConfirm={onConfirmReset}
        />
      )}
    </AnimatePresence>
  );
}
