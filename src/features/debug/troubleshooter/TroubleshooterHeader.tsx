import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Download, Moon, RefreshCw, Sun, TimerReset } from "lucide-react";
import type { FormEvent } from "react";
import type { TroubleshooterViewModel } from "./model";

export function TroubleshooterHeader({
  input,
  onInputChange,
  onSubmit,
  onReload,
  onDownload,
  isLoading,
  isDownloading,
  theme,
  onThemeToggle,
  view,
}: {
  input: string;
  onInputChange(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onReload(): void;
  onDownload(): void | Promise<void>;
  isLoading: boolean;
  isDownloading: boolean;
  theme: "light" | "dark";
  onThemeToggle(): void;
  view: TroubleshooterViewModel | null;
}) {
  return (
    <header className="troubleshooter-header">
      <a className="troubleshooter-brand" href="/" aria-label="Maple Timer로 이동">
        <span className="troubleshooter-brand-mark" aria-hidden="true">
          <TimerReset size={18} />
        </span>
        <span className="troubleshooter-brand-copy">
          <strong>Maple Timer</strong>
          <small>트러블슈터</small>
        </span>
      </a>

      <form className="troubleshooter-source-form" onSubmit={onSubmit}>
        <TextInput
          label="샘플 ID 또는 조회 주소"
          isLabelHidden
          size="sm"
          value={input}
          onChange={onInputChange}
          placeholder="샘플 ID 또는 조회 주소"
          hasClear
          isLoading={isLoading}
        />
        <Button
          label="샘플 불러오기"
          size="sm"
          variant="primary"
          type="submit"
          isLoading={isLoading}
        />
      </form>

      <nav className="troubleshooter-actions" aria-label="샘플 작업">
        {view ? (
          <span className="troubleshooter-environment">
            <StatusDot
              variant={view.metadata.environmentLabel === "프로덕션" ? "success" : "warning"}
              label={view.metadata.environmentLabel}
            />
            {view.metadata.environmentLabel}
          </span>
        ) : null}
        <IconButton
          label="샘플 다시 불러오기"
          tooltip="샘플 다시 불러오기"
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={16} />}
          onClick={onReload}
          isDisabled={!view || isLoading}
        />
        <IconButton
          label="샘플 다운로드"
          tooltip="JSON과 증거 이미지 다운로드"
          size="sm"
          variant="ghost"
          icon={<Download size={16} />}
          clickAction={onDownload}
          isLoading={isDownloading}
          isDisabled={!view}
        />
        <IconButton
          label={theme === "dark" ? "밝은 화면 사용" : "어두운 화면 사용"}
          tooltip={theme === "dark" ? "밝은 화면" : "어두운 화면"}
          size="sm"
          variant="ghost"
          icon={theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          onClick={onThemeToggle}
        />
      </nav>
    </header>
  );
}
