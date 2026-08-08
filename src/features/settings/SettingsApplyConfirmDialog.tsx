import { AlertTriangle } from "lucide-react";
import { MotionDialogFrame } from "../../shared/components/MotionDialogFrame";
import type { Profile } from "../../types";
import { getSettingsBundleSummary } from "./settingsTransfer";

export type PendingSettingsApply = {
  title: string;
  description: string;
  confirmLabel: string;
  presetId?: string;
  profile: Profile;
  customSoundFallbackNotice?: {
    missingSoundCount: number;
    replacedReferenceCount: number;
    fallbackSoundLabel: string;
    affectedLabels: string[];
  };
  warnings?: string[];
  importedPresetCount?: number;
};

export function SettingsApplyConfirmDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingSettingsApply;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const summary = getSettingsBundleSummary(pending.profile);

  return (
    <MotionDialogFrame
      backdropClassName="confirm-backdrop"
      dialogClassName="confirm-dialog settings-apply-dialog"
      labelledBy="settings-apply-title"
    >
        <header className="settings-action-dialog-header">
          <p className="eyebrow">Settings</p>
          <h2 id="settings-apply-title">{pending.title}</h2>
          <p>{pending.description}</p>
        </header>

        <dl className="settings-apply-summary">
          <div>
            <dt>스킬</dt>
            <dd>{summary.skillCount}개</dd>
          </div>
          <div>
            <dt>일반 타이머</dt>
            <dd>{summary.generalTimerCount}개</dd>
          </div>
          <div>
            <dt>포함 프리셋</dt>
            <dd>{pending.importedPresetCount ?? 0}개</dd>
          </div>
        </dl>

        <div className="settings-apply-warning">
          <AlertTriangle size={17} aria-hidden="true" />
          <span>화면 공유는 유지되지만 감지 상태와 실행 중인 타이머 상태는 초기화됩니다.</span>
        </div>

        {pending.customSoundFallbackNotice && (
          <section className="settings-apply-missing-sound" role="alert">
            <div className="settings-apply-missing-sound-title">
              <AlertTriangle size={18} aria-hidden="true" />
              <div>
                <strong>사용자 알림음 파일이 없습니다</strong>
                <span>
                  없는 알림음 {pending.customSoundFallbackNotice.missingSoundCount}개를 찾았습니다.
                </span>
              </div>
            </div>
            <p>
              적용하면 관련 설정 {pending.customSoundFallbackNotice.replacedReferenceCount}개가{" "}
              <strong>{pending.customSoundFallbackNotice.fallbackSoundLabel}</strong> 기본
              알림음으로 바뀝니다.
            </p>
            <ul aria-label="기본 알림음으로 바뀌는 항목">
              {pending.customSoundFallbackNotice.affectedLabels.slice(0, 6).map((label) => (
                <li key={label}>{label}</li>
              ))}
              {pending.customSoundFallbackNotice.affectedLabels.length > 6 && (
                <li>
                  외 {pending.customSoundFallbackNotice.affectedLabels.length - 6}개
                </li>
              )}
            </ul>
          </section>
        )}

        {pending.warnings && pending.warnings.length > 0 && (
          <ul className="settings-apply-warnings">
            {pending.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}

        <div className="confirm-actions settings-action-dialog-actions">
          <button
            className="secondary-button settings-action-secondary"
            type="button"
            onClick={onCancel}
          >
            취소
          </button>
          <button className="primary-button settings-action-primary" type="button" onClick={onConfirm}>
            {pending.confirmLabel}
          </button>
        </div>
    </MotionDialogFrame>
  );
}
