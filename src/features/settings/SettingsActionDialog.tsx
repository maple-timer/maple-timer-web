import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { MotionDialogFrame } from "../../shared/components/MotionDialogFrame";

type ConfirmVariant = "primary" | "danger";

export function SettingsConfirmDialog({
  title,
  description,
  cancelLabel,
  confirmLabel,
  extraActionLabel,
  confirmVariant = "primary",
  confirmDisabled = false,
  children,
  onCancel,
  onExtraAction,
  onConfirm,
}: {
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  extraActionLabel?: string;
  confirmVariant?: ConfirmVariant;
  confirmDisabled?: boolean;
  children?: ReactNode;
  onCancel: () => void;
  onExtraAction?: () => void;
  onConfirm: () => void;
}) {
  return (
    <MotionDialogFrame
      backdropClassName="confirm-backdrop settings-action-backdrop"
      dialogClassName="confirm-dialog settings-action-dialog"
      labelledBy="settings-action-title"
      onBackdropMouseDown={(event) => {
        event.stopPropagation();
        onCancel();
      }}
      onDialogMouseDown={(event) => event.stopPropagation()}
    >
        <header className="settings-action-dialog-header">
          <p className="eyebrow">Settings</p>
          <h2 id="settings-action-title">{title}</h2>
          <p>{description}</p>
        </header>
        {children && <div className="settings-action-dialog-content">{children}</div>}
        <div className="confirm-actions settings-action-dialog-actions">
          <button
            className="secondary-button settings-action-secondary"
            type="button"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          {extraActionLabel && onExtraAction && (
            <button
              className="secondary-button settings-action-secondary"
              type="button"
              onClick={onExtraAction}
            >
              {extraActionLabel}
            </button>
          )}
          <button
            className={
              confirmVariant === "danger"
                ? "danger-button settings-action-danger"
                : "primary-button settings-action-primary"
            }
            type="button"
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
    </MotionDialogFrame>
  );
}

export function SettingsTextInputDialog({
  title,
  description,
  label,
  initialValue,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  label: string;
  initialValue: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (value: string) => string | void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("프리셋 이름을 입력해야 합니다.");
      return;
    }
    const errorMessage = onConfirm(trimmed);
    if (errorMessage) {
      setError(errorMessage);
    }
  };

  return (
    <MotionDialogFrame
      backdropClassName="confirm-backdrop settings-action-backdrop"
      dialogClassName="confirm-dialog settings-action-dialog"
      labelledBy="settings-input-title"
      onBackdropMouseDown={(event) => {
        event.stopPropagation();
        onCancel();
      }}
      onDialogMouseDown={(event) => event.stopPropagation()}
    >
        <header className="settings-action-dialog-header">
          <p className="eyebrow">Settings</p>
          <h2 id="settings-input-title">{title}</h2>
          <p>{description}</p>
        </header>
        <label className="field-label settings-action-field" htmlFor={inputId}>
          {label}
          <input
            id={inputId}
            ref={inputRef}
            value={value}
            maxLength={60}
            onChange={(event) => {
              setValue(event.target.value);
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                submit();
              }
              if (event.key === "Escape") {
                onCancel();
              }
            }}
          />
        </label>
        {error && <p className="settings-action-error">{error}</p>}
        <div className="confirm-actions settings-action-dialog-actions">
          <button
            className="secondary-button settings-action-secondary"
            type="button"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button className="primary-button settings-action-primary" type="button" onClick={submit}>
            {confirmLabel}
          </button>
        </div>
    </MotionDialogFrame>
  );
}
