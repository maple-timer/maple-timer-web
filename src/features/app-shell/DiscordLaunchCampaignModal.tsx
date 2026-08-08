import { Button } from "@astryxdesign/core/Button";
import { Link } from "@astryxdesign/core/Link";
import { LockKeyhole, Radio, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { DiscordBrandIcon } from "../../shared/components/DiscordBrandIcon";
import { MotionDialogFrame } from "../../shared/components/MotionDialogFrame";
import { DISCORD_LAUNCH_CAMPAIGN_INVITE_URL } from "./discordLaunchCampaign";

export function DiscordLaunchCampaignModal({
  onDismiss,
  onOpenDiscord,
  onVisible,
}: {
  onDismiss: () => void;
  onOpenDiscord: () => void;
  onVisible: () => void;
}) {
  const hasReportedVisibleRef = useRef(false);

  useEffect(() => {
    if (!hasReportedVisibleRef.current) {
      hasReportedVisibleRef.current = true;
      onVisible();
    }
  }, [onVisible]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  return (
    <MotionDialogFrame
      backdropClassName="discord-campaign-backdrop"
      dialogClassName="discord-campaign-dialog"
      labelledBy="discord-campaign-title"
      describedBy="discord-campaign-description"
      onBackdropMouseDown={onDismiss}
      onDialogMouseDown={(event) => event.stopPropagation()}
    >
      <header className="discord-campaign-header">
        <span className="discord-campaign-mark" aria-hidden="true">
          <DiscordBrandIcon size={22} />
        </span>
        <section className="discord-campaign-heading">
          <p>Maple Timer Community</p>
          <h2 id="discord-campaign-title">메이플 타이머 디스코드가 열렸습니다</h2>
        </section>
        <Button
          className="discord-campaign-close"
          label="닫기"
          variant="ghost"
          size="sm"
          isIconOnly
          icon={<X size={17} />}
          onClick={onDismiss}
        />
      </header>

      <section className="discord-campaign-body" id="discord-campaign-description">
        <p className="discord-campaign-description">
          운영자에게 직접 문의하고, 화면 사진이나 동영상을 편하게 보내세요.
        </p>
        <ul className="discord-campaign-benefits">
          <li>
            <LockKeyhole size={17} aria-hidden="true" />
            <span>
              <strong>운영자와 직접 문의</strong>
              자세한 설명과 함께 사진이나 동영상도 편하게 보낼 수 있어요.
            </span>
          </li>
          <li>
            <Radio size={17} aria-hidden="true" />
            <span>
              <strong>업데이트 소식</strong>
              새 기능과 주요 안내를 한곳에서 확인할 수 있어요.
            </span>
          </li>
        </ul>
      </section>

      <footer className="discord-campaign-actions">
        <Link
          className="discord-campaign-primary"
          href={DISCORD_LAUNCH_CAMPAIGN_INVITE_URL}
          target="_blank"
          isStandalone
          onClick={onOpenDiscord}
        >
          <DiscordBrandIcon size={17} tone="white" />
          디스코드 둘러보기
        </Link>
        <Button
          className="discord-campaign-dismiss"
          label="닫기"
          variant="ghost"
          onClick={onDismiss}
        />
      </footer>
    </MotionDialogFrame>
  );
}
